// Before/after registration jobs (spec §6.7 "Image jobs"; Bible §8.1;
// ADR-0026 K3-13). One IMAGE_REGISTRATION job per request: the worker hands
// image-processing presigned GETs of the two display previews (never the
// originals), and image-processing reports a similarity transform or "no
// reliable alignment". The transform applies only if the set is still at the
// version the job recorded, so a manual alignment or reset made meanwhile
// wins. Transient failures retry like derivative jobs (1, 5 and 30 minutes).
import { RegistrationTransform } from "@aestara/api-contracts";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import { z } from "zod";
import { AwsClients } from "../aws/clients.ts";
import { lockRow } from "../common/concurrency.ts";
import { CONFIG, type WorkerConfig } from "../config.ts";
import { Database, type Tx } from "../db/database.ts";
import { ObjectStore, UPLOAD_URL_SECONDS } from "../media/object-store.ts";
import { Outbox } from "../outbox/outbox.ts";
import { RETRY_DELAYS_MS, STUCK_AFTER_MS } from "./derivatives.ts";
import { WORKER_LOGGER } from "./logger.ts";
import { WorkerDb } from "./worker-db.ts";

/** Automatic registration may not scale beyond this or turn further (ADR-0026 K3-13). */
const AUTOMATIC_SCALE = [0.5, 2] as const;
const AUTOMATIC_ROTATION_DEG = 20;

interface Source {
  readonly url: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
}

/** The message image-processing reads (spec §6.7): opaque URLs only. */
export interface RegistrationJobMessage {
  readonly task: "REGISTRATION";
  readonly jobId: string;
  readonly attempt: number;
  readonly before: Source;
  readonly after: Source;
  readonly expiresAt: string;
}

/** The result image-processing reports. */
export const RegistrationJobResult = z.object({
  task: z.literal("REGISTRATION"),
  jobId: z.uuid(),
  attempt: z.int().min(1),
  status: z.enum(["SUCCEEDED", "FAILED"]),
  transform: z
    .object({
      scale: z.number(),
      rotationDeg: z.number(),
      translateX: z.number(),
      translateY: z.number(),
    })
    .optional(),
  inliers: z.int().min(0).optional(),
  errorCode: z.string().max(60).optional(),
  retryable: z.boolean().default(false),
});

type JobInput = { setId: string; setVersion: number; beforePhotoId: string; afterPhotoId: string };

