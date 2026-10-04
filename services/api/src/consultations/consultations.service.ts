// Consultations (spec §6.3 "Consultations", §5.4.1; Bible §5; ADR-0026 K3-01
// to K3-05, K3-20). Practice-owned: creating and changing one needs a grant
// covering its practice (spec §4.6). The database enforces the machine, the
// frozen states and the completion columns; this service names the refusal.
import type {
  CompletionPrecondition,
  Consultation,
  ConsultationCreate,
  ConsultationUpdate,
} from "@aestara/api-contracts";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { checkVersion, defined, iso, lockRow } from "../common/concurrency.ts";
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

type Status =
  | "DRAFT"
  | "IN_PROGRESS"
  | "AWAITING_INFORMATION"
  | "READY_FOR_REVIEW"
  | "COMPLETED"
  | "CANCELLED"
  | "ARCHIVED";

type ConsultationRow = {
  id: string;
  patientId: string;
  practiceId: string;
  locationId: string | null;
  primaryProviderUserId: string | null;
  status: Status;
  reason: string | null;
  startedAt: Date | null;
  readyForReviewAt: Date | null;
  completedAt: Date | null;
  completedById: string | null;
  releaseDecision: "NOTHING_TO_RELEASE" | "MATERIALS_RELEASED" | null;
  cancelledAt: Date | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  archivedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  concerns: { patientConcernId: string }[];
};

/** The transitions of spec §5.4.1 (ADR-0026 K3-01), by action. */
export const TRANSITIONS = {
  start: { from: ["DRAFT"], to: "IN_PROGRESS", permission: "consultation.edit" },
  "request-information": {
    from: ["IN_PROGRESS"],
    to: "AWAITING_INFORMATION",
    permission: "consultation.edit",
  },
  resume: { from: ["AWAITING_INFORMATION"], to: "IN_PROGRESS", permission: "consultation.edit" },
  "submit-for-review": {
    from: ["IN_PROGRESS", "AWAITING_INFORMATION"],
    to: "READY_FOR_REVIEW",
    permission: "consultation.edit",
  },
  "return-to-progress": { from: ["READY_FOR_REVIEW"], to: "IN_PROGRESS", permission: "consultation.edit" },
  cancel: {
    from: ["DRAFT", "IN_PROGRESS", "AWAITING_INFORMATION", "READY_FOR_REVIEW"],
    to: "CANCELLED",
    permission: "consultation.edit",
  },
  complete: { from: ["READY_FOR_REVIEW"], to: "COMPLETED", permission: "consultation.complete" },
  archive: { from: ["COMPLETED", "CANCELLED"], to: "ARCHIVED", permission: "consultation.complete" },
} as const satisfies Record<string, { from: readonly Status[]; to: Status; permission: string }>;

export type TransitionAction = keyof typeof TRANSITIONS;

/** States whose reason, provider, location and concerns may change (ADR-0026 K3-02). */
const CONTENT_OPEN: readonly Status[] = ["DRAFT", "IN_PROGRESS", "AWAITING_INFORMATION"];
const FINAL: readonly Status[] = ["COMPLETED", "CANCELLED", "ARCHIVED"];

const INCLUDE = { concerns: { select: { patientConcernId: true }, orderBy: { createdAt: "asc" } } } as const;

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

