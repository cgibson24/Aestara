// Routes of the before/after group (spec §6.3 "Before / after"; ADR-0026 K3-11 to K3-13).
import type { BeforeAfterSetCreate, BeforeAfterSetUpdate } from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { BeforeAfterService } from "./before-after.service.ts";

const pid = (ctx: RequestContext) => ctx.params.patientId ?? "";
const sid = (ctx: RequestContext) => ctx.params.setId ?? "";

@Controller()
export class BeforeAfterController {
  constructor(private readonly sets: BeforeAfterService) {}

  @Operation("listBeforeAfterSets")
  list(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.sets.list(ctx, pid(ctx), ctx.query as Parameters<BeforeAfterService["list"]>[2]);
  }

  @Operation("createBeforeAfterSet")
  create(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.sets.create(ctx, pid(ctx), ctx.body as z.output<typeof BeforeAfterSetCreate>);
  }

  @Operation("getBeforeAfterSet")
  get(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.sets.get(ctx, pid(ctx), sid(ctx));
  }

  @Operation("updateBeforeAfterSet")
  update(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.sets.update(ctx, pid(ctx), sid(ctx), ctx.body as z.output<typeof BeforeAfterSetUpdate>);
  }
}
