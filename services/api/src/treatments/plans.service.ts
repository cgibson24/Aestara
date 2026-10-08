// Treatment plans A/B/C (spec §6.3 "Treatment plans & estimates", §5.4.3; Bible
// §11; UD-14; ADR-0028 K4-04 to K4-07, K4-22; ADR-0029). Practice-owned without
// a location: changing one needs a grant covering its practice. Only a DRAFT
// changes, and the server computes every amount; the database enforces the
// machine, the frozen content and the line totals. Accepting a plan is not
// consent to treatment.
import {
  NOT_CONSENT_NOTICE,
  PLAN_RESPONSE_ATTESTATIONS,
  type TreatmentPlan,
  type TreatmentPlanCreate,
  type TreatmentPlanItemInput,
  type TreatmentPlanUpdate,
} from "@aestara/api-contracts";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { checkVersion, defined, iso, lockRow, present } from "../common/concurrency.ts";
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
import { HandoffsService, requireHandoff } from "../handoffs/handoffs.service.ts";

type Status = z.output<typeof TreatmentPlan>["status"];
type Decimal = { toFixed(digits: number): string };

const INCLUDE = {
  items: { orderBy: { sortOrder: "asc" as const }, include: { treatment: { select: { name: true } } } },
} as const;

type ItemRow = {
  id: string;
  treatmentId: string;
  treatment: { name: string };
  area: string | null;
  providerUserId: string | null;
  description: string | null;
  quantity: Decimal;
  unitPrice: Decimal;
  discountAmount: Decimal;
  lineTotal: Decimal;
  notes: string | null;
  proposedDate: Date | null;
  sortOrder: number;
};

type PlanRow = {
  id: string;
  patientId: string;
  consultationId: string | null;
  practiceId: string;
  providerUserId: string | null;
  optionLabel: string | null;
  title: string;
  status: Status;
  subtotal: Decimal;
  discountTotal: Decimal;
  estimatedTotal: Decimal;
  financingReference: string | null;
  notes: string | null;
  proposedDate: Date | null;
  respondedAt: Date | null;
  responseSource: "IN_CLINIC" | "PATIENT_APP" | "SIBLING_ACCEPTED" | null;
  responseHandoffId: string | null;
  responseAttestation: string | null;
  responseSignerName: string | null;
  acceptedSiblingId: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  items: ItemRow[];
};

// ---- Money in integer cents (ADR-0028 K4-04) -------------------------------------

