// Patients and contacts (spec §6.3 "Patients", §6.6.1, §5.4.10; Bible §4;
// ADR-0018 K-17, K-20; ADR-0020; ADR-0021). Every query runs in the caller's
// tenant transaction, so Row-Level Security bounds it to the organization;
// patient data is shared by the organization's practices (D-01).
import {
  type DuplicateCheckRequest,
  type DuplicateCheckResult,
  PATIENT_PROFILE_TABS,
  type Patient,
  type PatientContact,
  type PatientContactCreate,
  type PatientContactUpdate,
  type PatientCreate,
  type PatientProfile,
  type PatientSearchRequest,
  type PatientSummary,
  type PatientUpdate,
} from "@aestara/api-contracts";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { checkVersion, defined, iso, lockRow, present } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { ApiError, notFound, rateLimited } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import type { Tx } from "../db/database.ts";
import { readSetting } from "../settings/settings-store.ts";
import { emailKey, nameKey, phoneKey, prefixRange, similarNames } from "./search-keys.ts";

type PatientRow = {
  id: string;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED" | "DECEASED";
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: Date;
  email: string | null;
  phone: string | null;
  mrn: string | null;
  externalEmrIdentifier: string | null;
  primaryPracticeId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  firstNameKey: string;
  lastNameKey: string;
  preferredNameKey: string | null;
};

