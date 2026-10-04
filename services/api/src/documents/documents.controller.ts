// Routes of documents, the consultation summary and the patient timeline
// (spec §6.3; ADR-0026 K3-16 to K3-18; ADR-0027).
import type {
  DocumentAccessUrlRequest,
  DocumentUploadComplete,
  DocumentUploadRequest,
} from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { DocumentsService } from "./documents.service.ts";
import { SummaryService } from "./summary.service.ts";
import { TimelineService } from "./timeline.service.ts";

const pid = (ctx: RequestContext) => ctx.params.patientId ?? "";
const did = (ctx: RequestContext) => ctx.params.documentId ?? "";

@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly summaries: SummaryService,
    private readonly timeline: TimelineService,
  ) {}

  @Operation("listDocuments")
  list(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.documents.list(ctx, pid(ctx), ctx.query as Parameters<DocumentsService["list"]>[2]);
  }

  @Operation("getDocument")
  get(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.documents.get(ctx, pid(ctx), did(ctx));
  }

  @Operation("createDocumentUpload")
  createUpload(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.documents.createUpload(ctx, pid(ctx), ctx.body as z.output<typeof DocumentUploadRequest>);
  }

  @Operation("completeDocumentUpload")
  completeUpload(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    const body = ctx.body as z.output<typeof DocumentUploadComplete>;
    return this.documents.completeUpload(ctx, pid(ctx), did(ctx), body.uploadId, body.changeNote);
  }

  @Operation("createDocumentAccessUrl")
  accessUrl(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    const body = (ctx.body ?? {}) as z.output<typeof DocumentAccessUrlRequest>;
    return this.documents.accessUrl(ctx, pid(ctx), did(ctx), body.versionId);
  }

  @Operation("generateConsultationSummary")
  generateSummary(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.summaries.generate(ctx, pid(ctx), ctx.params.consultationId ?? "");
  }

  @Operation("getPatientTimeline")
  getTimeline(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.timeline.list(ctx, pid(ctx), ctx.query as Parameters<TimelineService["list"]>[2]);
  }
}
