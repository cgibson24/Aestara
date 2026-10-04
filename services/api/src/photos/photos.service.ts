// Photo sessions and photos (spec §6.3 "Photography", §6.1.8, §6.1.9, §6.6.2;
// Bible §6.1–6.6; ADR-0023 K2-02 to K2-05, K2-13, K2-14). Patient data: every
// query runs in the caller's tenant transaction. Nothing becomes visible before
// its upload is verified, and nothing is served before its scan is clean.
import {
  type AccessUrl,
  type BatchAccessUrlRequest,
  type BatchAccessUrls,
  PHOTO_MAX_BYTES,
  type Photo,
  type PhotoSession,
  type PhotoSessionCreate,
  type PhotoUploadIntent,
  type PhotoUploadRequest,
} from "@aestara/api-contracts";
import { uuidv7 } from "@aestara/database";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { defined, iso, lockRow } from "../common/concurrency.ts";
import {
  grantsWith,
  type RequestContext,
  requireAuth,
  requireOrganization,
  requireTx,
} from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { ApiError, notFound } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import { requireScopedPermission } from "../common/scope.ts";
import { inOrder, type Tx } from "../db/database.ts";
import { extensionFor, matchesSignature } from "../media/formats.ts";
import { hexToBase64, ObjectStore } from "../media/object-store.ts";
import { Outbox } from "../outbox/outbox.ts";
import { PhotoIntake } from "./intake.ts";

type PhotoStatus =
  | "UPLOAD_PENDING"
  | "QUARANTINED"
  | "PENDING_REVIEW"
  | "ACCEPTED"
  | "RETAKE_REQUESTED"
  | "REJECTED"
  | "ARCHIVED";

/** A view counts as captured once a verified photo of it is accepted or being checked (K2-13). */
const CAPTURED: readonly PhotoStatus[] = ["QUARANTINED", "ACCEPTED"];
/** Listed by default (K2-14): accepted photos and those being checked. Uploads still pending never are. */
const LISTED: readonly PhotoStatus[] = ["QUARANTINED", "ACCEPTED"];
const SERVABLE: readonly PhotoStatus[] = ["ACCEPTED", "ARCHIVED"];
const DERIVATIVES = ["THUMBNAIL", "DISPLAY_PREVIEW"] as const;
/** Clock skew tolerated for device timestamps. */
const SKEW_MS = 5 * 60_000;
/** Offline capture is bounded by the session's absolute lifetime (K2-17). */
const OFFLINE_WINDOW_MS = 8 * 24 * 60 * 60_000;

const PHOTO_INCLUDE = {
  original: {
    select: { contentType: true, byteSize: true, sha256: true, scanStatus: true, objectKey: true },
  },
  derivatives: { select: { kind: true, storageObjectId: true, generationMetadata: true } },
  tags: { select: { tag: true }, orderBy: { tag: "asc" as const } },
} as const;

type PhotoRow = {
  id: string;
  organizationId: string;
  patientId: string;
  photoSessionId: string | null;
  viewKey: string | null;
  source: "PROVIDER_CAPTURE" | "PATIENT_UPLOAD" | "IMPORT";
  status: PhotoStatus;
  originalObjectId: string;
  capturedByUserId: string | null;
  capturedAt: Date;
  widthPx: number | null;
  heightPx: number | null;
  captureMetadata: unknown;
  qualityChecks: unknown;
  positionMatchScore: { toNumber(): number } | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  original: {
    contentType: string;
    byteSize: bigint | null;
    sha256: string | null;
    scanStatus: string;
    objectKey: string;
  };
  derivatives: { kind: string; storageObjectId: string; generationMetadata: unknown }[];
  tags: { tag: string }[];
};

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

function verificationFailed(reason: string, message: string): ApiError {
  return new ApiError("UPLOAD_VERIFICATION_FAILED", message, { reason });
}

