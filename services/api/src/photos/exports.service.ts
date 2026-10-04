// Purpose-specific exports (spec §6.3; Bible §7.3, §8.3, §22.4, §34.1 #18–19,
// #21; ADR-0026 K3-14, K3-15; ADR-0027). Starting an export checks the
// patient's current grant for the purpose on every photo it shows, then in one
// transaction registers the output object, creates the derivative and a
// release whose subject is that derivative (pinning every permission version
// relied on), queues the render and writes PHOTO_EXPORTED per photo. The
// original is never changed. A download re-checks the release and the grants.
import {
  EXPORT_KINDS,
  EXPORT_MAX_EDGE_PX,
  type ExportAccessUrl,
  type ExportKind,
  type ExportPurpose,
  MARKETING_EXPORT_PURPOSES,
  type MediaExport,
  type PhotoExportCreate,
} from "@aestara/api-contracts";
import { uuidv7 } from "@aestara/database";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { defined, iso } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { ApiError, notFound, rateLimited } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import type { Tx } from "../db/database.ts";
import { ObjectStore, UPLOAD_URL_SECONDS } from "../media/object-store.ts";
import { Outbox } from "../outbox/outbox.ts";
import type { ExportJobInput } from "../worker/exports.ts";
import { PermissionLedger } from "./permission-ledger.ts";
import { governing, stateAt } from "./permission-rules.ts";

type Purpose = z.output<typeof ExportPurpose>;
type Kind = z.output<typeof ExportKind>;

/** Export jobs are IMAGE_DERIVATIVE jobs with this key prefix (ADR-0027). */
export const exportJobKey = (exportId: string) => `export:${exportId}`;

/** At most this many export requests per user in any window, per api process (spec §6.1 rate limits). */
const EXPORTS_PER_WINDOW = 30;
const WINDOW_MS = 10 * 60_000;

const INCLUDE = {
  storageObject: { select: { status: true, objectKey: true, contentType: true } },
  generatedByJob: { select: { status: true, errorCode: true, resultSummary: true, inputSummary: true } },
  mediaReleases: {
    select: { id: true, purpose: true, releasedById: true, releasedAt: true, revokedAt: true },
  },
} as const;

type ExportRow = {
  id: string;
  patientId: string;
  kind: Kind;
  sourcePhotoId: string;
  beforeAfterSetId: string | null;
  annotationId: string | null;
  createdAt: Date;
  storageObject: { status: string; objectKey: string; contentType: string };
  generatedByJob: {
    status: string;
    errorCode: string | null;
    resultSummary: unknown;
    inputSummary: unknown;
  } | null;
  mediaReleases: {
    id: string;
    purpose: Purpose;
    releasedById: string;
    releasedAt: Date;
    revokedAt: Date | null;
  }[];
};

type Photo = { id: string; status: string; photoSessionId: string | null };

function exportStatus(row: ExportRow): z.input<typeof MediaExport>["status"] {
  const release = row.mediaReleases[0];
  if (release === undefined || release.revokedAt !== null) return "REVOKED";
  const job = row.generatedByJob;
  if (job?.status === "SUCCEEDED" && row.storageObject.status === "AVAILABLE") return "READY";
  if (job === null || ["FAILED", "TIMED_OUT", "CANCELLED"].includes(job.status)) return "FAILED";
  return "PENDING";
}

function photoIdsOf(row: ExportRow): string[] {
  return (row.generatedByJob?.inputSummary as ExportJobInput | null)?.photoIds ?? [row.sourcePhotoId];
}