@Injectable()
export class ConsultationsService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
    private readonly idempotency: Idempotency,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("createConsultation", async (ctx, id) => {
      const tx = requireTx(ctx);
      const row = await this.consultation(tx, ctx.params.patientId ?? "", id);
      return { data: await this.dto(tx, row), version: row.version, resource: { type: "Consultation", id } };
    });
  }

  // ---- Loading ------------------------------------------------------------------

  private async patient(tx: Tx, patientId: string): Promise<{ status: string }> {
    const p = await tx.patient.findUnique({ where: { id: patientId }, select: { status: true } });
    if (p === null) throw notFound("PATIENT_NOT_FOUND");
    return p;
  }

  async consultation(tx: Tx, patientId: string, id: string): Promise<ConsultationRow> {
    const c = await tx.consultation.findFirst({ where: { id, patientId }, include: INCLUDE });
    if (c === null) throw notFound("CONSULTATION_NOT_FOUND");
    return c as ConsultationRow;
  }

  /** Spec §5.4.1 preconditions the consultation still fails (ADR-0026 K3-03). */
  async unmetPreconditions(tx: Tx, c: ConsultationRow): Promise<z.output<typeof CompletionPrecondition>[]> {
    if (FINAL.includes(c.status)) return [];
    const unmet: z.output<typeof CompletionPrecondition>[] = [];
    if ((c.reason ?? "").trim() === "" && c.concerns.length === 0) unmet.push("REASON_OR_CONCERN");
    if ((await tx.consultationNote.count({ where: { consultationId: c.id, status: "DRAFT" } })) > 0)
      unmet.push("NO_DRAFT_NOTES");
    const summaries =
      c.readyForReviewAt === null
        ? 0
        : await tx.documentVersion.count({
            where: {
              createdAt: { gte: c.readyForReviewAt },
              document: { consultationId: c.id, type: "CONSULTATION_SUMMARY" },
            },
          });
    if (summaries === 0) unmet.push("CURRENT_SUMMARY");
    return unmet;
  }

  async dto(tx: Tx, c: ConsultationRow): Promise<z.input<typeof Consultation>> {
    return {
      id: c.id,
      patientId: c.patientId,
      practiceId: c.practiceId,
      ...defined({
        locationId: c.locationId,
        primaryProviderUserId: c.primaryProviderUserId,
        reason: c.reason,
        startedAt: c.startedAt && iso(c.startedAt),
        readyForReviewAt: c.readyForReviewAt && iso(c.readyForReviewAt),
        completedAt: c.completedAt && iso(c.completedAt),
        completedById: c.completedById,
        releaseDecision: c.releaseDecision,
        cancelledAt: c.cancelledAt && iso(c.cancelledAt),
        cancelledById: c.cancelledById,
        cancellationReason: c.cancellationReason,
        archivedAt: c.archivedAt && iso(c.archivedAt),
      }),
      status: c.status,
      concernIds: c.concerns.map((k) => k.patientConcernId),
      unmetCompletionPreconditions: await this.unmetPreconditions(tx, c),
      createdById: c.createdById,
      createdAt: iso(c.createdAt),
      updatedAt: iso(c.updatedAt),
      version: c.version,
    };
  }

  /** A write to a practice-owned consultation: a grant covering its practice and location (spec §4.6). */
  requireScope(ctx: RequestContext, permission: string, practiceId: string, locationId: string | null): void {
    const auth = requireAuth(ctx);
    if (grantsWith(auth, permission).some((g) => g.scope === "ORGANIZATION")) return;
    requireScopedPermission(auth, permission, {
      scope: locationId === null ? "PRACTICE" : "LOCATION",
      practiceId,
      locationId,
    });
  }

  private async checkLocation(
    tx: Tx,
    practiceId: string,
    locationId: string | null | undefined,
  ): Promise<void> {
    if (locationId === null || locationId === undefined) return;
    if ((await tx.location.count({ where: { id: locationId, practiceId } })) === 0)
      throw invalid("locationId", "UNKNOWN_LOCATION", "Choose one of the practice's locations.");
  }

  private async checkProvider(tx: Tx, userId: string | null | undefined): Promise<void> {
    if (userId === null || userId === undefined) return;
    if ((await tx.providerProfile.count({ where: { userId } })) === 0)
      throw invalid("primaryProviderUserId", "UNKNOWN_PROVIDER", "Choose a provider of this organization.");
  }

  // ---- Reading ------------------------------------------------------------------

  async list(
    ctx: RequestContext,
    patientId: string,
    query: { limit: number; cursor?: string; status?: Status; includeArchived: boolean },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const after = this.cursors.decode("consultations", query.cursor);
    const rows = (await tx.consultation.findMany({
      where: {
        patientId,
        ...(query.status !== undefined
          ? { status: query.status }
          : query.includeArchived
            ? {}
            : { status: { not: "ARCHIVED" } }),
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
    })) as ConsultationRow[];
    const { items, page } = paginate(rows, query.limit, (c) =>
      this.cursors.encode("consultations", { k: c.createdAt.toISOString(), id: c.id }),
    );
    return { data: await inOrder(items, (c) => this.dto(tx, c)), page };
  }

  async get(ctx: RequestContext, patientId: string, id: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const c = await this.consultation(tx, patientId, id);
    return { data: await this.dto(tx, c), version: c.version };
  }

  // ---- Changing -----------------------------------------------------------------

  async create(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof ConsultationCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    const patient = await this.patient(tx, patientId);
    if (patient.status === "ARCHIVED")
      throw new ApiError("INVALID_STATE_TRANSITION", "An archived patient cannot start a consultation.");
    if ((await tx.practice.count({ where: { id: body.practiceId } })) === 0)
      throw invalid("practiceId", "UNKNOWN_PRACTICE", "Choose one of the organization's practices.");
    await this.checkLocation(tx, body.practiceId, body.locationId);
    this.requireScope(ctx, "consultation.create", body.practiceId, body.locationId ?? null);
    await this.checkProvider(tx, body.primaryProviderUserId);
    const created = await tx.consultation.create({
      data: {
        organizationId,
        patientId,
        practiceId: body.practiceId,
        locationId: body.locationId ?? null,
        primaryProviderUserId: body.primaryProviderUserId ?? null,
        reason: body.reason ?? null,
        createdById: requireAuth(ctx).userId,
      },
      include: INCLUDE,
    });
    await this.audit.write(tx, ctx, {
      action: "CONSULTATION_CREATED",
      resourceType: "Consultation",
      resourceId: created.id,
      patientId,
      metadata: { practiceId: body.practiceId },
    });
    return {
      data: await this.dto(tx, created as ConsultationRow),
      version: created.version,
      resource: { type: "Consultation", id: created.id },
    };
  }

  async update(
    ctx: RequestContext,
    patientId: string,
    id: string,
    body: z.output<typeof ConsultationUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "Consultation", id);
    const current = await this.consultation(tx, patientId, id);
    this.requireScope(ctx, "consultation.edit", current.practiceId, current.locationId);
    checkVersion(ctx, current.version);
    if (!CONTENT_OPEN.includes(current.status))
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        current.status === "READY_FOR_REVIEW"
          ? "The consultation is under review. Return it to progress to change it."
          : "This consultation can no longer change.",
      );
    if (body.locationId !== undefined) {
      await this.checkLocation(tx, current.practiceId, body.locationId);
      // Moving a consultation to a location must stay within the caller's scope.
      this.requireScope(ctx, "consultation.edit", current.practiceId, body.locationId);
    }
    await this.checkProvider(tx, body.primaryProviderUserId);
    const updated = await tx.consultation.update({
      where: { id },
      data: {
        ...(body.locationId !== undefined ? { locationId: body.locationId } : {}),
        ...(body.primaryProviderUserId !== undefined
          ? { primaryProviderUserId: body.primaryProviderUserId }
          : {}),
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
        version: { increment: 1 },
      },
      include: INCLUDE,
    });
    return { data: await this.dto(tx, updated as ConsultationRow), version: updated.version };
  }

  /** One spec §5.4.1 transition: scope, version, state, preconditions, then the change and its event. */
  async transition(
    ctx: RequestContext,
    patientId: string,
    id: string,
    action: TransitionAction,
    body: { reason?: string; releaseDecision?: "NOTHING_TO_RELEASE" } = {},
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const rule = TRANSITIONS[action];
    await lockRow(tx, "Consultation", id);
    const current = await this.consultation(tx, patientId, id);
    this.requireScope(ctx, rule.permission, current.practiceId, current.locationId);
    checkVersion(ctx, current.version);
    if (!(rule.from as readonly Status[]).includes(current.status))
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        `A ${current.status.toLowerCase().replaceAll("_", " ")} consultation cannot ${action.replaceAll("-", " ")}.`,
      );
    const now = new Date();
    const userId = requireAuth(ctx).userId;
    const releaseDecision = action === "complete" ? (body.releaseDecision ?? "NOTHING_TO_RELEASE") : null;
    if (action === "submit-for-review") {
      if ((await tx.consultationNote.count({ where: { consultationId: id, status: "DRAFT" } })) > 0)
        throw new ApiError(
          "INVALID_STATE_TRANSITION",
          "Finalize or discard every draft note before review: notes are frozen under review.",
          { unmet: ["NO_DRAFT_NOTES"] },
        );
    }
    if (action === "complete") {
      const unmet = await this.unmetPreconditions(tx, current);
      if (unmet.length > 0)
        throw new ApiError("COMPLETION_PRECONDITIONS_NOT_MET", "The consultation cannot be completed yet.", {
          unmet,
        });
    }
    const data = {
      status: rule.to,
      version: { increment: 1 },
      ...(action === "start" && current.startedAt === null ? { startedAt: now } : {}),
      ...(action === "submit-for-review" ? { readyForReviewAt: now } : {}),
      ...(action === "cancel"
        ? { cancelledAt: now, cancelledById: userId, cancellationReason: body.reason ?? "" }
        : {}),
      ...(releaseDecision !== null
        ? {
            completedAt: now,
            completedById: userId,
            releaseDecision,
            releaseDecidedAt: now,
            releaseDecidedById: userId,
          }
        : {}),
      ...(action === "archive" ? { archivedAt: now } : {}),
    };
    const updated = await tx.consultation.update({ where: { id }, data, include: INCLUDE });
    await this.audit.write(tx, ctx, {
      action: action === "complete" ? "CONSULTATION_COMPLETED" : "CONSULTATION_STATUS_CHANGED",
      resourceType: "Consultation",
      resourceId: id,
      patientId,
      metadata: {
        statusFrom: current.status,
        statusTo: rule.to,
        ...(releaseDecision !== null ? { releaseDecision } : {}),
      },
    });
    return { data: await this.dto(tx, updated as ConsultationRow), version: updated.version };
  }
}