@Injectable()
export class PhotosService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
    private readonly idempotency: Idempotency,
    private readonly store: ObjectStore,
    private readonly outbox: Outbox,
    private readonly intake: PhotoIntake,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("createPhotoSession", async (ctx, id) => ({
      data: await this.sessionDto(
        requireTx(ctx),
        await this.session(requireTx(ctx), ctx.params.patientId ?? "", id),
      ),
      resource: { type: "PhotoSession", id },
    }));
    this.idempotency.register("createPhotoUpload", async (ctx, id) => ({
      data: await this.intent(await this.photo(requireTx(ctx), ctx.params.patientId ?? "", id)),
      resource: { type: "PatientPhoto", id },
    }));
    this.idempotency.register("completePhotoUpload", async (ctx, id) => ({
      data: await this.photoDto(
        requireTx(ctx),
        await this.photo(requireTx(ctx), ctx.params.patientId ?? "", id),
      ),
      resource: { type: "PatientPhoto", id },
    }));
  }

  // ---- Loading ------------------------------------------------------------------

  private async patient(tx: Tx, patientId: string): Promise<{ status: string }> {
    const p = await tx.patient.findUnique({ where: { id: patientId }, select: { status: true } });
    if (p === null) throw notFound("PATIENT_NOT_FOUND");
    return p;
  }

  private async session(tx: Tx, patientId: string, sessionId: string) {
    const s = await tx.photoSession.findFirst({
      where: { id: sessionId, patientId },
      include: { protocol: { include: { views: { orderBy: { sortOrder: "asc" } } } } },
    });
    if (s === null) throw notFound("PHOTO_SESSION_NOT_FOUND");
    return s;
  }

  private async photo(tx: Tx, patientId: string, photoId: string): Promise<PhotoRow> {
    const p = await tx.patientPhoto.findFirst({ where: { id: photoId, patientId }, include: PHOTO_INCLUDE });
    // A photo whose bytes never arrived is not visible to anyone (spec §6.1.9) except its own upload steps.
    if (p === null) throw notFound("PHOTO_NOT_FOUND");
    return p as unknown as PhotoRow;
  }

  /**
   * photo.capture over the session's practice (and location) when the caller's
   * capture grants are practice- or location-scoped (K2-13).
   */
  private requireCaptureScope(
    ctx: RequestContext,
    practiceId: string | null,
    locationId: string | null,
  ): void {
    const auth = requireAuth(ctx);
    if (grantsWith(auth, "photo.capture").some((g) => g.scope === "ORGANIZATION")) return;
    if (practiceId === null)
      throw invalid("practiceId", "REQUIRED", "Choose the practice where these photos are taken.");
    requireScopedPermission(auth, "photo.capture", {
      scope: locationId === null ? "PRACTICE" : "LOCATION",
      practiceId,
      locationId,
    });
  }

  // ---- DTOs -----------------------------------------------------------------------

  private async sessionDto(
    tx: Tx,
    s: Awaited<ReturnType<PhotosService["session"]>>,
  ): Promise<z.input<typeof PhotoSession>> {
    const counts = await tx.patientPhoto.groupBy({
      by: ["viewKey"],
      where: { photoSessionId: s.id, status: { in: [...CAPTURED] } },
      _count: { _all: true },
    });
    const byView = new Map(counts.map((c) => [c.viewKey ?? "", c._count._all]));
    const views = s.protocol.views.map((v) => ({
      viewKey: v.viewKey,
      name: v.name,
      sortOrder: v.sortOrder,
      isRequired: v.isRequired,
      captured: (byView.get(v.viewKey) ?? 0) > 0,
      photoCount: byView.get(v.viewKey) ?? 0,
    }));
    return {
      id: s.id,
      patientId: s.patientId,
      protocolId: s.protocolId,
      protocolName: s.protocol.name,
      source: s.source,
      status: s.status,
      views,
      missingRequiredViews: views.filter((v) => v.isRequired && !v.captured).map((v) => v.viewKey),
      ...defined({
        capturedByUserId: s.capturedByUserId,
        practiceId: s.practiceId,
        locationId: s.locationId,
        consultationId: s.consultationId,
        completedAt: s.completedAt && iso(s.completedAt),
      }),
      startedAt: iso(s.startedAt),
      createdAt: iso(s.createdAt),
      updatedAt: iso(s.updatedAt),
    };
  }

  private async derivativeJobFailed(tx: Tx, photoId: string): Promise<boolean> {
    const job = await tx.aIJob.findFirst({
      where: { jobType: "IMAGE_DERIVATIVE", idempotencyKey: `derivatives:${photoId}` },
      select: { status: true },
    });
    return job?.status === "FAILED";
  }

  async photoDto(tx: Tx, p: PhotoRow): Promise<z.input<typeof Photo>> {
    const failed =
      p.status === "ACCEPTED" || p.status === "ARCHIVED" ? await this.derivativeJobFailed(tx, p.id) : false;
    const derivatives =
      p.status === "UPLOAD_PENDING" || p.status === "REJECTED"
        ? []
        : DERIVATIVES.map((kind) => {
            const row = p.derivatives.find((d) => d.kind === kind);
            const meta = (row?.generationMetadata ?? {}) as { widthPx?: number; heightPx?: number };
            return {
              kind,
              status: row ? ("AVAILABLE" as const) : failed ? ("FAILED" as const) : ("PENDING" as const),
              ...defined({ widthPx: meta.widthPx ?? null, heightPx: meta.heightPx ?? null }),
            };
          });
    const scanStatus = p.original.scanStatus as z.input<typeof Photo>["scanStatus"];
    return {
      id: p.id,
      patientId: p.patientId,
      source: p.source,
      status: p.status,
      capturedAt: iso(p.capturedAt),
      contentType: p.original.contentType,
      scanStatus,
      derivatives,
      tags: p.tags.map((t) => t.tag),
      ...defined({
        photoSessionId: p.photoSessionId,
        viewKey: p.viewKey,
        capturedByUserId: p.capturedByUserId,
        byteSize: p.original.byteSize === null ? null : Number(p.original.byteSize),
        sha256: p.original.sha256,
        widthPx: p.widthPx,
        heightPx: p.heightPx,
        captureMetadata: (p.captureMetadata ?? null) as z.input<typeof Photo>["captureMetadata"] | null,
        qualityChecks: (p.qualityChecks ?? null) as z.input<typeof Photo>["qualityChecks"] | null,
        positionMatchScore: p.positionMatchScore?.toNumber() ?? null,
        rejectionReason:
          p.status !== "REJECTED"
            ? null
            : scanStatus === "INFECTED"
              ? ("MALWARE_DETECTED" as const)
              : ("SCAN_FAILED" as const),
        archivedAt: p.archivedAt && iso(p.archivedAt),
      }),
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    };
  }

  private async intent(p: PhotoRow): Promise<z.input<typeof PhotoUploadIntent>> {
    if (p.status !== "UPLOAD_PENDING") return { photoId: p.id, status: p.status };
    const signed = await this.store.presignUpload({
      key: p.original.objectKey,
      contentType: p.original.contentType,
      ...(p.original.sha256 !== null ? { sha256Hex: p.original.sha256 } : {}),
    });
    return {
      photoId: p.id,
      status: p.status,
      upload: { method: "PUT", url: signed.url, expiresAt: iso(signed.expiresAt), headers: signed.headers },
    };
  }

  // ---- Sessions ----------------------------------------------------------------------

  async listSessions(
    ctx: RequestContext,
    patientId: string,
    query: {
      limit: number;
      cursor?: string;
      status?: "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
      consultationId?: string;
    },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const after = this.cursors.decode("photo-sessions", query.cursor);
    const rows = await tx.photoSession.findMany({
      where: {
        patientId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.consultationId ? { consultationId: query.consultationId } : {}),
        ...(after
          ? {
              OR: [
                { startedAt: { lt: new Date(after.k ?? 0) } },
                { startedAt: new Date(after.k ?? 0), id: { lt: after.id } },
              ],
            }
          : {}),
      },
      include: { protocol: { include: { views: { orderBy: { sortOrder: "asc" } } } } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows, query.limit, (s) =>
      this.cursors.encode("photo-sessions", { k: s.startedAt.toISOString(), id: s.id }),
    );
    return { data: await inOrder(items, (s) => this.sessionDto(tx, s)), page };
  }

  async getSession(ctx: RequestContext, patientId: string, sessionId: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    return { data: await this.sessionDto(tx, await this.session(tx, patientId, sessionId)) };
  }

  async createSession(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof PhotoSessionCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    const patient = await this.patient(tx, patientId);
    if (patient.status === "ARCHIVED")
      throw new ApiError("INVALID_STATE_TRANSITION", "Photos cannot be taken for an archived patient.");
    const protocol = await tx.photographyProtocol.findUnique({ where: { id: body.protocolId } });
    if (protocol === null || protocol.status !== "ACTIVE")
      throw invalid("protocolId", "PROTOCOL_NOT_ACTIVE", "Choose an active photography protocol.");
    let practiceId = body.practiceId ?? null;
    let locationId = body.locationId ?? null;
    // A session for a consultation takes its practice and location; capture then needs a grant
    // covering them (ADR-0026 K3-20). Photos join a consultation while it is under way (K3-09).
    if (body.consultationId !== undefined) {
      const consultation = await tx.consultation.findFirst({
        where: { id: body.consultationId, patientId },
        select: { practiceId: true, locationId: true, status: true },
      });
      if (consultation === null)
        throw invalid(
          "consultationId",
          "UNKNOWN_CONSULTATION",
          "Choose one of this patient's consultations.",
        );
      if (!["IN_PROGRESS", "AWAITING_INFORMATION"].includes(consultation.status))
        throw new ApiError(
          "INVALID_STATE_TRANSITION",
          "Photos join a consultation only while it is under way.",
        );
      if (practiceId !== null && practiceId !== consultation.practiceId)
        throw invalid("practiceId", "CONSULTATION_PRACTICE", "The consultation belongs to another practice.");
      practiceId = consultation.practiceId;
      locationId = locationId ?? consultation.locationId;
    }
    if (protocol.practiceId !== null) {
      if (practiceId !== null && practiceId !== protocol.practiceId)
        throw invalid("practiceId", "PROTOCOL_PRACTICE", "This protocol belongs to another practice.");
      practiceId = protocol.practiceId;
    }
    if (locationId !== null) {
      if (practiceId === null) throw invalid("practiceId", "REQUIRED", "A location needs its practice.");
      if ((await tx.location.count({ where: { id: locationId, practiceId } })) === 0)
        throw invalid("locationId", "UNKNOWN_LOCATION", "Choose one of the practice's locations.");
    }
    if (practiceId !== null && (await tx.practice.count({ where: { id: practiceId } })) === 0)
      throw invalid("practiceId", "UNKNOWN_PRACTICE", "Choose one of the organization's practices.");
    this.requireCaptureScope(ctx, practiceId, locationId);
    const now = Date.now();
    const startedAt = body.startedAt ? new Date(body.startedAt) : new Date(now);
    if (startedAt.getTime() > now + SKEW_MS || startedAt.getTime() < now - OFFLINE_WINDOW_MS)
      throw invalid("startedAt", "OUT_OF_RANGE", "The start time must be within the last 7 days.");
    const id = body.id ?? uuidv7();
    if ((await tx.photoSession.count({ where: { id } })) > 0) throw new ApiError("CONFLICT");
    try {
      await tx.photoSession.create({
        data: {
          id,
          organizationId,
          patientId,
          protocolId: protocol.id,
          source: "PROVIDER_CAPTURE",
          status: "IN_PROGRESS",
          capturedByUserId: requireAuth(ctx).userId,
          practiceId,
          locationId,
          consultationId: body.consultationId ?? null,
          startedAt,
        },
      });
    } catch (error) {
      // The ID is taken outside this organization: a generic conflict, nothing more (spec §6.1.8).
      if ((error as { code?: string }).code === "P2002") throw new ApiError("CONFLICT");
      throw error;
    }
    return {
      data: await this.sessionDto(tx, await this.session(tx, patientId, id)),
      resource: { type: "PhotoSession", id },
    };
  }

  async completeSession(
    ctx: RequestContext,
    patientId: string,
    sessionId: string,
    body: { acknowledgeMissingRequiredViews: boolean },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "PhotoSession", sessionId);
    const s = await this.session(tx, patientId, sessionId);
    this.requireCaptureScope(ctx, s.practiceId, s.locationId);
    if (s.status !== "IN_PROGRESS")
      throw new ApiError("INVALID_STATE_TRANSITION", "The session is already finished.");
    const dto = await this.sessionDto(tx, s);
    if (dto.missingRequiredViews.length > 0 && !body.acknowledgeMissingRequiredViews)
      throw new ApiError(
        "REQUIRED_VIEWS_MISSING",
        `${dto.missingRequiredViews.length} required ${dto.missingRequiredViews.length === 1 ? "view is" : "views are"} missing.`,
        { viewKeys: dto.missingRequiredViews },
      );
    await tx.photoSession.update({
      where: { id: s.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return { data: await this.sessionDto(tx, await this.session(tx, patientId, sessionId)) };
  }

  // ---- Uploads -------------------------------------------------------------------------

  async createUpload(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof PhotoUploadRequest>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    const auth = requireAuth(ctx);
    await this.patient(tx, patientId);
    const s = await tx.photoSession.findFirst({
      where: { id: body.photoSessionId, patientId },
      include: { protocol: { include: { views: true } } },
    });
    if (s === null)
      throw invalid("photoSessionId", "UNKNOWN_SESSION", "Choose one of this patient's photo sessions.");
    this.requireCaptureScope(ctx, s.practiceId, s.locationId);
    if (s.status !== "IN_PROGRESS")
      throw new ApiError("INVALID_STATE_TRANSITION", "The session is finished; start a new one.");
    const view = s.protocol.views.find((v) => v.viewKey === body.viewKey);
    if (view === undefined) throw invalid("viewKey", "UNKNOWN_VIEW", "Choose one of the protocol's views.");
    const capturedAt = new Date(body.capturedAt);
    const now = Date.now();
    if (capturedAt.getTime() > now + SKEW_MS || capturedAt.getTime() < s.startedAt.getTime() - SKEW_MS)
      throw invalid("capturedAt", "OUT_OF_RANGE", "The capture time must fall within the session.");
    const id = body.id ?? uuidv7();
    if ((await tx.patientPhoto.count({ where: { id } })) > 0) throw new ApiError("CONFLICT");
    const objectId = uuidv7();
    try {
      await tx.storageObject.create({
        data: {
          id: objectId,
          organizationId,
          objectClass: "CLINICAL_ORIGINAL",
          bucket: this.store.bucket,
          objectKey: this.store.newKey("CLINICAL_ORIGINAL"),
          contentType: body.contentType,
          byteSize: BigInt(body.byteSize),
          sha256: body.sha256,
          status: "PENDING_UPLOAD",
          scanStatus: "PENDING",
          kmsKeyAlias: this.store.kmsKeyId,
          uploadedById: auth.userId,
        },
      });
      await tx.patientPhoto.create({
        data: {
          id,
          organizationId,
          patientId,
          photoSessionId: s.id,
          protocolViewId: view.id,
          viewKey: view.viewKey,
          source: "PROVIDER_CAPTURE",
          status: "UPLOAD_PENDING",
          originalObjectId: objectId,
          capturedByUserId: auth.userId,
          capturedAt,
          widthPx: body.widthPx ?? null,
          heightPx: body.heightPx ?? null,
          ...(body.captureMetadata !== undefined ? { captureMetadata: body.captureMetadata } : {}),
          ...(body.qualityChecks !== undefined ? { qualityChecks: body.qualityChecks } : {}),
          positionMatchScore: body.captureMetadata?.positionMatchScore ?? null,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new ApiError("CONFLICT");
      throw error;
    }
    return {
      data: await this.intent(await this.photo(tx, patientId, id)),
      resource: { type: "PatientPhoto", id },
    };
  }

  /**
   * Verifies the uploaded original (spec §6.1.9; K2-03): it exists, has the
   * declared size and SHA-256, and its first bytes match its declared type.
   * The photo then waits in QUARANTINED for its scan, unless the scan result
   * already arrived.
   */
  async completeUpload(ctx: RequestContext, patientId: string, photoId: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "PatientPhoto", photoId);
    const p = await this.photo(tx, patientId, photoId);
    const s = p.photoSessionId
      ? await tx.photoSession.findUnique({
          where: { id: p.photoSessionId },
          select: { practiceId: true, locationId: true },
        })
      : null;
    this.requireCaptureScope(ctx, s?.practiceId ?? null, s?.locationId ?? null);
    if (p.status !== "UPLOAD_PENDING")
      throw new ApiError("INVALID_STATE_TRANSITION", "This upload was already completed.");
    const declaredSize = Number(p.original.byteSize ?? -1);
    const stored = await this.store.head(p.original.objectKey);
    if (stored === undefined)
      throw verificationFailed("NOT_UPLOADED", "No file was uploaded for this photo.");
    if (stored.byteSize > PHOTO_MAX_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE");
    if (stored.byteSize !== declaredSize)
      throw verificationFailed("SIZE_MISMATCH", "The uploaded file does not have the declared size.");
    const declared = p.original.sha256 ?? "";
    const verified =
      stored.sha256Base64 !== undefined
        ? stored.sha256Base64 === hexToBase64(declared)
        : (await this.store.sha256Hex(p.original.objectKey)) === declared;
    if (!verified)
      throw verificationFailed("CHECKSUM_MISMATCH", "The uploaded file does not match its checksum.");
    if (!matchesSignature(p.original.contentType, await this.store.firstBytes(p.original.objectKey)))
      throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "The file is not the image type it was declared as.");

    const object = await tx.storageObject.update({
      where: { id: p.originalObjectId },
      data: { status: "QUARANTINED", verifiedAt: new Date() },
      select: { scanStatus: true },
    });
    await tx.patientPhoto.update({ where: { id: p.id }, data: { status: "QUARANTINED" } });
    await this.audit.write(tx, ctx, {
      action: "PHOTO_CAPTURED",
      resourceType: "PatientPhoto",
      resourceId: p.id,
      patientId,
      metadata: { viewKey: p.viewKey, photoSessionId: p.photoSessionId },
    });
    await this.outbox.add(tx, {
      organizationId: p.organizationId,
      eventType: "photo.captured",
      aggregateId: p.id,
      payload: { photoId: p.id, patientId },
    });
    // The scan may have finished first (it starts when the bytes land in S3).
    if (object.scanStatus === "CLEAN" || object.scanStatus === "INFECTED" || object.scanStatus === "ERROR")
      await this.intake.apply(tx, ctx, p, object.scanStatus);
    return {
      data: await this.photoDto(tx, await this.photo(tx, patientId, photoId)),
      resource: { type: "PatientPhoto", id: photoId },
    };
  }

  // ---- Reading and viewing ---------------------------------------------------------------

  async list(
    ctx: RequestContext,
    patientId: string,
    query: {
      limit: number;
      cursor?: string;
      photoSessionId?: string;
      viewKey?: string;
      status?: "QUARANTINED" | "ACCEPTED" | "REJECTED" | "ARCHIVED";
      includeArchived: boolean;
    },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const statuses: PhotoStatus[] = query.status
      ? [query.status]
      : [...LISTED, ...(query.includeArchived ? (["ARCHIVED"] as const) : [])];
    const after = this.cursors.decode("photos", query.cursor);
    const rows = await tx.patientPhoto.findMany({
      where: {
        patientId,
        status: { in: statuses },
        ...(query.photoSessionId ? { photoSessionId: query.photoSessionId } : {}),
        ...(query.viewKey ? { viewKey: query.viewKey } : {}),
        ...(after
          ? {
              OR: [
                { capturedAt: { lt: new Date(after.k ?? 0) } },
                { capturedAt: new Date(after.k ?? 0), id: { lt: after.id } },
              ],
            }
          : {}),
      },
      include: PHOTO_INCLUDE,
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows as unknown as PhotoRow[], query.limit, (p) =>
      this.cursors.encode("photos", { k: p.capturedAt.toISOString(), id: p.id }),
    );
    return { data: await inOrder(items, (p) => this.photoDto(tx, p)), page };
  }

  async get(ctx: RequestContext, patientId: string, photoId: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const p = await this.photo(tx, patientId, photoId);
    if (p.status === "UPLOAD_PENDING") throw notFound("PHOTO_NOT_FOUND");
    return { data: await this.photoDto(tx, p) };
  }

  private async variantObject(
    tx: Tx,
    p: PhotoRow,
    variant: "ORIGINAL" | "THUMBNAIL" | "DISPLAY_PREVIEW",
  ): Promise<{ key: string; contentType: string } | undefined> {
    if (variant === "ORIGINAL") return { key: p.original.objectKey, contentType: p.original.contentType };
    const derivative = p.derivatives.find((d) => d.kind === variant);
    if (derivative === undefined) return undefined;
    const object = await tx.storageObject.findUnique({
      where: { id: derivative.storageObjectId },
      select: { objectKey: true, contentType: true, status: true },
    });
    return object?.status === "AVAILABLE"
      ? { key: object.objectKey, contentType: object.contentType }
      : undefined;
  }

  async accessUrl(
    ctx: RequestContext,
    patientId: string,
    photoId: string,
    variant: "ORIGINAL" | "THUMBNAIL" | "DISPLAY_PREVIEW",
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const p = await this.photo(tx, patientId, photoId);
    if (p.status === "UPLOAD_PENDING") throw notFound("PHOTO_NOT_FOUND");
    // ORIGINAL bytes need photo.export, never a role check (spec §6.3).
    if (variant === "ORIGINAL" && !requireAuth(ctx).permissions.has("photo.export"))
      throw new ApiError("PERMISSION_DENIED", "Viewing the original needs the photo.export permission.");
    if (!SERVABLE.includes(p.status))
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        p.status === "REJECTED"
          ? "This photo was blocked by the malware scan."
          : "This photo is still being checked.",
      );
    const object = await this.variantObject(tx, p, variant);
    if (object === undefined)
      throw new ApiError("INVALID_STATE_TRANSITION", "This view of the photo is not ready yet.");
    const signed = await this.store.presignDownload({
      key: object.key,
      contentType: object.contentType,
      fileName: `photo-${variant.toLowerCase().replace("_", "-")}.${extensionFor(object.contentType)}`,
    });
    await this.audit.write(tx, ctx, {
      action: "PHOTO_VIEWED",
      resourceType: "PatientPhoto",
      resourceId: p.id,
      patientId,
      metadata: { variant },
    });
    const data: z.input<typeof AccessUrl> = {
      photoId: p.id,
      variant,
      url: signed.url,
      expiresAt: iso(signed.expiresAt),
    };
    return { data };
  }

  async accessUrls(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof BatchAccessUrlRequest>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const rows = (await tx.patientPhoto.findMany({
      where: { id: { in: body.photoIds }, patientId },
      include: PHOTO_INCLUDE,
    })) as unknown as PhotoRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const data: z.input<typeof BatchAccessUrls> = { urls: [], unavailable: [] };
    const viewed: string[] = [];
    for (const photoId of body.photoIds) {
      const p = byId.get(photoId);
      if (p === undefined || p.status === "UPLOAD_PENDING") {
        data.unavailable.push({ photoId, reason: "NOT_FOUND" });
        continue;
      }
      const object = SERVABLE.includes(p.status) ? await this.variantObject(tx, p, body.variant) : undefined;
      if (object === undefined) {
        data.unavailable.push({ photoId, reason: "NOT_READY" });
        continue;
      }
      const signed = await this.store.presignDownload({
        key: object.key,
        contentType: object.contentType,
        fileName: `photo-${body.variant.toLowerCase().replace("_", "-")}.jpg`,
      });
      data.urls.push({ photoId, variant: body.variant, url: signed.url, expiresAt: iso(signed.expiresAt) });
      viewed.push(photoId);
    }
    await this.audit.writeMany(
      tx,
      ctx,
      viewed.map((id) => ({
        action: "PHOTO_VIEWED" as const,
        resourceType: "PatientPhoto",
        resourceId: id,
        patientId,
        metadata: { variant: body.variant, batch: true },
      })),
    );
    return { data };
  }

  // ---- Tags and archive ----------------------------------------------------------------------

  async replaceTags(
    ctx: RequestContext,
    patientId: string,
    photoId: string,
    tags: readonly string[],
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "PatientPhoto", photoId);
    const p = await this.photo(tx, patientId, photoId);
    if (p.status === "UPLOAD_PENDING") throw notFound("PHOTO_NOT_FOUND");
    if (p.status === "REJECTED")
      throw new ApiError("INVALID_STATE_TRANSITION", "A blocked photo cannot be tagged.");
    await tx.photoTag.deleteMany({ where: { photoId } });
    if (tags.length > 0)
      await tx.photoTag.createMany({
        data: tags.map((tag) => ({
          organizationId: p.organizationId,
          patientId,
          photoId,
          tag,
          createdById: requireAuth(ctx).userId,
        })),
      });
    return { data: await this.photoDto(tx, await this.photo(tx, patientId, photoId)) };
  }

  async archive(ctx: RequestContext, patientId: string, photoId: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "PatientPhoto", photoId);
    const p = await this.photo(tx, patientId, photoId);
    if (p.status === "UPLOAD_PENDING") throw notFound("PHOTO_NOT_FOUND");
    if (p.status !== "ACCEPTED")
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        p.status === "ARCHIVED"
          ? "The photo is already archived."
          : "Only an accepted photo can be archived.",
      );
    await tx.patientPhoto.update({
      where: { id: photoId },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    await this.audit.write(tx, ctx, {
      action: "PHOTO_ARCHIVED",
      resourceType: "PatientPhoto",
      resourceId: photoId,
      patientId,
    });
    return { data: await this.photoDto(tx, await this.photo(tx, patientId, photoId)) };
  }
}
