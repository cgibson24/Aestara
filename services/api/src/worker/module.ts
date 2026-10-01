// The worker process (spec §3.1 "worker"; ADR-0023 K2-06, K2-07): the api's
// codebase in a separate deployable. It relays the outbox, dispatches image
// jobs and records their results, applies malware scan results, and runs the
// scheduled jobs. It holds no signing keys and no platform credentials.
import "reflect-metadata";
import { type DynamicModule, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import type { DestinationStream, Logger } from "pino";
import { AuditWriter } from "../audit/audit-writer.ts";
import { AwsClients } from "../aws/clients.ts";
import { createLogger, NestPinoLogger } from "../common/logging.ts";
import { CONFIG, type WorkerConfig } from "../config.ts";
import { Database } from "../db/database.ts";
import { ObjectStore } from "../media/object-store.ts";
import { Outbox } from "../outbox/outbox.ts";
import { PhotoIntake } from "../photos/intake.ts";
import { PermissionLedger } from "../photos/permission-ledger.ts";
import { DerivativeJobs } from "./derivatives.ts";
import { ScheduledJobs } from "./jobs.ts";
import { WORKER_LOGGER } from "./logger.ts";
import { OutboxRelay } from "./relay.ts";
import { LocalScanner, ScanResults } from "./scans.ts";
import { QueueConsumer } from "./sqs.ts";
import { WorkerDb } from "./worker-db.ts";

@Module({})
class WorkerModule {
  static register(config: WorkerConfig, logger: Logger): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: WORKER_LOGGER, useValue: logger },
        Database,
        WorkerDb,
        AuditWriter,
        Outbox,
        AwsClients,
        ObjectStore,
        PhotoIntake,
        PermissionLedger,
        OutboxRelay,
        DerivativeJobs,
        ScanResults,
        ...(config.MALWARE_SCANNER === "local" ? [LocalScanner] : []),
        ScheduledJobs,
      ],
    };
  }
}

const MINUTE = 60_000;

export class Worker {
  private readonly consumers: QueueConsumer[] = [];
  private readonly timers: NodeJS.Timeout[] = [];
  private relaying = false;

  constructor(
    readonly context: INestApplicationContext,
    private readonly config: WorkerConfig,
    readonly logger: Logger,
  ) {
    const aws = context.get(AwsClients);
    const derivatives = context.get(DerivativeJobs);
    const scans = context.get(ScanResults);
    const consumer = (url: string, name: string, handler: (body: unknown) => Promise<void>) =>
      new QueueConsumer(aws.sqs, url, name, handler, logger);
    this.consumers.push(
      consumer(config.WORKER_EVENTS_QUEUE_URL, "worker-events", async (body) => {
        const event = body as { "detail-type"?: string; detail?: { payload?: { jobId?: string; attempt?: number } } };
        if (event["detail-type"] === "image.derivative.requested" && event.detail?.payload?.jobId)
          await derivatives.dispatch(event.detail.payload.jobId, event.detail.payload.attempt ?? 1);
      }),
      consumer(config.IMAGE_RESULTS_QUEUE_URL, "image-results", (body) => derivatives.complete(body)),
      consumer(config.SCAN_RESULTS_QUEUE_URL, "scan-results", (body) => scans.handle(body)),
    );
    if (config.MALWARE_SCANNER === "local" && config.SCAN_REQUESTS_QUEUE_URL !== undefined) {
      const scanner = context.get(LocalScanner);
      this.consumers.push(consumer(config.SCAN_REQUESTS_QUEUE_URL, "scan-requests", (body) => scanner.handle(body)));
    }
  }

  /** A queue consumer by name (tests drive the worker one poll at a time). */
  consumer(name: "worker-events" | "image-results" | "scan-results" | "scan-requests"): QueueConsumer {
    const found = this.consumers.find((c) => c.name === name);
    if (found === undefined) throw new Error(`No ${name} consumer`);
    return found;
  }

  start(): void {
    const relay = this.context.get(OutboxRelay);
    const jobs = this.context.get(ScheduledJobs);
    for (const c of this.consumers) c.start();
    const every = (ms: number, name: string, task: () => Promise<unknown>) =>
      this.timers.push(
        setInterval(() => {
          task().catch((error) => this.logger.error({ err: error, task: name }, "scheduled task failed"));
        }, ms),
      );
    every(this.config.RELAY_INTERVAL_MS, "relay", async () => {
      if (this.relaying) return;
      this.relaying = true;
      try {
        // Drain: keep relaying while batches come back full of work.
        for (;;) {
          const batch = await relay.relayOnce();
          if (batch.published + batch.archived === 0) break;
        }
      } finally {
        this.relaying = false;
      }
    });
    every(MINUTE, "sweep-derivatives", () => jobs.sweepDerivatives());
    every(60 * MINUTE, "expire-permissions", () => jobs.expirePermissions());
    every(24 * 60 * MINUTE, "reconcile-audit", () => jobs.reconcileAudit());
    this.logger.info({ consumers: this.consumers.length }, "worker started");
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    await Promise.all(this.consumers.map((c) => c.stop()));
    await this.context.close();
  }
}

export async function createWorker(
  config: WorkerConfig,
  options: { logDestination?: DestinationStream } = {},
): Promise<Worker> {
  const logger = createLogger(config, options.logDestination, "worker");
  const context = await NestFactory.createApplicationContext(WorkerModule.register(config, logger), {
    logger: new NestPinoLogger(logger),
    abortOnError: false,
  });
  return new Worker(context, config, logger);
}
