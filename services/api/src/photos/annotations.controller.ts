// Routes of the annotation group (spec §6.3 "Photography"; ADR-0026 K3-10).
import type { PhotoAnnotationCreate, PhotoAnnotationUpdate } from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { AnnotationsService } from "./annotations.service.ts";

const pid = (ctx: RequestContext) => ctx.params.patientId ?? "";
const phid = (ctx: RequestContext) => ctx.params.photoId ?? "";
const aid = (ctx: RequestContext) => ctx.params.annotationId ?? "";

@Controller()
export class AnnotationsController {
  constructor(private readonly annotations: AnnotationsService) {}

  @Operation("listPhotoAnnotations")
  list(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.annotations.list(ctx, pid(ctx), phid(ctx));
  }

  @Operation("createPhotoAnnotation")
  create(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.annotations.create(
      ctx,
      pid(ctx),
      phid(ctx),
      ctx.body as z.output<typeof PhotoAnnotationCreate>,
    );
  }

  @Operation("updatePhotoAnnotation")
  update(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.annotations.update(
      ctx,
      pid(ctx),
      phid(ctx),
      aid(ctx),
      ctx.body as z.output<typeof PhotoAnnotationUpdate>,
    );
  }

  @Operation("deletePhotoAnnotation")
  remove(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.annotations.remove(ctx, pid(ctx), phid(ctx), aid(ctx));
  }
}
