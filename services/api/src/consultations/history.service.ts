// A patient's aesthetic concerns and medical history (spec §6.3 "Patients"; Bible
// §5.1 "Select reason / concerns", "Review relevant history"; ADR-0026 K3-08,
// K3-20). Clinical data: readable with consultation.create, never with
// patient.read alone. Organization-owned patient data, so any grant in the
// organization applies (D-01). Changes are audited as PATIENT_UPDATED without
// values; entries are corrected, never deleted.
import type {
  MedicalHistoryCreate,
  MedicalHistoryEntry,
  MedicalHistoryUpdate,
  PatientConcern,
  PatientConcernCreate,
  PatientConcernUpdate,
} from "@aestara/api-contracts";
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

type ConcernRow = {
  id: string;
  patientId: string;
  area: string;
  description: string;
  recordedById: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

type HistoryRow = {
  id: string;
  patientId: string;
  category: z.output<typeof MedicalHistoryEntry>["category"];
  description: string;
  onsetDate: Date | null;
  resolvedAt: Date | null;
  source: z.output<typeof MedicalHistoryEntry>["source"];
  recordedById: string | null;
  recordedAt: Date;
  updatedAt: Date;
  version: number;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

function concernDto(c: ConcernRow): z.input<typeof PatientConcern> {
  return {
    id: c.id,
    patientId: c.patientId,
    area: c.area as z.input<typeof PatientConcern>["area"],
    description: c.description,
    ...defined({ recordedById: c.recordedById, resolvedAt: c.resolvedAt && iso(c.resolvedAt) }),
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
    version: c.version,
  };
}

function historyDto(h: HistoryRow): z.input<typeof MedicalHistoryEntry> {
  return {
    id: h.id,
    patientId: h.patientId,
    category: h.category,
    description: h.description,
    ...defined({
      onsetDate: h.onsetDate && day(h.onsetDate),
      resolvedOn: h.resolvedAt && day(h.resolvedAt),
      recordedById: h.recordedById,
    }),
    source: h.source,
    recordedAt: iso(h.recordedAt),
    updatedAt: iso(h.updatedAt),
    version: h.version,
  };
}

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

function checkDates(onset: string | null | undefined, resolved: string | null | undefined): void {
  const today = new Date().toISOString().slice(0, 10);
  if (onset && onset > today)
    throw invalid("onsetDate", "IN_FUTURE", "The onset date cannot be in the future.");
  if (resolved && resolved > today)
    throw invalid("resolvedOn", "IN_FUTURE", "The resolution date cannot be in the future.");
  if (onset && resolved && resolved < onset)
    throw invalid("resolvedOn", "BEFORE_ONSET", "The resolution date cannot be before the onset date.");
}

@Injectable()
export class HistoryService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
    private readonly idempotency: Idempotency,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("createPatientConcern", async (ctx, id) => {
      const row = await this.concern(requireTx(ctx), ctx.params.patientId ?? "", id);
      return { data: concernDto(row), version: row.version, resource: { type: "PatientConcern", id } };
    });
    this.idempotency.register("createMedicalHistoryEntry", async (ctx, id) => {
      const row = await this.entry(requireTx(ctx), ctx.params.patientId ?? "", id);
      return { data: historyDto(row), version: row.version, resource: { type: "PatientMedicalHistory", id } };
    });
  }

  private async patient(tx: Tx, patientId: string): Promise<{ status: string }> {
    const p = await tx.patient.findUnique({ where: { id: patientId }, select: { status: true } });
    if (p === null) throw notFound("PATIENT_NOT_FOUND");
    return p;
  }

  private async openPatient(tx: Tx, patientId: string): Promise<void> {
    if ((await this.patient(tx, patientId)).status === "ARCHIVED")
      throw new ApiError("INVALID_STATE_TRANSITION", "An archived patient's record cannot change.");
  }

  private async concern(tx: Tx, patientId: string, id: string): Promise<ConcernRow> {
    const c = await tx.patientConcern.findFirst({ where: { id, patientId } });
    if (c === null) throw notFound("PATIENT_CONCERN_NOT_FOUND");
    return c;
  }

  private async entry(tx: Tx, patientId: string, id: string): Promise<HistoryRow> {
    const h = await tx.patientMedicalHistory.findFirst({ where: { id, patientId } });
    if (h === null) throw notFound("MEDICAL_HISTORY_ENTRY_NOT_FOUND");
    return h as HistoryRow;
  }

  // ---- Concerns -----------------------------------------------------------------

  async listConcerns(
    ctx: RequestContext,
    patientId: string,
    query: { limit: number; cursor?: string; includeResolved: boolean },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const after = this.cursors.decode("concerns", query.cursor);
    const rows = await tx.patientConcern.findMany({
      where: {
        patientId,
        ...(query.includeResolved ? {} : { resolvedAt: null }),
        ...(after ? { id: { gt: after.id } } : {}),
      },
      orderBy: { id: "asc" },
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows, query.limit, (c) =>
      this.cursors.encode("concerns", { k: null, id: c.id }),
    );
    return { data: items.map(concernDto), page };
  }

  async createConcern(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof PatientConcernCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.openPatient(tx, patientId);
    const created = await tx.patientConcern.create({
      data: {
        organizationId: requireOrganization(ctx),
        patientId,
        area: body.area,
        description: body.description,
        recordedById: requireAuth(ctx).userId,
      },
    });
    await this.audit.write(tx, ctx, {
      action: "PATIENT_UPDATED",
      resourceType: "PatientConcern",
      resourceId: created.id,
      patientId,
      metadata: { change: "concern.created", area: body.area },
    });
    return {
      data: concernDto(created),
      version: created.version,
      resource: { type: "PatientConcern", id: created.id },
    };
  }

  async updateConcern(
    ctx: RequestContext,
    patientId: string,
    id: string,
    body: z.output<typeof PatientConcernUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.openPatient(tx, patientId);
    await lockRow(tx, "PatientConcern", id);
    const current = await this.concern(tx, patientId, id);
    checkVersion(ctx, current.version);
    const updated = await tx.patientConcern.update({
      where: { id },
      data: {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.resolved !== undefined
          ? { resolvedAt: body.resolved ? (current.resolvedAt ?? new Date()) : null }
          : {}),
        version: { increment: 1 },
      },
    });
    await this.audit.write(tx, ctx, {
      action: "PATIENT_UPDATED",
      resourceType: "PatientConcern",
      resourceId: id,
      patientId,
      metadata: { change: "concern.updated", fields: Object.keys(body) },
    });
    return { data: concernDto(updated), version: updated.version };
  }

  // ---- Medical history ----------------------------------------------------------

  async listHistory(
    ctx: RequestContext,
    patientId: string,
    query: { limit: number; cursor?: string; category?: HistoryRow["category"] },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const after = this.cursors.decode("medical-history", query.cursor);
    const rows = (await tx.patientMedicalHistory.findMany({
      where: {
        patientId,
        ...(query.category ? { category: query.category } : {}),
        ...(after ? { id: { gt: after.id } } : {}),
      },
      orderBy: { id: "asc" },
      take: query.limit + 1,
    })) as HistoryRow[];
    const { items, page } = paginate(rows, query.limit, (h) =>
      this.cursors.encode("medical-history", { k: null, id: h.id }),
    );
    return { data: items.map(historyDto), page };
  }

  async createHistory(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof MedicalHistoryCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.openPatient(tx, patientId);
    checkDates(body.onsetDate, body.resolvedOn);
    const created = (await tx.patientMedicalHistory.create({
      data: {
        organizationId: requireOrganization(ctx),
        patientId,
        category: body.category,
        description: body.description,
        onsetDate: body.onsetDate ? new Date(body.onsetDate) : null,
        resolvedAt: body.resolvedOn ? new Date(body.resolvedOn) : null,
        source: "STAFF",
        recordedById: requireAuth(ctx).userId,
      },
    })) as HistoryRow;
    await this.audit.write(tx, ctx, {
      action: "PATIENT_UPDATED",
      resourceType: "PatientMedicalHistory",
      resourceId: created.id,
      patientId,
      metadata: { change: "history.created", category: body.category },
    });
    return {
      data: historyDto(created),
      version: created.version,
      resource: { type: "PatientMedicalHistory", id: created.id },
    };
  }

  async updateHistory(
    ctx: RequestContext,
    patientId: string,
    id: string,
    body: z.output<typeof MedicalHistoryUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.openPatient(tx, patientId);
    await lockRow(tx, "PatientMedicalHistory", id);
    const current = await this.entry(tx, patientId, id);
    checkVersion(ctx, current.version);
    const onset = body.onsetDate !== undefined ? body.onsetDate : current.onsetDate && day(current.onsetDate);
    const resolved =
      body.resolvedOn !== undefined ? body.resolvedOn : current.resolvedAt && day(current.resolvedAt);
    checkDates(onset, resolved);
    const updated = (await tx.patientMedicalHistory.update({
      where: { id },
      data: {
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.onsetDate !== undefined
          ? { onsetDate: body.onsetDate === null ? null : new Date(body.onsetDate) }
          : {}),
        ...(body.resolvedOn !== undefined
          ? { resolvedAt: body.resolvedOn === null ? null : new Date(body.resolvedOn) }
          : {}),
        version: { increment: 1 },
      },
    })) as HistoryRow;
    await this.audit.write(tx, ctx, {
      action: "PATIENT_UPDATED",
      resourceType: "PatientMedicalHistory",
      resourceId: id,
      patientId,
      metadata: { change: "history.updated", fields: Object.keys(body) },
    });
    return { data: historyDto(updated), version: updated.version };
  }
}