/** "12.5" → 1250n: a decimal string with at most two fraction digits, as hundredths. */
function hundredths(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function dollars(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

const usd = (amount: Decimal | string) => ({
  amount: typeof amount === "string" ? amount : amount.toFixed(2),
  currency: "USD" as const,
});

/** quantity × unit price, rounded half up to cents (as PostgreSQL's round does for amounts ≥ 0). */
export function lineAmount(quantity: string, unitPrice: string): bigint {
  return (hundredths(quantity) * hundredths(unitPrice) + 50n) / 100n;
}

const ISO_DATE = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));
const dateOnly = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`);

/** Next free option letter: A … Z, then AA, AB … (ADR-0029). */
function letter(n: number): string {
  let out = "";
  for (let i = n; i >= 0; i = Math.floor(i / 26) - 1) out = String.fromCharCode(65 + (i % 26)) + out;
  return out;
}

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

const stateName = (s: Status) => s.toLowerCase().replaceAll("_", " ");

@Injectable()
export class TreatmentPlansService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
    private readonly idempotency: Idempotency,
    private readonly handoffs: HandoffsService,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("createTreatmentPlan", async (ctx, id) => {
      const plan = await this.plan(requireTx(ctx), ctx.params.patientId ?? "", id);
      return { data: this.dto(plan), version: plan.version, resource: { type: "TreatmentPlan", id } };
    });
    this.idempotency.register("recordHandoffPlanResponse", async (ctx, id) => {
      const tx = requireTx(ctx);
      const plan = await tx.treatmentPlan.findUniqueOrThrow({ where: { id } });
      const siblings = await tx.treatmentPlan.findMany({
        where: { acceptedSiblingId: id },
        select: { id: true },
      });
      return {
        data: {
          decision: plan.status === "DECLINED" ? "DECLINED" : "ACCEPTED",
          respondedAt: iso(plan.respondedAt ?? plan.updatedAt),
          declinedSiblingIds: siblings.map((s) => s.id),
        },
      };
    });
  }

  // ---- Loading ------------------------------------------------------------------

  private async patient(tx: Tx, patientId: string): Promise<{ status: string }> {
    const p = await tx.patient.findUnique({ where: { id: patientId }, select: { status: true } });
    if (p === null) throw notFound("PATIENT_NOT_FOUND");
    return p;
  }

  async plan(tx: Tx, patientId: string, id: string): Promise<PlanRow> {
    const p = await tx.treatmentPlan.findFirst({ where: { id, patientId }, include: INCLUDE });
    if (p === null) throw notFound("TREATMENT_PLAN_NOT_FOUND");
    return p as unknown as PlanRow;
  }

  dto(p: PlanRow): z.input<typeof TreatmentPlan> {
    return {
      id: p.id,
      patientId: p.patientId,
      practiceId: p.practiceId,
      ...defined({
        consultationId: p.consultationId,
        providerUserId: p.providerUserId,
        optionLabel: p.optionLabel,
        financingReference: p.financingReference,
        notes: p.notes,
        proposedDate: ISO_DATE(p.proposedDate),
        cancelledAt: p.cancelledAt && iso(p.cancelledAt),
        cancellationReason: p.cancellationReason,
      }),
      title: p.title,
      status: p.status,
      items: p.items.map((i) => ({
        id: i.id,
        treatmentId: i.treatmentId,
        treatmentName: i.treatment.name,
        ...defined({
          area: i.area,
          providerUserId: i.providerUserId,
          description: i.description,
          notes: i.notes,
          proposedDate: ISO_DATE(i.proposedDate),
        }),
        quantity: i.quantity.toFixed(2),
        unitPrice: usd(i.unitPrice),
        discountAmount: usd(i.discountAmount),
        lineTotal: usd(i.lineTotal),
        sortOrder: i.sortOrder,
      })),
      subtotal: usd(p.subtotal),
      discountTotal: usd(p.discountTotal),
      estimatedTotal: usd(p.estimatedTotal),
      ...(p.responseSource !== null && p.respondedAt !== null
        ? {
            response: {
              source: p.responseSource,
              respondedAt: iso(p.respondedAt),
              ...defined({
                signerName: p.responseSignerName,
                attestation: p.responseAttestation,
                handoffId: p.responseHandoffId,
                acceptedSiblingId: p.acceptedSiblingId,
              }),
            },
          }
        : {}),
      notConsentNotice: NOT_CONSENT_NOTICE,
      createdById: p.createdById,
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
      version: p.version,
    };
  }

  /** A change to a practice-owned plan: a grant covering its practice. Plans have no location (K4-22). */
  private requireScope(ctx: RequestContext, permission: string, practiceId: string): void {
    const auth = requireAuth(ctx);
    if (grantsWith(auth, permission).some((g) => g.scope === "ORGANIZATION")) return;
    requireScopedPermission(auth, permission, { scope: "PRACTICE", practiceId, locationId: null });
  }

  private async checkProvider(tx: Tx, path: string, userId: string | null | undefined): Promise<void> {
    if (userId === null || userId === undefined) return;
    if ((await tx.providerProfile.count({ where: { userId } })) === 0)
      throw invalid(path, "UNKNOWN_PROVIDER", "Choose a provider of this organization.");
  }

  private requireDraft(p: PlanRow, what: string): void {
    if (p.status !== "DRAFT")
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        p.status === "PROPOSED"
          ? `Revise the option to change its ${what}.`
          : `A ${stateName(p.status)} option can no longer change.`,
      );
  }

  // ---- Reading ------------------------------------------------------------------

  async list(
    ctx: RequestContext,
    patientId: string,
    query: { limit: number; cursor?: string; consultationId?: string; status?: Status },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const after = this.cursors.decode("treatment-plans", query.cursor);
    const rows = (await tx.treatmentPlan.findMany({
      where: {
        patientId,
        ...(query.consultationId ? { consultationId: query.consultationId } : {}),
        ...(query.status ? { status: query.status } : {}),
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
    })) as unknown as PlanRow[];
    const { items, page } = paginate(rows, query.limit, (p) =>
      this.cursors.encode("treatment-plans", { k: p.createdAt.toISOString(), id: p.id }),
    );
    return { data: items.map((p) => this.dto(p)), page };
  }

  async get(ctx: RequestContext, patientId: string, id: string): Promise<OperationResult> {
    const p = await this.plan(requireTx(ctx), patientId, id);
    return { data: this.dto(p), version: p.version };
  }

  // ---- Changing -----------------------------------------------------------------

  async create(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof TreatmentPlanCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const patient = await this.patient(tx, patientId);
    if (patient.status === "ARCHIVED")
      throw new ApiError("INVALID_STATE_TRANSITION", "An archived patient takes no new plan.");
    let practiceId = body.practiceId;
    let optionLabel = body.optionLabel ?? null;
    if (body.consultationId !== undefined) {
      const c = await tx.consultation.findFirst({
        where: { id: body.consultationId, patientId },
        select: { practiceId: true, status: true },
      });
      if (c === null)
        throw invalid("consultationId", "UNKNOWN_CONSULTATION", "Choose one of the patient's consultations.");
      if (c.status === "CANCELLED" || c.status === "ARCHIVED")
        throw new ApiError(
          "INVALID_STATE_TRANSITION",
          `A ${c.status.toLowerCase()} consultation takes no new option.`,
        );
      if (practiceId !== undefined && practiceId !== c.practiceId)
        throw invalid("practiceId", "PRACTICE_MISMATCH", "An option takes its consultation's practice.");
      practiceId = c.practiceId;
      if (optionLabel === null) {
        await tx.$executeRawUnsafe(
          `SELECT 1 FROM "Consultation" WHERE id = $1::uuid FOR UPDATE`,
          body.consultationId,
        );
        const taken = new Set(
          (
            await tx.treatmentPlan.findMany({
              where: { consultationId: body.consultationId },
              select: { optionLabel: true },
            })
          ).map((p) => p.optionLabel),
        );
        let n = 0;
        while (taken.has(`Plan ${letter(n)}`)) n++;
        optionLabel = `Plan ${letter(n)}`;
      }
    }
    if (practiceId === undefined) throw invalid("practiceId", "REQUIRED", "Name the practice.");
    if ((await tx.practice.count({ where: { id: practiceId } })) === 0)
      throw invalid("practiceId", "UNKNOWN_PRACTICE", "Choose one of the organization's practices.");
    this.requireScope(ctx, "treatmentplan.create", practiceId);
    await this.checkProvider(tx, "providerUserId", body.providerUserId);
    const created = await tx.treatmentPlan.create({
      data: {
        organizationId: requireOrganization(ctx),
        patientId,
        consultationId: body.consultationId ?? null,
        practiceId,
        providerUserId: body.providerUserId ?? null,
        optionLabel,
        title: body.title,
        notes: body.notes ?? null,
        proposedDate: dateOnly(body.proposedDate) ?? null,
        financingReference: body.financingReference ?? null,
        createdById: requireAuth(ctx).userId,
      },
      include: INCLUDE,
    });
    return {
      data: this.dto(created as unknown as PlanRow),
      version: created.version,
      resource: { type: "TreatmentPlan", id: created.id },
    };
  }

  async update(
    ctx: RequestContext,
    patientId: string,
    id: string,
    body: z.output<typeof TreatmentPlanUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "TreatmentPlan", id);
    const current = await this.plan(tx, patientId, id);
    this.requireScope(ctx, "treatmentplan.edit", current.practiceId);
    checkVersion(ctx, current.version);
    this.requireDraft(current, "details");
    await this.checkProvider(tx, "providerUserId", body.providerUserId);
    const { proposedDate, ...rest } = body;
    const updated = await tx.treatmentPlan.update({
      where: { id },
      data: {
        ...present(rest),
        ...(proposedDate !== undefined
          ? { proposedDate: proposedDate === null ? null : new Date(`${proposedDate}T00:00:00.000Z`) }
          : {}),
        version: { increment: 1 },
      },
      include: INCLUDE,
    });
    return { data: this.dto(updated as unknown as PlanRow), version: updated.version };
  }

  /** Replaces a draft's items and recomputes every line and total (ADR-0028 K4-04). */
  async putItems(
    ctx: RequestContext,
    patientId: string,
    id: string,
    items: readonly z.output<typeof TreatmentPlanItemInput>[],
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "TreatmentPlan", id);
    const current = await this.plan(tx, patientId, id);
    this.requireScope(ctx, "treatmentplan.edit", current.practiceId);
    checkVersion(ctx, current.version);
    this.requireDraft(current, "items");
    const treatments = new Map(
      (
        await tx.treatment.findMany({
          where: { id: { in: [...new Set(items.map((i) => i.treatmentId))] } },
          select: { id: true, status: true, defaultUnitPrice: true },
        })
      ).map((t) => [t.id, t]),
    );
    let subtotal = 0n;
    let discountTotal = 0n;
    const rows = await inOrder(
      items.map((item, index) => ({ item, index })),
      async ({ item, index }) => {
        const path = `items.${index}`;
        const treatment = treatments.get(item.treatmentId);
        if (treatment === undefined || treatment.status !== "ACTIVE")
          throw invalid(
            `${path}.treatmentId`,
            "UNKNOWN_TREATMENT",
            "Choose an active treatment of the catalog.",
          );
        await this.checkProvider(tx, `${path}.providerUserId`, item.providerUserId);
        const price = item.unitPrice?.amount ?? treatment.defaultUnitPrice?.toFixed(2);
        if (price === undefined)
          throw invalid(`${path}.unitPrice`, "REQUIRED", "This treatment has no default price: enter one.");
        const quantity = item.quantity ?? "1";
        const gross = lineAmount(quantity, price);
        const discount = hundredths(item.discountAmount?.amount ?? "0.00");
        if (discount > gross)
          throw invalid(
            `${path}.discountAmount`,
            "DISCOUNT_TOO_LARGE",
            "A discount cannot exceed the line amount.",
          );
        subtotal += gross;
        discountTotal += discount;
        return {
          organizationId: requireOrganization(ctx),
          patientId,
          treatmentPlanId: id,
          treatmentId: item.treatmentId,
          area: item.area ?? null,
          providerUserId: item.providerUserId ?? null,
          description: item.description ?? null,
          quantity,
          unitPrice: price,
          discountAmount: dollars(discount),
          lineTotal: dollars(gross - discount),
          notes: item.notes ?? null,
          proposedDate: dateOnly(item.proposedDate) ?? null,
          sortOrder: index,
        };
      },
    );
    await tx.treatmentPlanItem.deleteMany({ where: { treatmentPlanId: id } });
    if (rows.length > 0) await tx.treatmentPlanItem.createMany({ data: rows });
    const updated = await tx.treatmentPlan.update({
      where: { id },
      data: {
        subtotal: dollars(subtotal),
        discountTotal: dollars(discountTotal),
        estimatedTotal: dollars(subtotal - discountTotal),
        version: { increment: 1 },
      },
      include: INCLUDE,
    });
    return { data: this.dto(updated as unknown as PlanRow), version: updated.version };
  }

  private async record(
    tx: Tx,
    ctx: RequestContext,
    p: { id: string; patientId: string },
    from: Status,
    to: Status,
    extra: Record<string, string> = {},
    actorUserId?: null,
  ): Promise<void> {
    await this.audit.write(tx, ctx, {
      action: "TREATMENT_PLAN_STATUS_CHANGED",
      resourceType: "TreatmentPlan",
      resourceId: p.id,
      patientId: p.patientId,
      metadata: { statusFrom: from, statusTo: to, ...extra },
      ...(actorUserId === null ? { actorUserId: null } : {}),
    });
  }

  /** `/propose`, `/revise` and `/cancel` (DRAFT discard) (spec §5.4.3; ADR-0028 K4-05). */
  async transition(
    ctx: RequestContext,
    patientId: string,
    id: string,
    action: "propose" | "revise" | "cancel",
    reason?: string,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "TreatmentPlan", id);
    const current = await this.plan(tx, patientId, id);
    this.requireScope(ctx, "treatmentplan.edit", current.practiceId);
    checkVersion(ctx, current.version);
    const rules: Record<typeof action, { from: Status; to: Status }> = {
      propose: { from: "DRAFT", to: "PROPOSED" },
      revise: { from: "PROPOSED", to: "DRAFT" },
      cancel: { from: "DRAFT", to: "CANCELLED" },
    };
    const rule = rules[action];
    if (current.status !== rule.from)
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        action === "cancel"
          ? `A ${stateName(current.status)} option cannot be cancelled here.`
          : `A ${stateName(current.status)} option cannot ${action}.`,
      );
    if (action === "propose" && current.items.length === 0)
      throw new ApiError("INVALID_STATE_TRANSITION", "Add at least one item before proposing the option.");
    const now = new Date();
    const updated = await tx.treatmentPlan.update({
      where: { id },
      data: {
        status: rule.to,
        ...(action === "cancel"
          ? { cancelledAt: now, cancelledById: requireAuth(ctx).userId, cancellationReason: reason ?? "" }
          : {}),
        version: { increment: 1 },
      },
      include: INCLUDE,
    });
    await this.record(tx, ctx, current, rule.from, rule.to);
    return { data: this.dto(updated as unknown as PlanRow), version: updated.version };
  }

  // ---- The in-clinic response (UD-14; ADR-0028 K4-06, K4-07) -----------------------

  async openResponse(ctx: RequestContext, patientId: string, id: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "TreatmentPlan", id);
    const current = await this.plan(tx, patientId, id);
    this.requireScope(ctx, "treatmentplan.send", current.practiceId);
    checkVersion(ctx, current.version);
    if (current.status !== "PROPOSED")
      throw new ApiError("INVALID_STATE_TRANSITION", "Only a proposed option takes the patient's response.");
    const session = await this.handoffs.open(ctx, {
      purpose: "PLAN_RESPONSE",
      patientId,
      treatmentPlanId: id,
    });
    return { data: session, resource: { type: "PatientHandoff", id: session.handoffId } };
  }

  /** What the patient sees in a plan hand-off. */
  async handoffPlan(tx: Tx, planId: string) {
    const p = (await tx.treatmentPlan.findUniqueOrThrow({
      where: { id: planId },
      include: INCLUDE,
    })) as unknown as PlanRow;
    return {
      ...defined({ optionLabel: p.optionLabel }),
      title: p.title,
      items: p.items.map((i) => ({
        treatmentName: i.treatment.name,
        ...defined({ area: i.area }),
        quantity: i.quantity.toFixed(2),
        lineTotal: usd(i.lineTotal),
      })),
      estimatedTotal: usd(p.estimatedTotal),
      notConsentNotice: NOT_CONSENT_NOTICE,
      attestations: PLAN_RESPONSE_ATTESTATIONS,
    };
  }

  async recordResponse(
    ctx: RequestContext,
    body: { decision: "ACCEPTED" | "DECLINED"; signerName: string; attestation: string },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const handoff = requireHandoff(ctx);
    if (handoff.purpose !== "PLAN_RESPONSE" || handoff.treatmentPlanId === null)
      throw new ApiError("INVALID_STATE_TRANSITION", "This hand-off is not for a plan response.");
    if (body.attestation !== PLAN_RESPONSE_ATTESTATIONS[body.decision])
      throw invalid("attestation", "ATTESTATION_CHANGED", "Show the current attestation text and ask again.");
    const id = handoff.treatmentPlanId;
    await lockRow(tx, "TreatmentPlan", id);
    const current = await this.plan(tx, handoff.patientId, id);
    if (current.status !== "PROPOSED")
      throw new ApiError("INVALID_STATE_TRANSITION", "This option already has a response.");
    const now = new Date();
    await tx.treatmentPlan.update({
      where: { id },
      data: {
        status: body.decision,
        respondedAt: now,
        responseSource: "IN_CLINIC",
        responseHandoffId: handoff.id,
        responseAttestation: body.attestation,
        responseSignerName: body.signerName,
        version: { increment: 1 },
      },
    });
    await this.record(tx, ctx, current, "PROPOSED", body.decision, {
      channel: "IN_CLINIC",
      handoffId: handoff.id,
    });
    const declined: string[] = [];
    if (body.decision === "ACCEPTED" && current.consultationId !== null) {
      // Shown options only: drafts were never seen by the patient (K4-07).
      const siblings = await tx.treatmentPlan.findMany({
        where: {
          consultationId: current.consultationId,
          id: { not: id },
          status: { in: ["PROPOSED", "SENT_TO_PATIENT", "VIEWED"] },
        },
        select: { id: true, patientId: true, status: true },
        orderBy: { id: "asc" },
      });
      for (const s of siblings) {
        await lockRow(tx, "TreatmentPlan", s.id);
        await tx.treatmentPlan.update({
          where: { id: s.id },
          data: {
            status: "DECLINED",
            respondedAt: now,
            responseSource: "SIBLING_ACCEPTED",
            acceptedSiblingId: id,
            version: { increment: 1 },
          },
        });
        await this.record(
          tx,
          ctx,
          s,
          s.status,
          "DECLINED",
          { reason: "SIBLING_ACCEPTED", acceptedPlanId: id },
          null,
        );
        declined.push(s.id);
      }
    }
    await this.handoffs.complete(tx, handoff.id);
    return {
      data: { decision: body.decision, respondedAt: iso(now), declinedSiblingIds: declined },
      resource: { type: "TreatmentPlan", id },
    };
  }
}