type ContactRow = {
  id: string;
  patientId: string;
  kind: "EMERGENCY_CONTACT" | "GUARDIAN" | "CAREGIVER" | "OTHER";
  fullName: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

const date = (d: Date) => d.toISOString().slice(0, 10);
const SEARCH_LIMIT_PER_MINUTE = 60;
const MAX_CANDIDATES = 10;

export function patientDto(p: PatientRow): z.input<typeof Patient> {
  return {
    id: p.id,
    status: p.status,
    firstName: p.firstName,
    lastName: p.lastName,
    dateOfBirth: date(p.dateOfBirth),
    ...defined({
      middleName: p.middleName,
      preferredName: p.preferredName,
      email: p.email,
      phone: p.phone,
      mrn: p.mrn,
      externalEmrIdentifier: p.externalEmrIdentifier,
      primaryPracticeId: p.primaryPracticeId,
      archivedAt: p.archivedAt && iso(p.archivedAt),
    }),
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
    version: p.version,
  };
}

function summaryDto(p: PatientRow): z.input<typeof PatientSummary> {
  return {
    id: p.id,
    status: p.status,
    firstName: p.firstName,
    lastName: p.lastName,
    dateOfBirth: date(p.dateOfBirth),
    ...defined({ preferredName: p.preferredName, mrn: p.mrn, primaryPracticeId: p.primaryPracticeId }),
    updatedAt: iso(p.updatedAt),
  };
}

function contactDto(c: ContactRow): z.input<typeof PatientContact> {
  return {
    id: c.id,
    patientId: c.patientId,
    kind: c.kind,
    fullName: c.fullName,
    ...defined({ relationship: c.relationship, phone: c.phone, email: c.email, notes: c.notes }),
    isPrimary: c.isPrimary,
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
    version: c.version,
  };
}

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

type Candidate = {
  patientId: string;
  matchReasons: ("SAME_EMAIL" | "SAME_PHONE" | "SAME_MRN" | "SAME_DATE_OF_BIRTH_SIMILAR_NAME")[];
  row: PatientRow;
};

@Injectable()
export class PatientsService implements OnModuleInit {
  /** Search requests per user in the current minute (spec §6.1.10 per-user limits). */
  /** Per user, the times of the searches in the last minute (a sliding window). */
  private readonly searches = new Map<string, number[]>();

  constructor(
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
    private readonly idempotency: Idempotency,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("createPatient", async (ctx, id) => {
      const patient = await requireTx(ctx).patient.findUnique({ where: { id } });
      if (patient === null) throw notFound("PATIENT_NOT_FOUND");
      return { data: patientDto(patient), version: patient.version, resource: { type: "Patient", id } };
    });
  }

  private async patient(tx: Tx, id: string): Promise<PatientRow> {
    const p = await tx.patient.findUnique({ where: { id } });
    if (p === null) throw notFound("PATIENT_NOT_FOUND");
    return p;
  }

  private async checkPractice(tx: Tx, practiceId: string | null | undefined): Promise<void> {
    if (practiceId === null || practiceId === undefined) return;
    if ((await tx.practice.count({ where: { id: practiceId } })) === 0)
      throw invalid("primaryPracticeId", "UNKNOWN_PRACTICE", "Choose one of the organization's practices.");
  }

  private async checkMrn(tx: Tx, mrn: string | null | undefined, exceptId?: string): Promise<void> {
    if (mrn === null || mrn === undefined) return;
    const taken = await tx.patient.count({ where: { mrn, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
    if (taken > 0) throw new ApiError("CONFLICT", "This MRN is already in use.");
  }

  // ---- Search and list -----------------------------------------------------

  /** At most 60 searches in any 60 seconds per user; a sliding window, so no burst across a minute boundary. */
  private rateLimit(userId: string): void {
    const now = Date.now();
    const recent = (this.searches.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= SEARCH_LIMIT_PER_MINUTE) {
      this.searches.set(userId, recent);
      throw rateLimited(((recent[0] ?? now) + 60_000 - now) / 1000);
    }
    recent.push(now);
    if (!this.searches.has(userId) && this.searches.size > 50_000) this.searches.clear();
    this.searches.set(userId, recent);
  }

  async search(ctx: RequestContext, body: z.output<typeof PatientSearchRequest>): Promise<OperationResult> {
    const tx = requireTx(ctx);
    this.rateLimit(requireAuth(ctx).userId);
    const conditions: object[] = [];
    if (body.name !== undefined) {
      const words = body.name
        .split(/\s+/)
        .map(nameKey)
        .filter((w) => w !== "");
      if (words.length === 0) throw invalid("name", "INVALID", "Type letters or digits of the name.");
      const first = words[0] ?? "";
      const last = words.at(-1) ?? "";
      const givenOrPreferred = (k: string) => ({
        OR: [{ firstNameKey: prefixRange(k) }, { preferredNameKey: prefixRange(k) }],
      });
      conditions.push(
        words.length === 1
          ? {
              OR: [
                { lastNameKey: prefixRange(first) },
                { firstNameKey: prefixRange(first) },
                { preferredNameKey: prefixRange(first) },
              ],
            }
          : {
              OR: [
                { AND: [givenOrPreferred(first), { lastNameKey: prefixRange(last) }] },
                { AND: [givenOrPreferred(last), { lastNameKey: prefixRange(first) }] },
              ],
            },
      );
    }
    if (body.dateOfBirth !== undefined) conditions.push({ dateOfBirth: new Date(body.dateOfBirth) });
    if (body.mrn !== undefined) conditions.push({ mrn: body.mrn });
    if (body.email !== undefined) conditions.push({ emailKey: emailKey(body.email) });
    if (body.phone !== undefined) {
      const digits = phoneKey(body.phone);
      if (digits === "") throw invalid("phone", "INVALID", "Type the digits of the phone number.");
      conditions.push({ phoneKey: digits });
    }
    if (!body.includeArchived) conditions.push({ status: { not: "ARCHIVED" } });
    const after = this.cursors.decode("patient-search", body.cursor);
    if (after !== undefined)
      conditions.push({
        OR: [{ lastNameKey: { gt: after.k ?? "" } }, { lastNameKey: after.k ?? "", id: { gt: after.id } }],
      });
    const rows = await tx.patient.findMany({
      where: { AND: conditions },
      orderBy: [{ lastNameKey: "asc" }, { id: "asc" }],
      take: body.limit + 1,
    });
    const { items, page } = paginate(rows, body.limit, (p) =>
      this.cursors.encode("patient-search", { k: p.lastNameKey, id: p.id }),
    );
    return { data: items.map(summaryDto), page };
  }

  async list(
    ctx: RequestContext,
    query: {
      limit: number;
      cursor?: string;
      status?: PatientRow["status"];
      practiceId?: string;
      sort: "-updatedAt" | "lastName";
    },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const scope = `patients:${query.sort}`;
    const after = this.cursors.decode(scope, query.cursor);
    const keyset =
      after === undefined
        ? {}
        : query.sort === "lastName"
          ? {
              OR: [
                { lastNameKey: { gt: after.k ?? "" } },
                { lastNameKey: after.k ?? "", id: { gt: after.id } },
              ],
            }
          : {
              OR: [
                { updatedAt: { lt: new Date(after.k ?? 0) } },
                { updatedAt: new Date(after.k ?? 0), id: { lt: after.id } },
              ],
            };
    const rows = await tx.patient.findMany({
      where: {
        status: query.status ?? { not: "ARCHIVED" },
        ...(query.practiceId ? { primaryPracticeId: query.practiceId } : {}),
        ...keyset,
      },
      orderBy:
        query.sort === "lastName"
          ? [{ lastNameKey: "asc" }, { id: "asc" }]
          : [{ updatedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows, query.limit, (p) =>
      this.cursors.encode(scope, {
        k: query.sort === "lastName" ? p.lastNameKey : p.updatedAt.toISOString(),
        id: p.id,
      }),
    );
    return { data: items.map(summaryDto), page };
  }

  // ---- Duplicates and create -----------------------------------------------

  /**
   * Probable duplicates (Bible §4.1; ADR-0021): narrowed by leakproof, indexed
   * equalities (email, phone, MRN, date of birth), then names are compared
   * within that small set.
   */
  private async candidates(
    tx: Tx,
    p: {
      firstName: string;
      lastName: string;
      dateOfBirth: string;
      email?: string | null | undefined;
      phone?: string | null | undefined;
      mrn?: string | null | undefined;
    },
  ): Promise<Candidate[]> {
    const or: object[] = [{ dateOfBirth: new Date(p.dateOfBirth) }];
    if (p.email) or.push({ emailKey: emailKey(p.email) });
    if (p.phone) or.push({ phoneKey: phoneKey(p.phone) });
    if (p.mrn) or.push({ mrn: p.mrn });
    const rows = await tx.patient.findMany({ where: { OR: or, status: { not: "ARCHIVED" } }, take: 200 });
    const first = nameKey(p.firstName);
    const last = nameKey(p.lastName);
    const found: Candidate[] = [];
    for (const row of rows) {
      const reasons: Candidate["matchReasons"] = [];
      if (p.email && row.email !== null && emailKey(row.email) === emailKey(p.email))
        reasons.push("SAME_EMAIL");
      if (p.phone && row.phone !== null && phoneKey(row.phone) === phoneKey(p.phone))
        reasons.push("SAME_PHONE");
      if (p.mrn && row.mrn === p.mrn) reasons.push("SAME_MRN");
      if (
        date(row.dateOfBirth) === p.dateOfBirth &&
        (similarNames(row.lastNameKey, last) ||
          similarNames(row.firstNameKey, first) ||
          similarNames(row.preferredNameKey ?? "", first))
      )
        reasons.push("SAME_DATE_OF_BIRTH_SIMILAR_NAME");
      if (reasons.length > 0) found.push({ patientId: row.id, matchReasons: reasons, row });
    }
    return found.sort((a, b) => b.matchReasons.length - a.matchReasons.length).slice(0, MAX_CANDIDATES);
  }

  async duplicateCheck(
    ctx: RequestContext,
    body: z.output<typeof DuplicateCheckRequest>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const canRead = requireAuth(ctx).permissions.has("patient.read");
    const found = await this.candidates(tx, body);
    const data: z.input<typeof DuplicateCheckResult> = {
      candidates: found.map((c) => ({
        patientId: c.patientId,
        matchReasons: c.matchReasons,
        ...(canRead ? { summary: summaryDto(c.row) } : {}),
      })),
    };
    return { data };
  }

  async create(ctx: RequestContext, body: z.output<typeof PatientCreate>): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const organizationId = requireOrganization(ctx);
    const required = await readSetting(tx, organizationId, "patients.primaryPracticeRequired");
    if (required.value && !body.primaryPracticeId)
      throw invalid("primaryPracticeId", "REQUIRED", "This organization requires a primary practice.");
    await this.checkPractice(tx, body.primaryPracticeId);
    await this.checkMrn(tx, body.mrn);
    if (!body.confirmNoDuplicate) {
      const found = await this.candidates(tx, body);
      if (found.length > 0)
        throw new ApiError("DUPLICATE_PATIENT_SUSPECTED", undefined, {
          candidates: found.map((c) => ({ patientId: c.patientId, matchReasons: c.matchReasons })),
        });
    }
    const patient = await tx.patient.create({
      data: {
        organizationId,
        firstName: body.firstName,
        middleName: body.middleName ?? null,
        lastName: body.lastName,
        preferredName: body.preferredName ?? null,
        dateOfBirth: new Date(body.dateOfBirth),
        email: body.email ? emailKey(body.email) : null,
        phone: body.phone ?? null,
        primaryPracticeId: body.primaryPracticeId ?? null,
        mrn: body.mrn ?? null,
        createdById: auth.userId,
        updatedById: auth.userId,
      },
    });
    await this.audit.write(tx, ctx, {
      action: "PATIENT_CREATED",
      resourceType: "Patient",
      resourceId: patient.id,
      patientId: patient.id,
      metadata: { duplicateConfirmed: body.confirmNoDuplicate },
    });
    return {
      data: patientDto(patient),
      version: patient.version,
      resource: { type: "Patient", id: patient.id },
    };
  }

  // ---- Profile, update, archive ---------------------------------------------

  async profile(ctx: RequestContext, id: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const patient = await this.patient(tx, id);
    await this.audit.write(tx, ctx, {
      action: "PATIENT_VIEWED",
      resourceType: "Patient",
      resourceId: id,
      patientId: id,
    });
    const data: z.input<typeof PatientProfile> = {
      patient: patientDto(patient),
      tabs: PATIENT_PROFILE_TABS.map((t) => ({ key: t.key, readable: auth.permissions.has(t.permission) })),
    };
    return { data, version: patient.version };
  }

  async update(
    ctx: RequestContext,
    id: string,
    body: z.output<typeof PatientUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    await lockRow(tx, "Patient", id);
    const current = await this.patient(tx, id);
    checkVersion(ctx, current.version);
    if (body.status !== undefined && current.status === "ARCHIVED")
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        "An archived patient's status cannot change (spec §5.4.10).",
      );
    if (body.primaryPracticeId === null) {
      const required = await readSetting(tx, requireOrganization(ctx), "patients.primaryPracticeRequired");
      if (required.value)
        throw invalid("primaryPracticeId", "REQUIRED", "This organization requires a primary practice.");
    }
    await this.checkPractice(tx, body.primaryPracticeId);
    await this.checkMrn(tx, body.mrn, id);
    const fields = Object.keys(body);
    const updated = await tx.patient.update({
      where: { id },
      data: {
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.middleName !== undefined ? { middleName: body.middleName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        ...(body.preferredName !== undefined ? { preferredName: body.preferredName } : {}),
        ...(body.dateOfBirth !== undefined ? { dateOfBirth: new Date(body.dateOfBirth) } : {}),
        ...(body.email !== undefined ? { email: body.email === null ? null : emailKey(body.email) } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.primaryPracticeId !== undefined ? { primaryPracticeId: body.primaryPracticeId } : {}),
        ...(body.mrn !== undefined ? { mrn: body.mrn } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        updatedById: auth.userId,
        version: { increment: 1 },
      },
    });
    await this.audit.write(tx, ctx, {
      action: "PATIENT_UPDATED",
      resourceType: "Patient",
      resourceId: id,
      patientId: id,
      metadata: {
        fields,
        ...(body.status !== undefined && body.status !== current.status
          ? { statusFrom: current.status, statusTo: body.status }
          : {}),
      },
    });
    return { data: patientDto(updated), version: updated.version };
  }

  async archive(ctx: RequestContext, id: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    await lockRow(tx, "Patient", id);
    const current = await this.patient(tx, id);
    checkVersion(ctx, current.version);
    if (current.status === "ARCHIVED")
      throw new ApiError("INVALID_STATE_TRANSITION", "The patient is already archived.");
    const now = new Date();
    const updated = await tx.patient.update({
      where: { id },
      data: {
        status: "ARCHIVED",
        archivedAt: now,
        archivedById: auth.userId,
        updatedById: auth.userId,
        version: { increment: 1 },
      },
    });
    await this.audit.write(tx, ctx, {
      action: "PATIENT_ARCHIVED",
      resourceType: "Patient",
      resourceId: id,
      patientId: id,
      metadata: { statusFrom: current.status },
    });
    return { data: patientDto(updated), version: updated.version };
  }

  // ---- Contacts ---------------------------------------------------------------

  async listContacts(
    ctx: RequestContext,
    patientId: string,
    query: { limit: number; cursor?: string },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const after = this.cursors.decode("contacts", query.cursor);
    const rows = await tx.patientContact.findMany({
      where: { patientId, ...(after ? { id: { gt: after.id } } : {}) },
      orderBy: { id: "asc" },
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows, query.limit, (c) =>
      this.cursors.encode("contacts", { k: null, id: c.id }),
    );
    return { data: items.map(contactDto), page };
  }

  private async clearOtherPrimary(tx: Tx, patientId: string, keepId: string): Promise<void> {
    await tx.patientContact.updateMany({
      where: { patientId, isPrimary: true, NOT: { id: keepId } },
      data: { isPrimary: false, version: { increment: 1 } },
    });
  }

  async createContact(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof PatientContactCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    await this.patient(tx, patientId);
    const contact = await tx.patientContact.create({
      data: {
        organizationId: requireOrganization(ctx),
        patientId,
        kind: body.kind,
        fullName: body.fullName,
        relationship: body.relationship ?? null,
        phone: body.phone ?? null,
        email: body.email ? emailKey(body.email) : null,
        isPrimary: body.isPrimary,
        notes: body.notes ?? null,
        createdById: auth.userId,
      },
    });
    if (contact.isPrimary) await this.clearOtherPrimary(tx, patientId, contact.id);
    await this.audit.write(tx, ctx, {
      action: "PATIENT_UPDATED",
      resourceType: "PatientContact",
      resourceId: contact.id,
      patientId,
      metadata: { change: "CONTACT_ADDED" },
    });
    return { data: contactDto(contact), version: contact.version };
  }

  async updateContact(
    ctx: RequestContext,
    patientId: string,
    contactId: string,
    body: z.output<typeof PatientContactUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "PatientContact", contactId);
    const current = await tx.patientContact.findFirst({ where: { id: contactId, patientId } });
    if (current === null) throw notFound("PATIENT_CONTACT_NOT_FOUND");
    checkVersion(ctx, current.version);
    const updated = await tx.patientContact.update({
      where: { id: contactId },
      data: {
        ...present(body),
        ...(body.email ? { email: emailKey(body.email) } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.isPrimary) await this.clearOtherPrimary(tx, patientId, contactId);
    await this.audit.write(tx, ctx, {
      action: "PATIENT_UPDATED",
      resourceType: "PatientContact",
      resourceId: contactId,
      patientId,
      metadata: { change: "CONTACT_UPDATED", fields: Object.keys(body) },
    });
    return { data: contactDto(updated), version: updated.version };
  }

  async deleteContact(ctx: RequestContext, patientId: string, contactId: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const current = await tx.patientContact.findFirst({
      where: { id: contactId, patientId },
      select: { id: true },
    });
    if (current === null) throw notFound("PATIENT_CONTACT_NOT_FOUND");
    await tx.patientContact.delete({ where: { id: contactId } });
    await this.audit.write(tx, ctx, {
      action: "PATIENT_UPDATED",
      resourceType: "PatientContact",
      resourceId: contactId,
      patientId,
      metadata: { change: "CONTACT_REMOVED" },
    });
    return {};
  }
}
