// Derivative jobs (spec §6.7 "Image jobs"; Bible §6.6; ADR-0023 K2-01, K2-06).
// One IMAGE_DERIVATIVE job per accepted photo produces its THUMBNAIL and
// DISPLAY_PREVIEW. For each attempt the worker registers the two output
// objects in the ledger first, then hands image-processing presigned URLs: a
// GET of the original and a write-once PUT for each output, all valid 10
// minutes. image-processing has no database access and sees no PHI. Results
// are verified (size, SHA-256, JPEG signature) before a derivative is recorded.
import { createHash } from "node:crypto";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { DERIVATIVE_MAX_EDGE_PX } from "@aestara/api-contracts";
import { uuidv7 } from "@aestara/database";
import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import { z } from "zod";
import { lockRow } from "../common/concurrency.ts";
import { AwsClients } from "../aws/clients.ts";
import { CONFIG, type WorkerConfig } from "../config.ts";
import { Database, type Tx } from "../db/database.ts";
import { matchesSignature } from "../media/formats.ts";
import { ObjectStore, UPLOAD_URL_SECONDS } from "../media/object-store.ts";
import { Outbox } from "../outbox/outbox.ts";
import { WORKER_LOGGER } from "./logger.ts";
import { WorkerDb } from "./worker-db.ts";

export const DERIVATIVE_KINDS = ["THUMBNAIL", "DISPLAY_PREVIEW"] as const;
type Kind = (typeof DERIVATIVE_KINDS)[number];

/** Retries after a transient failure: 1, 5 and 30 minutes, then the job fails (K2-06). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
/** A job running longer than this is presumed lost and retried. */
export const STUCK_AFTER_MS = 15 * 60_000;
const MAX_DERIVATIVE_BYTES = 16 * 1024 * 1024;

/** The message image-processing reads (spec §6.7). Opaque URLs and parameters only. */
export interface ImageJobMessage {
  readonly jobId: string;
  readonly attempt: number;
  readonly source: { readonly url: string; readonly contentType: string; readonly byteSize: number; readonly sha256: string };
  readonly outputs: readonly {
    readonly kind: Kind;
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly maxEdgePx: number;
    readonly contentType: "image/jpeg";
  }[];
  readonly expiresAt: string;
}

/** The result image-processing reports. */
export const ImageJobResult = z.object({
  jobId: z.uuid(),
  attempt: z.int().min(1),
  status: z.enum(["SUCCEEDED", "FAILED"]),
  outputs: z
    .array(
      z.object({
        kind: z.enum(DERIVATIVE_KINDS),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        byteSize: z.int().min(1),
        widthPx: z.int().min(1),
        heightPx: z.int().min(1),
      }),
    )
    .default([]),
  errorCode: z.string().max(60).optional(),
  retryable: z.boolean().default(false),
  generator: z.object({ name: z.string().max(60), version: z.string().max(40) }).optional(),
});

type JobInput = { photoId: string; outputs?: Partial<Record<Kind, string>> };