function exportDto(row: ExportRow): z.input<typeof MediaExport> {
  const release = row.mediaReleases[0];
  const status = exportStatus(row);
  const result = (row.generatedByJob?.resultSummary ?? null) as {
    widthPx?: number;
    heightPx?: number;
  } | null;
  return {
    id: row.id,
    purpose: release?.purpose ?? "CLINICAL_USE",
    kind: row.kind,
    status,
    photoIds: photoIdsOf(row),
    mediaReleaseId: release?.id ?? row.id,
    requestedByUserId: release?.releasedById ?? "",
    requestedAt: iso(release?.releasedAt ?? row.createdAt),
    ...defined({
      beforeAfterSetId: row.beforeAfterSetId,
      annotationId: row.annotationId,
      widthPx: status === "READY" ? (result?.widthPx ?? null) : null,
      heightPx: status === "READY" ? (result?.heightPx ?? null) : null,
      failure:
        status === "FAILED"
          ? row.generatedByJob?.errorCode === "SOURCE_CHANGED"
            ? "SOURCE_CHANGED"
            : "RENDER_FAILED"
          : null,
      revokedAt: release?.revokedAt && iso(release.revokedAt),
    }),
  };
}

function notGranted(purpose: Purpose, photoIds: readonly string[]): ApiError {
  return new ApiError(
    "MEDIA_PERMISSION_NOT_GRANTED",
    photoIds.length > 1
      ? `The patient has not granted ${purpose} for both photos.`
      : `The patient has not granted ${purpose} for this photo.`,
    { category: purpose },
  );
}

@Injectable()
export class ExportsService implements OnModuleInit {
  private readonly requests = new Map<string, number[]>();

  constructor(
    private readonly audit: AuditWriter,
    private readonly idempotency: Idempotency,
    private readonly ledger: PermissionLedger,
    private readonly outbox: Outbox,
    private readonly store: ObjectStore,
  ) {}

  onModuleInit(): void {
    for (const operationId of ["createPhotoExport", "createBeforeAfterExport"])
      this.idempotency.register(operationId, async (ctx, id) => ({
        data: exportDto(await this.export(requireTx(ctx), ctx.params.patientId ?? "", id)),
        resource: { type: "PhotoDerivative", id },
      }));
  }

  /** A sliding window per user, as for patient search. */
  private rateLimit(userId: string): void {
    const now = Date.now();
    const recent = (this.requests.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= EXPORTS_PER_WINDOW) {
      this.requests.set(userId, recent);
      throw rateLimited(((recent[0] ?? now) + WINDOW_MS - now) / 1000);
    }
    recent.push(now);
    if (!this.requests.has(userId) && this.requests.size > 50_000) this.requests.clear();
    this.requests.set(userId, recent);
  }

  private async export(tx: Tx, patientId: string, id: string): Promise<ExportRow> {
    const row = await tx.photoDerivative.findFirst({
      where: { id, patientId, kind: { in: [...EXPORT_KINDS] } },
      include: INCLUDE,
    });
    if (row === null) throw notFound("EXPORT_NOT_FOUND");
    return row as unknown as ExportRow;
  }

  /** The permission version that grants `purpose` for each photo, or 403. */
  private async grants(
    tx: Tx,
    patientId: string,
    purpose: Purpose,
    photos: readonly Photo[],
  ): Promise<string[]> {
    const rows = await this.ledger.current(tx, patientId, purpose);
    const now = new Date();
    const pinned = new Set<string>();
    for (const photo of photos) {
      const row = governing(rows, photo);
      if (row === undefined || stateAt(row, now) !== "GRANTED")
        throw notGranted(
          purpose,
          photos.map((p) => p.id),
        );
      pinned.add(row.id);
    }
    return [...pinned];
  }

  private requireAccepted(photos: readonly Photo[]): void {
    if (photos.some((p) => p.status !== "ACCEPTED"))
      throw new ApiError("INVALID_STATE_TRANSITION", "Only accepted, unarchived photos can be exported.");
  }

