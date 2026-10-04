// Before/after sets (spec §6.3 "Before / after"; Bible §8.1, §34.1 #12–14, #20;
// ADR-0026 K3-11 to K3-13, K3-20). Exactly two accepted, unarchived photos of
// one patient with the same view, the before one captured earlier. A photo
// that does not exist, belongs to another patient or another tenant answers
// the same 404, so nothing reveals that it exists. Organization-owned patient
// data: any grant in the organization applies. The originals are never read
// or changed; alignment is a display-time transform.
import type {
  BeforeAfterSet,
  BeforeAfterSetCreate,
  BeforeAfterSetUpdate,
  RegistrationTransform,
} from "@aestara/api-contracts";
import { Prisma, uuidv7 } from "@aestara/database";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { checkVersion, defined, iso, lockRow } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { ApiError, notFound } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import type { Tx } from "../db/database.ts";
import { Outbox } from "../outbox/outbox.ts";
import { resolveFlag } from "../settings/configuration.service.ts";

type SetRow = {
  id: string;
  patientId: string;
  beforePhotoId: string;
  afterPhotoId: string;
  consultationId: string | null;
  viewKey: string | null;
  title: string | null;
  registrationMode: "NONE" | "AUTOMATIC" | "MANUAL";
  registrationTransform: unknown;
  registrationJob: { status: string; errorCode: string | null } | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

const INCLUDE = { registrationJob: { select: { status: true, errorCode: true } } } as const;

type Pose = { subject?: unknown; yawDeg?: unknown } | null;

/** Same view key and the same pose target, subject and target yaw (ADR-0026 K3-11). */
export function compatibleViews(
  a: { viewKey: string | null; pose: Pose },
  b: { viewKey: string | null; pose: Pose },
): boolean {
  if (a.viewKey === null || a.viewKey !== b.viewKey) return false;
  if (a.pose === null || b.pose === null) return a.pose === b.pose;
  return a.pose.subject === b.pose.subject && a.pose.yawDeg === b.pose.yawDeg;
}

function jobDto(job: SetRow["registrationJob"]): z.input<typeof BeforeAfterSet>["registrationJob"] {
  if (job === null) return undefined;
  switch (job.status) {
    case "QUEUED":
    case "RUNNING":
    case "SUCCEEDED":
      return { status: job.status };
    default:
      return {
        status: "FAILED",
        failure: job.errorCode === "NO_RELIABLE_ALIGNMENT" ? "NO_RELIABLE_ALIGNMENT" : "PROCESSING_FAILED",
      };
  }
}

export function setDto(s: SetRow): z.input<typeof BeforeAfterSet> {
  return {
    id: s.id,
    patientId: s.patientId,
    beforePhotoId: s.beforePhotoId,
    afterPhotoId: s.afterPhotoId,
    ...defined({
      consultationId: s.consultationId,
      viewKey: s.viewKey,
      title: s.title,
      registrationTransform: (s.registrationTransform ?? null) as z.input<
        typeof RegistrationTransform
      > | null,
      registrationJob: jobDto(s.registrationJob) ?? null,
    }),
    registrationMode: s.registrationMode,
    createdById: s.createdById,
    createdAt: iso(s.createdAt),
    updatedAt: iso(s.updatedAt),
    version: s.version,
  };
}

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

@Injectable()
export class BeforeAfterService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
    private readonly idempotency: Idempotency,
    private readonly outbox: Outbox,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("requestBeforeAfterRegistration", async (ctx, id) => {
      const row = await this.set(requireTx(ctx), ctx.params.patientId ?? "", id);
      return { data: setDto(row), version: row.version, resource: { type: "BeforeAfterSet", id } };
    });
    this.idempotency.register("createBeforeAfterSet", async (ctx, id) => {
      const row = await this.set(requireTx(ctx), ctx.params.patientId ?? "", id);
      return { data: setDto(row), version: row.version, resource: { type: "BeforeAfterSet", id } };
    });
  }

  async set(tx: Tx, patientId: string, id: string): Promise<SetRow> {
    const s = await tx.beforeAfterSet.findFirst({ where: { id, patientId }, include: INCLUDE });
    if (s === null) throw notFound("BEFORE_AFTER_SET_NOT_FOUND");
    return s as SetRow;
  }

  async list(
    ctx: RequestContext,
    patientId: string,
    query: { limit: number; cursor?: string; consultationId?: string },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    if ((await tx.patient.count({ where: { id: patientId } })) === 0) throw notFound("PATIENT_NOT_FOUND");
    const after = this.cursors.decode("before-after", query.cursor);
    const rows = (await tx.beforeAfterSet.findMany({
      where: {
        patientId,
        ...(query.consultationId ? { consultationId: query.consultationId } : {}),
        ...(after
          ? {
              OR: [
                { createdAt: { lt: new Date(after.k ?? 0) } },
                { createdAt: new Date(after.k ?? 0), id: { lt: after.id } },
              ],
            }
          : {}),
      },
      include: INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    })) as SetRow[];
    const { items, page } = paginate(rows, query.limit, (s) =>
      this.cursors.encode("before-after", { k: s.createdAt.toISOString(), id: s.id }),
    );
    return { data: items.map(setDto), page };
  }

  async get(ctx: RequestContext, patientId: string, id: string): Promise<OperationResult> {
    const s = await this.set(requireTx(ctx), patientId, id);
    return { data: setDto(s), version: s.version };
  }

  async create(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof BeforeAfterSetCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { status: true } });
    if (patient === null) throw notFound("PATIENT_NOT_FOUND");
    if (patient.status === "ARCHIVED")
      throw new ApiError("INVALID_STATE_TRANSITION", "An archived patient's photos cannot be paired.");
    const photos = await tx.patientPhoto.findMany({
      where: {
        id: { in: [body.beforePhotoId, body.afterPhotoId] },
        patientId,
        status: { not: "UPLOAD_PENDING" },
      },
      select: {
        id: true,
        status: true,
        viewKey: true,
        capturedAt: true,
        protocolView: { select: { poseTarget: true } },
      },
    });
    const before = photos.find((p) => p.id === body.beforePhotoId);
    const after = photos.find((p) => p.id === body.afterPhotoId);
    // Another tenant's or patient's photo, or none at all: one answer [B §34.1 #13, #20].
    if (before === undefined || after === undefined) throw notFound("PHOTO_NOT_FOUND");
    if (before.status !== "ACCEPTED" || after.status !== "ACCEPTED")
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        before.status === "ARCHIVED" || after.status === "ARCHIVED"
          ? "Archived photos are not used in new comparisons."
          : "Only accepted photos can be compared.",
      );
    const pose = (p: typeof before) => (p.protocolView?.poseTarget ?? null) as Pose;
    if (
      !compatibleViews(
        { viewKey: before.viewKey, pose: pose(before) },
        { viewKey: after.viewKey, pose: pose(after) },
      )
    )
      throw new ApiError("INCOMPATIBLE_VIEWS", "Compare two photos of the same view.");
    if (before.capturedAt.getTime() >= after.capturedAt.getTime())
      throw new ApiError("BEFORE_AFTER_ORDER", "The before photo must be the earlier one.");
    if (
      body.consultationId !== undefined &&
      (await tx.consultation.count({ where: { id: body.consultationId, patientId } })) === 0
    )
      throw invalid("consultationId", "UNKNOWN_CONSULTATION", "Choose a consultation of this patient.");
    const created = (await tx.beforeAfterSet.create({
      data: {
        organizationId: requireOrganization(ctx),
        patientId,
        beforePhotoId: before.id,
        afterPhotoId: after.id,
        consultationId: body.consultationId ?? null,
        viewKey: before.viewKey,
        title: body.title ?? null,
        createdById: requireAuth(ctx).userId,
      },
      include: INCLUDE,
    })) as SetRow;
    await this.audit.write(tx, ctx, {
      action: "BEFORE_AFTER_CREATED",
      resourceType: "BeforeAfterSet",
      resourceId: created.id,
      patientId,
      metadata: { beforePhotoId: before.id, afterPhotoId: after.id },
    });
    return {
      data: setDto(created),
      version: created.version,
      resource: { type: "BeforeAfterSet", id: created.id },
    };
  }

  async update(
    ctx: RequestContext,
    patientId: string,
    id: string,
    body: z.output<typeof BeforeAfterSetUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "BeforeAfterSet", id);
    const current = await this.set(tx, patientId, id);
    checkVersion(ctx, current.version);
    const registration = body.registration;
    const updated = (await tx.beforeAfterSet.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(registration?.mode === "MANUAL"
          ? { registrationMode: "MANUAL", registrationTransform: registration.transform }
          : {}),
        ...(registration?.mode === "NONE"
          ? { registrationMode: "NONE", registrationTransform: Prisma.DbNull }
          : {}),
        version: { increment: 1 },
      },
      include: INCLUDE,
    })) as SetRow;
    return { data: setDto(updated), version: updated.version };
  }

  /**
   * Queues automatic registration (ADR-0026 K3-13): an IMAGE_REGISTRATION job
   * over the two display previews. The job records the set's version; its
   * result applies only if the set is still at that version, so an alignment
   * made by hand meanwhile wins.
   */
  async requestRegistration(ctx: RequestContext, patientId: string, id: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    await lockRow(tx, "BeforeAfterSet", id);
    const current = await this.set(tx, patientId, id);
    if (!(await resolveFlag(tx, "beforeAfter.autoRegistration", null)).enabled)
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        "Automatic alignment is turned off for this organization.",
      );
    if (current.registrationJob !== null && ["QUEUED", "RUNNING"].includes(current.registrationJob.status))
      throw new ApiError("INVALID_STATE_TRANSITION", "Automatic alignment is already running for this set.");
    const previews = await tx.photoDerivative.count({
      where: {
        sourcePhotoId: { in: [current.beforePhotoId, current.afterPhotoId] },
        kind: "DISPLAY_PREVIEW",
        storageObject: { status: "AVAILABLE" },
      },
    });
    if (previews < 2)
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        "The photos' previews are not ready yet. Try again shortly.",
      );
    const jobId = uuidv7();
    await tx.aIJob.create({
      data: {
        id: jobId,
        organizationId,
        patientId,
        jobType: "IMAGE_REGISTRATION",
        status: "QUEUED",
        idempotencyKey: `registration:${jobId}`,
        requestedById: requireAuth(ctx).userId,
        inputSummary: {
          setId: id,
          setVersion: current.version + 1,
          beforePhotoId: current.beforePhotoId,
          afterPhotoId: current.afterPhotoId,
        },
      },
    });
    const updated = (await tx.beforeAfterSet.update({
      where: { id },
      data: { registrationJobId: jobId, version: { increment: 1 } },
      include: INCLUDE,
    })) as SetRow;
    await this.outbox.add(tx, {
      organizationId,
      eventType: "image.registration.requested",
      aggregateId: jobId,
      payload: { jobId, attempt: 1 },
    });
    return { data: setDto(updated), version: updated.version, resource: { type: "BeforeAfterSet", id } };
  }
}