@Injectable()
export class DerivativeJobs {
  constructor(
    private readonly db: Database,
    private readonly workerDb: WorkerDb,
    private readonly aws: AwsClients,
    private readonly store: ObjectStore,
    private readonly outbox: Outbox,
    @Inject(CONFIG) private readonly config: Pick<WorkerConfig, "IMAGE_JOBS_QUEUE_URL">,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  /** Handles `image.derivative.requested` (first attempt or a retry). */
  async dispatch(jobId: string, attempt: number): Promise<void> {
    const organizationId = await this.workerDb.organizationOfJob(jobId);
    if (organizationId === undefined) return;
    const prepared = await this.db.tenant(organizationId, async (tx) => {
      await lockRow(tx, "AIJob", jobId);
      const job = await tx.aIJob.findUnique({ where: { id: jobId } });
      // A repeated event, or one overtaken by a later attempt: nothing to do.
      if (job === null || job.status !== "QUEUED" || job.attempt !== attempt - 1) return undefined;
      const input = job.inputSummary as JobInput;
      const photo = await tx.patientPhoto.findUnique({
        where: { id: input.photoId },
        include: { original: { select: { objectKey: true, contentType: true, byteSize: true, sha256: true, status: true } } },
      });
      if (photo === null || !["ACCEPTED", "ARCHIVED"].includes(photo.status) || photo.original.status !== "AVAILABLE") {
        await tx.aIJob.update({
          where: { id: jobId },
          data: { status: "CANCELLED", errorCode: "SOURCE_UNAVAILABLE", finishedAt: new Date() },
        });
        return undefined;
      }
      const outputs: { kind: Kind; id: string; key: string }[] = DERIVATIVE_KINDS.map((kind) => ({
        kind,
        id: uuidv7(),
        key: this.store.newKey("CLINICAL_DERIVATIVE"),
      }));
      await tx.storageObject.createMany({
        data: outputs.map((o) => ({
          id: o.id,
          organizationId,
          objectClass: "CLINICAL_DERIVATIVE" as const,
          bucket: this.store.bucket,
          objectKey: o.key,
          contentType: "image/jpeg",
          status: "PENDING_UPLOAD" as const,
          // Derivatives are produced by the platform from a scanned original (K2-04).
          scanStatus: "NOT_REQUIRED" as const,
          kmsKeyAlias: this.store.kmsKeyId,
        })),
      });
      await tx.aIJob.update({
        where: { id: jobId },
        data: {
          status: "RUNNING",
          attempt,
          startedAt: new Date(),
          errorCode: null,
          inputSummary: { photoId: photo.id, outputs: Object.fromEntries(outputs.map((o) => [o.kind, o.id])) },
        },
      });
      return { photo, outputs };
    });
    if (prepared === undefined) return;
    const { photo, outputs } = prepared;
    const source = await this.store.presignDownload({
      key: photo.original.objectKey,
      contentType: photo.original.contentType,
      fileName: "source",
      seconds: UPLOAD_URL_SECONDS,
    });
    const message: ImageJobMessage = {
      jobId,
      attempt,
      source: {
        url: source.url,
        contentType: photo.original.contentType,
        byteSize: Number(photo.original.byteSize ?? 0),
        sha256: photo.original.sha256 ?? "",
      },
      outputs: await Promise.all(
        outputs.map(async (o) => {
          const put = await this.store.presignUpload({ key: o.key, contentType: "image/jpeg" });
          return { kind: o.kind, url: put.url, headers: put.headers, maxEdgePx: DERIVATIVE_MAX_EDGE_PX[o.kind], contentType: "image/jpeg" as const };
        }),
      ),
      expiresAt: source.expiresAt.toISOString(),
    };
    // If this send is lost, the stuck-job sweep retries the attempt.
    await this.aws.sqs.send(new SendMessageCommand({ QueueUrl: this.config.IMAGE_JOBS_QUEUE_URL, MessageBody: JSON.stringify(message) }));
  }

  /** Handles a result from image-processing. Duplicates and stale attempts are ignored. */
  async complete(raw: unknown): Promise<void> {
    const parsed = ImageJobResult.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn({ event: "image_result_invalid" }, "an image result did not match its contract");
      return;
    }
    const result = parsed.data;
    const organizationId = await this.workerDb.organizationOfJob(result.jobId);
    if (organizationId === undefined) return;
    await this.db.tenant(organizationId, async (tx) => {
      await lockRow(tx, "AIJob", result.jobId);
      const job = await tx.aIJob.findUnique({ where: { id: result.jobId } });
      if (job === null || job.status !== "RUNNING" || job.attempt !== result.attempt) return;
      const input = job.inputSummary as JobInput;
      if (result.status === "FAILED") {
        await this.failAttempt(tx, job.id, organizationId, input, result.attempt, result.errorCode ?? "FAILED", result.retryable);
        return;
      }
      const verified = await this.verifyOutputs(tx, input, result.outputs);
      if (!verified) {
        await this.failAttempt(tx, job.id, organizationId, input, result.attempt, "OUTPUT_VERIFICATION_FAILED", true);
        return;
      }
      const photo = await tx.patientPhoto.findUniqueOrThrow({ where: { id: input.photoId }, select: { patientId: true } });
      for (const output of result.outputs) {
        const objectId = input.outputs?.[output.kind] ?? "";
        await tx.storageObject.update({
          where: { id: objectId },
          data: {
            status: "AVAILABLE",
            byteSize: BigInt(output.byteSize),
            sha256: output.sha256,
            verifiedAt: new Date(),
          },
        });
        await tx.photoDerivative.create({
          data: {
            organizationId,
            patientId: photo.patientId,
            sourcePhotoId: input.photoId,
            kind: output.kind,
            storageObjectId: objectId,
            generatedByJobId: job.id,
            generationMetadata: {
              generator: result.generator?.name ?? "image-processing",
              generatorVersion: result.generator?.version ?? "unknown",
              maxEdgePx: DERIVATIVE_MAX_EDGE_PX[output.kind],
              widthPx: output.widthPx,
              heightPx: output.heightPx,
              format: "image/jpeg",
              metadataStripped: true,
              attempt: result.attempt,
            },
          },
        });
      }
      await tx.aIJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          resultSummary: { outputs: result.outputs.map((o) => ({ kind: o.kind, widthPx: o.widthPx, heightPx: o.heightPx })) },
        },
      });
    });
  }

  /** Both outputs exist with the reported size and SHA-256 and are JPEG files. */
  private async verifyOutputs(
    tx: Tx,
    input: JobInput,
    outputs: z.output<typeof ImageJobResult>["outputs"],
  ): Promise<boolean> {
    if (DERIVATIVE_KINDS.some((kind) => !outputs.some((o) => o.kind === kind))) return false;
    for (const output of outputs) {
      const objectId = input.outputs?.[output.kind];
      if (objectId === undefined) return false;
      const object = await tx.storageObject.findUnique({ where: { id: objectId }, select: { objectKey: true } });
      if (object === null) return false;
      let bytes: Buffer;
      try {
        bytes = await this.store.read(object.objectKey, MAX_DERIVATIVE_BYTES);
      } catch {
        return false;
      }
      if (bytes.length !== output.byteSize) return false;
      if (createHash("sha256").update(bytes).digest("hex") !== output.sha256) return false;
      if (!matchesSignature("image/jpeg", bytes)) return false;
    }
    return true;
  }

  /** Ends an attempt: its outputs are marked rejected, then the job retries or fails. */
  private async failAttempt(
    tx: Tx,
    jobId: string,
    organizationId: string,
    input: JobInput,
    attempt: number,
    errorCode: string,
    retryable: boolean,
    timedOut = false,
  ): Promise<void> {
    const outputIds = Object.values(input.outputs ?? {}).filter((id): id is string => typeof id === "string");
    if (outputIds.length > 0)
      await tx.storageObject.updateMany({
        where: { id: { in: outputIds }, verifiedAt: null },
        data: { status: "REJECTED" },
      });
    const delay = RETRY_DELAYS_MS[attempt - 1];
    if (retryable && delay !== undefined) {
      await tx.aIJob.update({ where: { id: jobId }, data: { status: "QUEUED", errorCode: errorCode.slice(0, 60) } });
      await this.outbox.add(tx, {
        organizationId,
        eventType: "image.derivative.requested",
        aggregateId: jobId,
        payload: { jobId, photoId: input.photoId, attempt: attempt + 1 },
        availableAt: new Date(Date.now() + delay),
      });
      return;
    }
    await tx.aIJob.update({
      where: { id: jobId },
      data: { status: timedOut ? "TIMED_OUT" : "FAILED", errorCode: errorCode.slice(0, 60), finishedAt: new Date() },
    });
    this.logger.warn({ event: "derivative_job_failed", jobId, errorCode }, "a derivative job failed");
  }

  /** Retries attempts whose result never arrived (a lost message or a crashed service). */
  async sweepStuck(organizationId: string, now = new Date()): Promise<number> {
    return this.db.tenant(organizationId, async (tx) => {
      const stuck = await tx.aIJob.findMany({
        where: { jobType: "IMAGE_DERIVATIVE", status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
        take: 100,
      });
      for (const job of stuck) {
        await lockRow(tx, "AIJob", job.id);
        const fresh = await tx.aIJob.findUniqueOrThrow({ where: { id: job.id } });
        if (fresh.status !== "RUNNING") continue;
        await this.failAttempt(tx, job.id, organizationId, fresh.inputSummary as JobInput, fresh.attempt, "TIMEOUT", true, true);
      }
      return stuck.length;
    });
  }
}