  async createForPhoto(
    ctx: RequestContext,
    patientId: string,
    photoId: string,
    body: z.output<typeof PhotoExportCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const photo = await tx.patientPhoto.findFirst({
      where: { id: photoId, patientId, status: { not: "UPLOAD_PENDING" } },
      select: { id: true, status: true, photoSessionId: true },
    });
    if (photo === null) throw notFound("PHOTO_NOT_FOUND");
    this.requireAccepted([photo]);
    let annotation: { id: string; version: number } | null = null;
    if (body.annotationId !== undefined) {
      annotation = await tx.photoAnnotation.findFirst({
        where: { id: body.annotationId, photoId, deletedAt: null },
        select: { id: true, version: true },
      });
      if (annotation === null)
        throw new ApiError("VALIDATION_FAILED", undefined, {
          fieldErrors: [
            {
              path: "annotationId",
              code: "UNKNOWN_ANNOTATION",
              message: "Choose one of this photo's annotation layers.",
            },
          ],
        });
    }
    const permissionIds = await this.grants(tx, patientId, body.purpose, [photo]);
    const kind: Kind =
      annotation !== null
        ? "ANNOTATED_DERIVATIVE"
        : MARKETING_EXPORT_PURPOSES.includes(body.purpose)
          ? "MARKETING_DERIVATIVE"
          : "EXPORT_DERIVATIVE";
    return this.start(ctx, patientId, body.purpose, kind, [photo], permissionIds, {
      layout: "SINGLE",
      annotation,
      set: null,
    });
  }

  async createForSet(
    ctx: RequestContext,
    patientId: string,
    setId: string,
    purpose: Purpose,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const set = await tx.beforeAfterSet.findFirst({
      where: { id: setId, patientId },
      select: {
        id: true,
        version: true,
        registrationTransform: true,
        beforePhoto: { select: { id: true, status: true, photoSessionId: true } },
        afterPhoto: { select: { id: true, status: true, photoSessionId: true } },
      },
    });
    if (set === null) throw notFound("BEFORE_AFTER_SET_NOT_FOUND");
    const photos = [set.beforePhoto, set.afterPhoto];
    this.requireAccepted(photos);
    const permissionIds = await this.grants(tx, patientId, purpose, photos);
    return this.start(ctx, patientId, purpose, "BEFORE_AFTER_DERIVATIVE", photos, permissionIds, {
      layout: "SIDE_BY_SIDE",
      annotation: null,
      set: {
        id: set.id,
        version: set.version,
        transform: (set.registrationTransform ?? null) as ExportJobInput["transform"],
      },
    });
  }

