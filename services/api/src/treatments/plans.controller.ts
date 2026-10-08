// Routes of treatment plans and the in-clinic hand-off (spec §6.3 "Treatment
// plans & estimates", "In-clinic hand-off"; ADR-0028 K4-04 to K4-07, K4-13;
// ADR-0029).
import type {
  HandoffPlanResponseRequest,
  TreatmentPlanCancel,
  TreatmentPlanCreate,
  TreatmentPlanItemsPut,
  TreatmentPlanUpdate,
} from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import { defined } from "../common/concurrency.ts";
import { type RequestContext, requireTx } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { HandoffsService, requireHandoff } from "../handoffs/handoffs.service.ts";
import { TreatmentPlansService } from "./plans.service.ts";

const pid = (ctx: RequestContext) => ctx.params.patientId ?? "";
const planId = (ctx: RequestContext) => ctx.params.planId ?? "";
const body = <T extends z.ZodType>(ctx: RequestContext) => ctx.body as z.output<T>;

@Controller()
export class TreatmentPlansController {
  constructor(
    private readonly plans: TreatmentPlansService,
    private readonly handoffs: HandoffsService,
  ) {}

  @Operation("listTreatmentPlans")
  list(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.plans.list(ctx, pid(ctx), ctx.query as Parameters<TreatmentPlansService["list"]>[2]);
  }

  @Operation("createTreatmentPlan")
  create(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.plans.create(ctx, pid(ctx), body<typeof TreatmentPlanCreate>(ctx));
  }

  @Operation("getTreatmentPlan")
  get(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.plans.get(ctx, pid(ctx), planId(ctx));
  }

  @Operation("updateTreatmentPlan")
  update(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.plans.update(ctx, pid(ctx), planId(ctx), body<typeof TreatmentPlanUpdate>(ctx));
  }

  @Operation("putTreatmentPlanItems")
  putItems(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.plans.putItems(ctx, pid(ctx), planId(ctx), body<typeof TreatmentPlanItemsPut>(ctx).items);
  }

  @Operation("proposeTreatmentPlan")
  propose(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.plans.transition(ctx, pid(ctx), planId(ctx), "propose");
  }

  @Operation("reviseTreatmentPlan")
  revise(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.plans.transition(ctx, pid(ctx), planId(ctx), "revise");
  }

  @Operation("cancelTreatmentPlan")
  cancel(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.plans.transition(
      ctx,
      pid(ctx),
      planId(ctx),
      "cancel",
      body<typeof TreatmentPlanCancel>(ctx).reason,
    );
  }

  @Operation("openTreatmentPlanResponse")
  openResponse(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.plans.openResponse(ctx, pid(ctx), planId(ctx));
  }

  // ---- Hand-off routes ----

  @Operation("getHandoff")
  async getHandoff(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const h = requireHandoff(ctx);
    const patient = await tx.patient.findUniqueOrThrow({
      where: { id: h.patientId },
      select: { firstName: true, lastName: true, dateOfBirth: true },
    });
    return {
      data: {
        handoffId: h.id,
        purpose: h.purpose,
        patient: {
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10),
        },
        ...defined({
          plan: h.treatmentPlanId === null ? null : await this.plans.handoffPlan(tx, h.treatmentPlanId),
        }),
        absoluteExpiresAt: h.absoluteExpiresAt.toISOString(),
      },
    };
  }

  @Operation("recordHandoffPlanResponse")
  recordResponse(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.plans.recordResponse(ctx, body<typeof HandoffPlanResponseRequest>(ctx));
  }

  @Operation("endHandoff")
  async end(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    await this.handoffs.end(ctx, ctx.params.handoffId ?? "");
    return { data: undefined };
  }
}
