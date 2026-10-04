// Export jobs (spec §6.7 "Image jobs"; Bible §8.3, §22.4, §34.1 #21;
// ADR-0026 K3-14, K3-15; ADR-0027). An export is an IMAGE_DERIVATIVE job keyed
// `export:{exportId}`, whose output object, derivative and release were all
// created with the request. At dispatch the worker re-checks the release, the
// photos and the annotation layer, resolves the layer's colours (design tokens)
// and sizes (contract constants), and hands image-processing presigned GETs of
// the originals and a write-once PUT for the output. Every attempt writes the
// same object; it becomes AVAILABLE only after its size, SHA-256 and JPEG
// signature check out. A failed export's object is REJECTED and never served.
import { createHash } from "node:crypto";
import {
  ANNOTATION_STROKE_WIDTHS,
  ANNOTATION_TEXT_SIZES,
  AnnotationLayer,
  EXPORT_MAX_EDGE_PX,
} from "@aestara/api-contracts";
import { tokens } from "@aestara/design-tokens";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import { z } from "zod";
import { AwsClients } from "../aws/clients.ts";
import { lockRow } from "../common/concurrency.ts";
import { CONFIG, type WorkerConfig } from "../config.ts";
import { Database, type Tx } from "../db/database.ts";
import { matchesSignature } from "../media/formats.ts";
import { ObjectStore, UPLOAD_URL_SECONDS } from "../media/object-store.ts";
import { Outbox } from "../outbox/outbox.ts";
import { RETRY_DELAYS_MS, STUCK_AFTER_MS } from "./derivatives.ts";
import { WORKER_LOGGER } from "./logger.ts";
import { WorkerDb } from "./worker-db.ts";

const EXPORT_JOB_PREFIX = "export:";
/** A 4096 px JPEG at quality 85 is far below this. */
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;

/** What the request recorded on the job (identifiers and parameters only). */
export type ExportJobInput = {
  exportId: string;
  releaseId: string;
  objectId: string;
  layout: "SINGLE" | "SIDE_BY_SIDE";
  /** The photo, or the set's before and after photos. */
  photoIds: string[];
  annotationId?: string;
  annotationVersion?: number;
  setId?: string;
  /** The set's alignment when the export was requested. */
  transform: { scale: number; rotationDeg: number; translateX: number; translateY: number } | null;
};

interface Source {
  readonly url: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
}

/** The message image-processing reads (spec §6.7): opaque URLs and drawing instructions. */
export interface ExportJobMessage {
  readonly task: "EXPORT";
  readonly jobId: string;
  readonly attempt: number;
  readonly layout: ExportJobInput["layout"];
  readonly sources: readonly Source[];
  readonly output: {
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly maxEdgePx: number;
  };
  readonly shapes: readonly Record<string, unknown>[];
  readonly transform: ExportJobInput["transform"];
  readonly expiresAt: string;
}

/** The result image-processing reports. */
export const ExportJobResult = z.object({
  task: z.literal("EXPORT"),
  jobId: z.uuid(),
  attempt: z.int().min(1),
  status: z.enum(["SUCCEEDED", "FAILED"]),
  output: z
    .object({
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      byteSize: z.int().min(1),
      widthPx: z.int().min(1),
      heightPx: z.int().min(1),
    })
    .optional(),
  errorCode: z.string().max(60).optional(),
  retryable: z.boolean().default(false),
  generator: z.object({ name: z.string().max(60), version: z.string().max(40) }).optional(),
});

type Shape = z.output<typeof AnnotationLayer>["shapes"][number];

/** A layer's shapes with colours as token hex values and sizes as fractions of the photo's height. */
export function resolveShapes(layer: z.output<typeof AnnotationLayer>): Record<string, unknown>[] {
  const colour = (c: Shape["color"]) => tokens.annotation[c.toLowerCase() as keyof typeof tokens.annotation];
  return layer.shapes.map((shape) => {
    if (shape.type === "TEXT")
      return { ...shape, color: colour(shape.color), size: ANNOTATION_TEXT_SIZES[shape.size] };
    return { ...shape, color: colour(shape.color), stroke: ANNOTATION_STROKE_WIDTHS[shape.stroke] };
  });
}

type Prepared = {
  sources: { objectKey: string; contentType: string; byteSize: bigint | null; sha256: string | null }[];
  outputKey: string;
  shapes: Record<string, unknown>[];
  input: ExportJobInput;
};