  /** The request transaction (K3-15): object, derivative, release with its pins, job, audit. */
  private async start(
    ctx: RequestContext,
    patientId: string,
    purpose: Purpose,
    kind: Kind,
    photos: readonly Photo[],
    permissionIds: readonly string[],
    source: {
      layout: ExportJobInput["layout"];
      annotation: { id: string; version: number } | null;
      set: { id: string; version: number; transform: ExportJobInput["transform"] } | null;
    },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    const userId = requireAuth(ctx).userId;
    this.rateLimit(userId);
    const exportId = uuidv7();
    const objectId = uuidv7();
    const jobId = uuidv7();
    const releaseId = uuidv7();
    await tx.storageObject.create({
      data: {
        id: objectId,
        organizationId,
        objectClass: "CLINICAL_DERIVATIVE",
        bucket: this.store.bucket,
        objectKey: this.store.newKey("CLINICAL_DERIVATIVE"),
        contentType: "image/jpeg",
        status: "PENDING_UPLOAD",
        // Rendered by the platform from scanned originals (K2-04).
        scanStatus: "NOT_REQUIRED",
        kmsKeyAlias: this.store.kmsKeyId,
      },
    });
    const input: ExportJobInput = {
      exportId,
      releaseId,
      objectId,
      layout: source.layout,
      photoIds: photos.map((p) => p.id),
      ...(source.annotation !== null
        ? { annotationId: source.annotation.id, annotationVersion: source.annotation.version }
        : {}),
      ...(source.set !== null ? { setId: source.set.id } : {}),
      transform: source.set?.transform ?? null,
    };
    await tx.aIJob.create({
      data: {
        id: jobId,
        organizationId,
        patientId,
        jobType: "IMAGE_DERIVATIVE",
        status: "QUEUED",
        idempotencyKey: exportJobKey(exportId),
        requestedById: userId,
        inputSummary: input,
      },
    });
    const [first] = photos;
    await tx.photoDerivative.create({
      data: {
        id: exportId,
        organizationId,
        patientId,
        // A composite's frame is its before photo (ADR-0027).
        sourcePhotoId: first?.id ?? "",
        kind,
        storageObjectId: objectId,
        generatedByJobId: jobId,
        beforeAfterSetId: source.set?.id ?? null,
        annotationId: source.annotation?.id ?? null,
        createdById: userId,
        generationMetadata: {
          layout: source.layout,
          maxEdgePx: EXPORT_MAX_EDGE_PX,
          format: "image/jpeg",
          metadataStripped: true,
          ...(source.annotation !== null ? { annotationVersion: source.annotation.version } : {}),
          ...(source.set !== null ? { setVersion: source.set.version, transform: source.set.transform } : {}),
        },
      },
    });
    await tx.mediaRelease.create({
      data: {
        id: releaseId,
        organizationId,
        patientId,
        purpose,
        derivativeId: exportId,
        releasedById: userId,
      },
    });
    // The pins are checked at commit: a release without one cannot exist (R15).
    await tx.mediaReleasePermission.createMany({
      data: permissionIds.map((permissionId) => ({
        organizationId,
        patientId,
        mediaReleaseId: releaseId,
        permissionId,
      })),
    });
    await this.outbox.add(tx, {
      organizationId,
      eventType: "image.export.requested",
      aggregateId: jobId,
      payload: { jobId, attempt: 1 },
    });
    await this.audit.writeMany(
      tx,
      ctx,
      photos.map((p) => ({
        action: "PHOTO_EXPORTED" as const,
        resourceType: "PatientPhoto",
        resourceId: p.id,
        patientId,
        metadata: { purpose, kind, exportId, mediaReleaseId: releaseId },
      })),
    );
    return {
      data: exportDto(await this.export(tx, patientId, exportId)),
      resource: { type: "PhotoDerivative", id: exportId },
    };
  }

  async get(ctx: RequestContext, patientId: string, exportId: string): Promise<OperationResult> {
    return { data: exportDto(await this.export(requireTx(ctx), patientId, exportId)) };
  }

  /** A signed GET while the export is ready, its release active and every grant current. */
  async accessUrl(ctx: RequestContext, patientId: string, exportId: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const row = await this.export(tx, patientId, exportId);
    const release = row.mediaReleases[0];
    const photoIds = photoIdsOf(row);
    if (release === undefined || release.revokedAt !== null)
      throw new ApiError(
        "MEDIA_PERMISSION_NOT_GRANTED",
        "The export's release was revoked, so it can no longer be downloaded.",
        { category: release?.purpose ?? null },
      );
    const status = exportStatus(row);
    if (status !== "READY")
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        status === "FAILED" ? "The export failed; no file was produced." : "The export is not ready yet.",
      );
    const photos = await tx.patientPhoto.findMany({
      where: { id: { in: photoIds }, patientId },
      select: { id: true, status: true, photoSessionId: true },
    });
    await this.grants(tx, patientId, release.purpose, photos);
    const signed = await this.store.presignDownload({
      key: row.storageObject.objectKey,
      contentType: row.storageObject.contentType,
      fileName: "export.jpg",
      seconds: UPLOAD_URL_SECONDS,
    });
    await this.audit.writeMany(
      tx,
      ctx,
      photoIds.map((id) => ({
        action: "PHOTO_VIEWED" as const,
        resourceType: "PatientPhoto",
        resourceId: id,
        patientId,
        metadata: { variant: "EXPORT", exportId, purpose: release.purpose },
      })),
    );
    const data: z.input<typeof ExportAccessUrl> = {
      exportId,
      url: signed.url,
      expiresAt: iso(signed.expiresAt),
    };
    return { data };
  }
}
