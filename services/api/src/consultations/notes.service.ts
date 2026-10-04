// Consultation notes (spec §6.3 "Consultations"; Bible §5.1, §23.1; UD-15;
// ADR-0026 K3-06, K3-07). A note is drafted (also offline, with a client
// UUIDv7), changed and finalized only by its author; a FINAL note is immutable
// and corrected by addenda. The database enforces the same rules (FINAL
// immutable, notes only while the consultation is open, addenda after
// completion, an addendum corrects a FINAL note of the same consultation).
// Bodies are clinical text: stored, returned to authorized readers, never logged.
import type { ConsultationNote, ConsultationNoteCreate } from "@aestara/api-contracts";
import { uuidv7 } from "@aestara/database";
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
import { ConsultationsService } from "./consultations.service.ts";

type NoteRow = {
  id: string;
  consultationId: string;
  authorUserId: string;
  status: "DRAFT" | "FINAL";
  body: string;
  correctsNoteId: string | null;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

function noteDto(n: NoteRow): z.input<typeof ConsultationNote> {
  return {
    id: n.id,
    consultationId: n.consultationId,
    authorUserId: n.authorUserId,
    status: n.status,
    body: n.body,
    ...defined({ correctsNoteId: n.correctsNoteId, finalizedAt: n.finalizedAt && iso(n.finalizedAt) }),
    createdAt: iso(n.createdAt),
    updatedAt: iso(n.updatedAt),
    version: n.version,
  };
}

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

/** Consultation states that take new notes; after completion only addenda (ADR-0026 K3-07). */
const OPEN_FOR_NOTES = ["IN_PROGRESS", "AWAITING_INFORMATION"];

@Injectable()
export class NotesService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
    private readonly idempotency: Idempotency,
    private readonly consultations: ConsultationsService,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("createConsultationNote", async (ctx, id) => {
      const row = await this.note(requireTx(ctx), ctx.params.consultationId ?? "", id);
      return { data: noteDto(row), version: row.version, resource: { type: "ConsultationNote", id } };
    });
  }

  private async note(tx: Tx, consultationId: string, id: string): Promise<NoteRow> {
    const n = await tx.consultationNote.findFirst({ where: { id, consultationId } });
    if (n === null) throw notFound("CONSULTATION_NOTE_NOT_FOUND");
    return n;
  }

  /** The note, after checking its consultation, the caller's practice scope, authorship and If-Match. */
  private async ownDraft(ctx: RequestContext, patientId: string, consultationId: string, id: string) {
    const tx = requireTx(ctx);
    const c = await this.consultations.consultation(tx, patientId, consultationId);
    await lockRow(tx, "ConsultationNote", id);
    const n = await this.note(tx, consultationId, id);
    this.consultations.requireScope(ctx, "consultation.edit", c.practiceId, c.locationId);
    if (n.authorUserId !== requireAuth(ctx).userId)
      throw new ApiError("PERMISSION_DENIED", "Only the note's author can change, discard or finalize it.");
    checkVersion(ctx, n.version);
    if (n.status === "FINAL")
      throw new ApiError("IMMUTABLE_RECORD", "A final note never changes. Write an addendum to correct it.");
    if (!(OPEN_FOR_NOTES.includes(c.status) || (c.status === "COMPLETED" && n.correctsNoteId !== null)))
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        c.status === "READY_FOR_REVIEW"
          ? "The consultation is under review. Return it to progress to change its notes."
          : "This consultation's notes can no longer change.",
      );
    return { tx, consultation: c, note: n };
  }

  async list(
    ctx: RequestContext,
    patientId: string,
    consultationId: string,
    query: { limit: number; cursor?: string },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.consultations.consultation(tx, patientId, consultationId);
    const after = this.cursors.decode("notes", query.cursor);
    const rows = await tx.consultationNote.findMany({
      where: { consultationId, ...(after ? { id: { gt: after.id } } : {}) },
      orderBy: { id: "asc" },
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows, query.limit, (n) =>
      this.cursors.encode("notes", { k: null, id: n.id }),
    );
    return { data: items.map(noteDto), page };
  }

  async create(
    ctx: RequestContext,
    patientId: string,
    consultationId: string,
    body: z.output<typeof ConsultationNoteCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const c = await this.consultations.consultation(tx, patientId, consultationId);
    this.consultations.requireScope(ctx, "consultation.edit", c.practiceId, c.locationId);
    const addendum = body.correctsNoteId !== undefined;
    if (!(OPEN_FOR_NOTES.includes(c.status) || (c.status === "COMPLETED" && addendum)))
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        c.status === "COMPLETED"
          ? "After completion only an addendum to a final note can be written."
          : c.status === "DRAFT"
            ? "Start the consultation before writing notes."
            : c.status === "READY_FOR_REVIEW"
              ? "The consultation is under review. Return it to progress to write a note."
              : "This consultation takes no new notes.",
      );
    if (body.correctsNoteId !== undefined) {
      const target = await tx.consultationNote.findFirst({
        where: { id: body.correctsNoteId, consultationId },
        select: { status: true },
      });
      if (target === null || target.status !== "FINAL")
        throw invalid(
          "correctsNoteId",
          "NOT_A_FINAL_NOTE",
          "An addendum corrects a final note of this consultation.",
        );
    }
    const id = body.id ?? uuidv7();
    if ((await tx.consultationNote.count({ where: { id } })) > 0) throw new ApiError("CONFLICT");
    try {
      const created = await tx.consultationNote.create({
        data: {
          id,
          organizationId: requireOrganization(ctx),
          patientId,
          consultationId,
          authorUserId: requireAuth(ctx).userId,
          body: body.body,
          correctsNoteId: body.correctsNoteId ?? null,
        },
      });
      return {
        data: noteDto(created),
        version: created.version,
        resource: { type: "ConsultationNote", id },
      };
    } catch (error) {
      // The ID is taken outside this organization: a generic conflict, nothing more (spec §6.1.8).
      if ((error as { code?: string }).code === "P2002") throw new ApiError("CONFLICT");
      throw error;
    }
  }

  async update(
    ctx: RequestContext,
    patientId: string,
    consultationId: string,
    id: string,
    body: { body: string },
  ): Promise<OperationResult> {
    const { tx } = await this.ownDraft(ctx, patientId, consultationId, id);
    const updated = await tx.consultationNote.update({
      where: { id },
      data: { body: body.body, version: { increment: 1 } },
    });
    return { data: noteDto(updated), version: updated.version };
  }

  async discard(
    ctx: RequestContext,
    patientId: string,
    consultationId: string,
    id: string,
  ): Promise<OperationResult> {
    const { tx } = await this.ownDraft(ctx, patientId, consultationId, id);
    await tx.consultationNote.delete({ where: { id } });
    return {};
  }

  async finalize(
    ctx: RequestContext,
    patientId: string,
    consultationId: string,
    id: string,
  ): Promise<OperationResult> {
    const { tx, note } = await this.ownDraft(ctx, patientId, consultationId, id);
    const updated = await tx.consultationNote.update({
      where: { id },
      data: { status: "FINAL", finalizedAt: new Date(), version: { increment: 1 } },
    });
    await this.audit.write(tx, ctx, {
      action: "CONSULTATION_NOTE_FINALIZED",
      resourceType: "ConsultationNote",
      resourceId: id,
      patientId,
      metadata: { consultationId, addendum: note.correctsNoteId !== null },
    });
    return { data: noteDto(updated), version: updated.version };
  }
}
