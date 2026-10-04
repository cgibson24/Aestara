// Routes of the "Consultations" group (spec §6.3, §5.4.1; ADR-0026).
import type { ConsultationCreate, ConsultationUpdate } from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { ConsultationsService, type TransitionAction } from "./consultations.service.ts";

const pid = (ctx: RequestContext) => ctx.params.patientId ?? "";
const cid = (ctx: RequestContext) => ctx.params.consultationId ?? "";

@Controller()
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

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
}
