// Routes of the treatment catalog (spec §6.3 "Treatment plans & estimates";
// ADR-0028 K4-03, ADR-0029).
import type {
  TreatmentCategoryCreate,
  TreatmentCategoryUpdate,
  TreatmentCreate,
  TreatmentUpdate,
} from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { TreatmentCatalogService } from "./catalog.service.ts";

const body = <T extends z.ZodType>(ctx: RequestContext) => ctx.body as z.output<T>;

@Controller()
export class TreatmentCatalogController {
  constructor(private readonly catalog: TreatmentCatalogService) {}

  @Operation("listTreatmentCategories")
  listCategories(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.catalog.listCategories(
      ctx,
      ctx.query as Parameters<TreatmentCatalogService["listCategories"]>[1],
    );
  }

  @Operation("createTreatmentCategory")
  createCategory(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.catalog.createCategory(ctx, body<typeof TreatmentCategoryCreate>(ctx));
  }

  @Operation("updateTreatmentCategory")
  updateCategory(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.catalog.updateCategory(ctx, ctx.params.id ?? "", body<typeof TreatmentCategoryUpdate>(ctx));
  }

  @Operation("listTreatments")
  listTreatments(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.catalog.listTreatments(
      ctx,
      ctx.query as Parameters<TreatmentCatalogService["listTreatments"]>[1],
    );
  }

  @Operation("createTreatment")
  createTreatment(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.catalog.createTreatment(ctx, body<typeof TreatmentCreate>(ctx));
  }

  @Operation("updateTreatment")
  updateTreatment(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.catalog.updateTreatment(ctx, ctx.params.id ?? "", body<typeof TreatmentUpdate>(ctx));
  }
}
