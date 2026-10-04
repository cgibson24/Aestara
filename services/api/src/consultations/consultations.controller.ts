// Routes of the "Consultations" group (spec §6.3, §5.4.1; ADR-0026).
import type {
  ConsultationConcernsPut,
  ConsultationCreate,
  ConsultationNoteCreate,
  ConsultationNoteUpdate,
  ConsultationUpdate,
  MedicalHistoryCreate,
  MedicalHistoryUpdate,
  PatientConcernCreate,
  PatientConcernUpdate,
} from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { ConsultationsService, type TransitionAction } from "./consultations.service.ts";
import { HistoryService } from "./history.service.ts";
import { NotesService } from "./notes.service.ts";

const pid = (ctx: RequestContext) => ctx.params.patientId ?? "";
const cid = (ctx: RequestContext) => ctx.params.consultationId ?? "";
const nid = (ctx: RequestContext) => ctx.params.noteId ?? "";

@Controller()
export class ConsultationsController {
  constructor(
    private readonly consultations: ConsultationsService,
    private readonly notes: NotesService,
    private readonly history: HistoryService,
  ) {}

  @Operation("listConsultations")
  list(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.consultations.list(ctx, pid(ctx), ctx.query as Parameters<ConsultationsService["list"]>[2]);
  }

  @Operation("createConsultation")
  create(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.consultations.create(ctx, pid(ctx), ctx.body as z.output<typeof ConsultationCreate>);
  }

  @Operation("getConsultation")
  get(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.consultations.get(ctx, pid(ctx), cid(ctx));
  }

  @Operation("updateConsultation")
  update(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.consultations.update(
      ctx,
      pid(ctx),
      cid(ctx),
      ctx.body as z.output<typeof ConsultationUpdate>,
    );
  }

  private move(ctx: RequestContext, action: TransitionAction): Promise<OperationResult> {
    return this.consultations.transition(
      ctx,
      pid(ctx),
      cid(ctx),
      action,
      (ctx.body ?? {}) as { reason?: string; releaseDecision?: "NOTHING_TO_RELEASE" },
    );
  }

  @Operation("startConsultation")
  start(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.move(ctx, "start");
  }

  @Operation("requestConsultationInformation")
  requestInformation(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.move(ctx, "request-information");
  }

  @Operation("resumeConsultation")
  resume(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.move(ctx, "resume");
  }

  @Operation("submitConsultationForReview")
  submitForReview(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.move(ctx, "submit-for-review");
  }

  @Operation("returnConsultationToProgress")
  returnToProgress(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.move(ctx, "return-to-progress");
  }

  @Operation("cancelConsultation")
  cancel(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.move(ctx, "cancel");
  }

  @Operation("completeConsultation")
  complete(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.move(ctx, "complete");
  }

  @Operation("archiveConsultation")
  archive(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.move(ctx, "archive");
  }

  @Operation("putConsultationConcerns")
  putConcerns(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    const body = ctx.body as z.output<typeof ConsultationConcernsPut>;
    return this.consultations.putConcerns(ctx, pid(ctx), cid(ctx), body.concernIds);
  }

  // ---- Notes ----------------------------------------------------------------------

  @Operation("listConsultationNotes")
  listNotes(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.notes.list(ctx, pid(ctx), cid(ctx), ctx.query as { limit: number; cursor?: string });
  }

  @Operation("createConsultationNote")
  createNote(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.notes.create(ctx, pid(ctx), cid(ctx), ctx.body as z.output<typeof ConsultationNoteCreate>);
  }

  @Operation("updateConsultationNote")
  updateNote(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.notes.update(
      ctx,
      pid(ctx),
      cid(ctx),
      nid(ctx),
      ctx.body as z.output<typeof ConsultationNoteUpdate>,
    );
  }

  @Operation("deleteConsultationNote")
  deleteNote(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.notes.discard(ctx, pid(ctx), cid(ctx), nid(ctx));
  }

  @Operation("finalizeConsultationNote")
  finalizeNote(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.notes.finalize(ctx, pid(ctx), cid(ctx), nid(ctx));
  }

  // ---- Concerns and medical history -------------------------------------------------

  @Operation("listPatientConcerns")
  listConcerns(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.history.listConcerns(
      ctx,
      pid(ctx),
      ctx.query as Parameters<HistoryService["listConcerns"]>[2],
    );
  }

  @Operation("createPatientConcern")
  createConcern(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.history.createConcern(ctx, pid(ctx), ctx.body as z.output<typeof PatientConcernCreate>);
  }

  @Operation("updatePatientConcern")
  updateConcern(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.history.updateConcern(
      ctx,
      pid(ctx),
      ctx.params.concernId ?? "",
      ctx.body as z.output<typeof PatientConcernUpdate>,
    );
  }

  @Operation("listMedicalHistory")
  listHistory(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.history.listHistory(ctx, pid(ctx), ctx.query as Parameters<HistoryService["listHistory"]>[2]);
  }

  @Operation("createMedicalHistoryEntry")
  createHistory(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.history.createHistory(ctx, pid(ctx), ctx.body as z.output<typeof MedicalHistoryCreate>);
  }

  @Operation("updateMedicalHistoryEntry")
  updateHistory(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.history.updateHistory(
      ctx,
      pid(ctx),
      ctx.params.entryId ?? "",
      ctx.body as z.output<typeof MedicalHistoryUpdate>,
    );
  }
}