@Injectable()
export class ExportJobs {
  constructor(
    private readonly db: Database,
    private readonly workerDb: WorkerDb,
    private readonly aws: AwsClients,
    private readonly store: ObjectStore,
    private readonly outbox: Outbox,
    @Inject(CONFIG) private readonly config: Pick<WorkerConfig, "IMAGE_JOBS_QUEUE_URL">,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  /** Handles `image.export.requested` (first attempt or a retry). */
  async dispatch(jobId: string, attempt: number): Promise<void> {
    const organizationId = await this.workerDb.organizationOfJob(jobId);
    if (organizationId === undefined) return;
    const prepared = await this.db.tenant(organizationId, async (tx): Promise<Prepared | undefined> => {
      await lockRow(tx, "AIJob", jobId);
      const job = await tx.aIJob.findUnique({ where: { id: jobId } });
      if (job === null || !job.idempotencyKey.startsWith(EXPORT_JOB_PREFIX)) return undefined;
      // A repeated event, or one overtaken by a later attempt: nothing to do.
      if (job.status !== "QUEUED" || job.attempt !== attempt - 1) return undefined;
      const input = job.inputSummary as ExportJobInput;
      const end = (status: "CANCELLED" | "FAILED", errorCode: string) =>
        this.end(tx, jobId, input, status, errorCode).then(() => undefined);
      const release = await tx.mediaRelease.findUnique({
        where: { id: input.releaseId },
        select: { revokedAt: true },
      });
      if (release === null || release.revokedAt !== null) return end("CANCELLED", "RELEASE_REVOKED");
      const photos = await tx.patientPhoto.findMany({
        where: { id: { in: input.photoIds } },
        include: {
          original: {
            select: { objectKey: true, contentType: true, byteSize: true, sha256: true, status: true },
          },
        },
      });
      const ordered = input.photoIds.map((id) => photos.find((p) => p.id === id));
      const sources = ordered.map((p) =>
        p !== undefined && ["ACCEPTED", "ARCHIVED"].includes(p.status) && p.original.status === "AVAILABLE"
          ? p.original
          : undefined,
      );
      if (sources.some((s) => s === undefined)) return end("FAILED", "SOURCE_UNAVAILABLE");
      let shapes: Record<string, unknown>[] = [];
      if (input.annotationId !== undefined) {
        const annotation = await tx.photoAnnotation.findUnique({
          where: { id: input.annotationId },
          select: { layer: true, version: true, deletedAt: true },
        });
        // Drawing a layer other than the one asked for would export something nobody chose.
        if (
          annotation === null ||
          annotation.deletedAt !== null ||
          annotation.version !== input.annotationVersion
        )
          return end("FAILED", "SOURCE_CHANGED");
        shapes = resolveShapes(AnnotationLayer.parse(annotation.layer));
      }
      const output = await tx.storageObject.findUnique({
        where: { id: input.objectId },
        select: { objectKey: true },
      });
      if (output === null) return end("FAILED", "OUTPUT_UNAVAILABLE");
      await tx.aIJob.update({
        where: { id: jobId },
        data: { status: "RUNNING", attempt, startedAt: new Date(), errorCode: null },
      });
      return {
        sources: sources.filter((s): s is NonNullable<typeof s> => s !== undefined),
        outputKey: output.objectKey,
        shapes,
        input,
      };
    });
    if (prepared === undefined) return;
    const sources = await Promise.all(
      prepared.sources.map(async (o) => {
        const signed = await this.store.presignDownload({
          key: o.objectKey,
          contentType: o.contentType,
          fileName: "source",
          seconds: UPLOAD_URL_SECONDS,
        });
        return {
          ...signed,
          contentType: o.contentType,
          byteSize: Number(o.byteSize ?? 0),
          sha256: o.sha256 ?? "",
        };
      }),
    );
    const put = await this.store.presignUpload({ key: prepared.outputKey, contentType: "image/jpeg" });
    const expiresAt = [put.expiresAt, ...sources.map((s) => s.expiresAt)].reduce((a, b) => (a < b ? a : b));
    const message: ExportJobMessage = {
      task: "EXPORT",
      jobId,
      attempt,
      layout: prepared.input.layout,
      sources: sources.map((s) => ({
        url: s.url,
        contentType: s.contentType,
        byteSize: s.byteSize,
        sha256: s.sha256,
      })),
      output: { url: put.url, headers: put.headers, maxEdgePx: EXPORT_MAX_EDGE_PX },
      shapes: prepared.shapes,
      transform: prepared.input.layout === "SIDE_BY_SIDE" ? prepared.input.transform : null,
      expiresAt: expiresAt.toISOString(),
    };
    // If this send is lost, the stuck-job sweep retries the attempt.
    await this.aws.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.config.IMAGE_JOBS_QUEUE_URL,
        MessageBody: JSON.stringify(message),
      }),
    );
  }

  /** Handles an export result. Duplicates and stale attempts are ignored. */
  async complete(raw: unknown): Promise<void> {
    const parsed = ExportJobResult.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn({ event: "export_result_invalid" }, "an export result did not match its contract");
      return;
    }
    const result = parsed.data;
    const organizationId = await this.workerDb.organizationOfJob(result.jobId);
    if (organizationId === undefined) return;
    await this.db.tenant(organizationId, async (tx) => {
      await lockRow(tx, "AIJob", result.jobId);
      const job = await tx.aIJob.findUnique({ where: { id: result.jobId } });
      if (job === null || !job.idempotencyKey.startsWith(EXPORT_JOB_PREFIX)) return;
      if (job.status !== "RUNNING" || job.attempt !== result.attempt) return;
      const input = job.inputSummary as ExportJobInput;
      if (result.status === "FAILED" || result.output === undefined) {
        const code =
          result.status === "FAILED" ? (result.errorCode ?? "PROCESSING_FAILED") : "OUTPUT_MISSING";
        await this.failAttempt(tx, job.id, organizationId, input, result.attempt, code, result.retryable);
        return;
      }
      const output = result.output;
      if (!(await this.verify(tx, input, output))) {
        // Retrying cannot help: the next attempt meets the same write-once object.
        await this.failAttempt(
          tx,
          job.id,
          organizationId,
          input,
          result.attempt,
          "OUTPUT_VERIFICATION_FAILED",
          false,
        );
        return;
      }
      await tx.storageObject.update({
        where: { id: input.objectId },
        data: {
          status: "AVAILABLE",
          byteSize: BigInt(output.byteSize),
          sha256: output.sha256,
          verifiedAt: new Date(),
        },
      });
      await tx.aIJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          resultSummary: {
            widthPx: output.widthPx,
            heightPx: output.heightPx,
            generator: result.generator?.name ?? "image-processing",
            generatorVersion: result.generator?.version ?? "unknown",
            attempt: result.attempt,
          },
        },
      });
    });
  }

  /** The written object has the reported size and SHA-256 and is a JPEG file. */
  private async verify(
    tx: Tx,
    input: ExportJobInput,
    output: NonNullable<z.output<typeof ExportJobResult>["output"]>,
  ): Promise<boolean> {
    const object = await tx.storageObject.findUnique({
      where: { id: input.objectId },
      select: { objectKey: true },
    });
    if (object === null) return false;
    let bytes: Buffer;
    try {
      bytes = await this.store.read(object.objectKey, MAX_EXPORT_BYTES);
    } catch {
      return false;
    }
    return (
      bytes.length === output.byteSize &&
      createHash("sha256").update(bytes).digest("hex") === output.sha256 &&
      matchesSignature("image/jpeg", bytes)
    );
  }

  /** Ends the job for good; the output object, unless verified, is rejected. */
  private async end(
    tx: Tx,
    jobId: string,
    input: ExportJobInput,
    status: "CANCELLED" | "FAILED" | "TIMED_OUT",
    errorCode: string,
  ): Promise<void> {
    await tx.storageObject.updateMany({
      where: { id: input.objectId, verifiedAt: null },
      data: { status: "REJECTED" },
    });
    await tx.aIJob.update({
      where: { id: jobId },
      data: { status, errorCode: errorCode.slice(0, 60), finishedAt: new Date() },
    });
    if (status !== "CANCELLED")
      this.logger.warn({ event: "export_job_failed", jobId, errorCode }, "an export job failed");
  }

  /** Ends an attempt: the job retries (1, 5 and 30 minutes) or fails. */
  private async failAttempt(
    tx: Tx,
    jobId: string,
    organizationId: string,
    input: ExportJobInput,
    attempt: number,
    errorCode: string,
    retryable: boolean,
    timedOut = false,
  ): Promise<void> {
    const delay = RETRY_DELAYS_MS[attempt - 1];
    if (retryable && delay !== undefined) {
      await tx.aIJob.update({
        where: { id: jobId },
        data: { status: "QUEUED", errorCode: errorCode.slice(0, 60) },
      });
      await this.outbox.add(tx, {
        organizationId,
        eventType: "image.export.requested",
        aggregateId: jobId,
        payload: { jobId, attempt: attempt + 1 },
        availableAt: new Date(Date.now() + delay),
      });
      return;
    }
    await this.end(tx, jobId, input, timedOut ? "TIMED_OUT" : "FAILED", errorCode);
  }

  /** Retries attempts whose result never arrived (a lost message or a crashed service). */
  async sweepStuck(organizationId: string, now = new Date()): Promise<number> {
    return this.db.tenant(organizationId, async (tx) => {
      const stuck = await tx.aIJob.findMany({
        where: {
          jobType: "IMAGE_DERIVATIVE",
          idempotencyKey: { startsWith: EXPORT_JOB_PREFIX },
          status: "RUNNING",
          startedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
        },
        take: 100,
      });
      for (const job of stuck) {
        await lockRow(tx, "AIJob", job.id);
        const fresh = await tx.aIJob.findUniqueOrThrow({ where: { id: job.id } });
        if (fresh.status !== "RUNNING") continue;
        await this.failAttempt(
          tx,
          job.id,
          organizationId,
          fresh.inputSummary as ExportJobInput,
          fresh.attempt,
          "TIMEOUT",
          true,
          true,
        );
      }
      return stuck.length;
    });
  }
}
