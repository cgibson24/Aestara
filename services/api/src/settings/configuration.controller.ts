// Feature flags, practice settings, the offline cache policy and retention
// policies (spec §6.3 administration rows marked L2; ADR-0023 K2-17 to K2-19).
import type { FeatureFlagPut, RetentionPolicyCreate } from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { ConfigurationService } from "./configuration.service.ts";

@Controller()
export class ConfigurationController {
  constructor(private readonly configuration: ConfigurationService) {}

  @Operation("listFeatureFlags")
  listFlags(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.configuration.listFlags(ctx, (ctx.query as { practiceId?: string }).practiceId);
  }

  @Operation("getFeatureFlag")
  getFlag(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.configuration.getFlag(
      ctx,
      ctx.params.key ?? "",
      (ctx.query as { practiceId?: string }).practiceId,
    );
  }

  @Operation("putFeatureFlag")
  putFlag(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.configuration.putFlag(ctx, ctx.params.key ?? "", ctx.body as z.output<typeof FeatureFlagPut>);
  }

  @Operation("getOfflineCachePolicy")
  cachePolicy(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.configuration.offlineCachePolicy(ctx);
  }

  @Operation("getPracticeSetting")
  getPracticeSetting(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.configuration.getPracticeSetting(ctx, ctx.params.practiceId ?? "", ctx.params.key ?? "");
  }

  @Operation("putPracticeSetting")
  putPracticeSetting(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.configuration.putPracticeSetting(
      ctx,
      ctx.params.practiceId ?? "",
      ctx.params.key ?? "",
      (ctx.body as { value: unknown }).value,
    );
  }

  @Operation("listRetentionPolicies")
  listRetention(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.configuration.listRetention(
      ctx,
      ctx.query as Parameters<ConfigurationService["listRetention"]>[1],
    );
  }

  @Operation("createRetentionPolicy")
  createRetention(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.configuration.createRetention(ctx, ctx.body as z.output<typeof RetentionPolicyCreate>);
  }
}