@Injectable()
export class RegistrationJobs {
  constructor(
    private readonly db: Database,
    private readonly workerDb: WorkerDb,
    private readonly aws: AwsClients,
    private readonly store: ObjectStore,
    private readonly outbox: Outbox,
    @Inject(CONFIG) private readonly config: Pick<WorkerConfig, "IMAGE_JOBS_QUEUE_URL">,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  /** Handles `image.registration.requested` (first attempt or a retry). */
  async dispatch(jobId: string, attempt: number): Promise<void> {
    const organizationId = await this.workerDb.organizationOfJob(jobId);
    if (organizationId === undefined) return;
    const prepared = await this.db.tenant(organizationId, async (tx) => {
      await lockRow(tx, "AIJob", jobId);
      const job = await tx.aIJob.findUnique({ where: { id: jobId } });
      if (job === null || job.jobType !== "IMAGE_REGISTRATION") return undefined;
      // A repeated event, or one overtaken by a later attempt: nothing to do.
      if (job.status !== "QUEUED" || job.attempt !== attempt - 1) return undefined;
      const input = job.inputSummary as JobInput;
      const previews = await tx.photoDerivative.findMany({
        where: { sourcePhotoId: { in: [input.beforePhotoId, input.afterPhotoId] }, kind: "DISPLAY_PREVIEW" },
        include: {
          storageObject: {
            select: { objectKey: true, contentType: true, byteSize: true, sha256: true, status: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      const before = previews.find((p) => p.sourcePhotoId === input.beforePhotoId);
      const after = previews.find((p) => p.sourcePhotoId === input.afterPhotoId);
      if (
        before === undefined ||
        after === undefined ||
        before.storageObject.status !== "AVAILABLE" ||
        after.storageObject.status !== "AVAILABLE"
      ) {
        await tx.aIJob.update({
          where: { id: jobId },
          data: { status: "CANCELLED", errorCode: "SOURCE_UNAVAILABLE", finishedAt: new Date() },
        });
        return undefined;
      }
      await tx.aIJob.update({
        where: { id: jobId },
        data: { status: "RUNNING", attempt, startedAt: new Date(), errorCode: null },
      });
      return { before: before.storageObject, after: after.storageObject };
    });
    if (prepared === undefined) return;
    const source = async (o: typeof prepared.before): Promise<Source & { expiresAt: Date }> => {
      const url = await this.store.presignDownload({
        key: o.objectKey,
        contentType: o.contentType,
        fileName: "preview",
        seconds: UPLOAD_URL_SECONDS,
      });
      return {
        url: url.url,
        contentType: o.contentType,
        byteSize: Number(o.byteSize ?? 0),
        sha256: o.sha256 ?? "",
        expiresAt: url.expiresAt,
      };
    };
    const [before, after] = await Promise.all([source(prepared.before), source(prepared.after)]);
    const message: RegistrationJobMessage = {
      task: "REGISTRATION",
      jobId,
      attempt,
      before: {
        url: before.url,
        contentType: before.contentType,
        byteSize: before.byteSize,
        sha256: before.sha256,
      },
      after: {
        url: after.url,
        contentType: after.contentType,
        byteSize: after.byteSize,
        sha256: after.sha256,
      },
      expiresAt: (before.expiresAt < after.expiresAt ? before.expiresAt : after.expiresAt).toISOString(),
    };
    // If this send is lost, the stuck-job sweep retries the attempt.
    await this.aws.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.config.IMAGE_JOBS_QUEUE_URL,
        MessageBody: JSON.stringify(message),
      }),
    );
  }

  /** Handles a registration result. Duplicates and stale attempts are ignored. */
  async complete(raw: unknown): Promise<void> {
    const parsed = RegistrationJobResult.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        { event: "registration_result_invalid" },
        "a registration result did not match its contract",
      );
      return;
    }
    const result = parsed.data;
    const organizationId = await this.workerDb.organizationOfJob(result.jobId);
    if (organizationId === undefined) return;
    await this.db.tenant(organizationId, async (tx) => {
      await lockRow(tx, "AIJob", result.jobId);
      const job = await tx.aIJob.findUnique({ where: { id: result.jobId } });
      if (job === null || job.jobType !== "IMAGE_REGISTRATION") return;
      if (job.status !== "RUNNING" || job.attempt !== result.attempt) return;
      const transform = result.status === "SUCCEEDED" ? this.plausible(result.transform) : undefined;
      if (transform === undefined) {
        const code =
          result.status === "SUCCEEDED" ? "NO_RELIABLE_ALIGNMENT" : (result.errorCode ?? "PROCESSING_FAILED");
        await this.failAttempt(tx, job.id, organizationId, result.attempt, code, result.retryable);
        return;
      }
      const input = job.inputSummary as JobInput;
      await lockRow(tx, "BeforeAfterSet", input.setId);
      const set = await tx.beforeAfterSet.findUnique({
        where: { id: input.setId },
        select: { version: true, registrationJobId: true },
      });
      // A manual alignment, a reset or a newer request since: the set stays as it is.
      const applies = set !== null && set.version === input.setVersion && set.registrationJobId === job.id;
      if (applies)
        await tx.beforeAfterSet.update({
          where: { id: input.setId },
          data: {
            registrationMode: "AUTOMATIC",
            registrationTransform: transform,
            version: { increment: 1 },
          },
        });
      await tx.aIJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          resultSummary: { inliers: result.inliers ?? 0, applied: applies },
        },
      });
    });
  }

  /** A transform inside the contract and inside what automatic registration may do (ADR-0026 K3-13). */
  private plausible(
    transform: z.output<typeof RegistrationJobResult>["transform"],
  ): z.output<typeof RegistrationTransform> | undefined {
    const parsed = RegistrationTransform.safeParse(transform);
    if (!parsed.success) return undefined;
    const t = parsed.data;
    if (t.scale < AUTOMATIC_SCALE[0] || t.scale > AUTOMATIC_SCALE[1]) return undefined;
    if (Math.abs(t.rotationDeg) > AUTOMATIC_ROTATION_DEG) return undefined;
    return t;
  }

  private async failAttempt(
    tx: Tx,
    jobId: string,
    organizationId: string,
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
        eventType: "image.registration.requested",
        aggregateId: jobId,
        payload: { jobId, attempt: attempt + 1 },
        availableAt: new Date(Date.now() + delay),
      });
      return;
    }
    await tx.aIJob.update({
      where: { id: jobId },
      data: {
        status: timedOut ? "TIMED_OUT" : "FAILED",
        errorCode: errorCode.slice(0, 60),
        finishedAt: new Date(),
      },
    });
  }

  /** Retries attempts whose result never arrived (a lost message or a crashed service). */
  async sweepStuck(organizationId: string, now = new Date()): Promise<number> {
    return this.db.tenant(organizationId, async (tx) => {
      const stuck = await tx.aIJob.findMany({
        where: {
          jobType: "IMAGE_REGISTRATION",
          status: "RUNNING",
          startedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
        },
        take: 100,
      });
      for (const job of stuck) {
        await lockRow(tx, "AIJob", job.id);
        const fresh = await tx.aIJob.findUniqueOrThrow({ where: { id: job.id } });
        if (fresh.status !== "RUNNING") continue;
        await this.failAttempt(tx, job.id, organizationId, fresh.attempt, "TIMEOUT", true, true);
      }
      return stuck.length;
    });
  }
}
