// Routes of the export group (spec §6.3; ADR-0026 K3-14, K3-15; ADR-0027).
import type { BeforeAfterExportCreate, PhotoExportCreate } from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { ExportsService } from "./exports.service.ts";

const pid = (ctx: RequestContext) => ctx.params.patientId ?? "";

@Controller()
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Operation("createPhotoExport")
  createForPhoto(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.exports.createForPhoto(
      ctx,
      pid(ctx),
      ctx.params.photoId ?? "",
      ctx.body as z.output<typeof PhotoExportCreate>,
    );
  }

  @Operation("createBeforeAfterExport")
  createForSet(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    const body = ctx.body as z.output<typeof BeforeAfterExportCreate>;
    return this.exports.createForSet(ctx, pid(ctx), ctx.params.setId ?? "", body.purpose);
  }

  @Operation("getExport")
  get(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.exports.get(ctx, pid(ctx), ctx.params.exportId ?? "");
  }

  @Operation("createExportAccessUrl")
  accessUrl(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.exports.accessUrl(ctx, pid(ctx), ctx.params.exportId ?? "");
  }
}
