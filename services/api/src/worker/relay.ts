// The outbox relay (spec §3.3, §7.3; ADR-0023 K2-07). It claims committed
// outbox rows with FOR UPDATE SKIP LOCKED, so several workers never take the
// same row, and in the same transaction:
//   - archives audit rows (audit.recorded) to the Object Lock bucket: the WORM
//     copy, one JSON-lines object per day of the rows' occurrence;
//   - publishes every other event to the EventBridge bus;
// then stamps publishedAt. A failure backs the row off and records the attempt.
// Delivery is at least once; consumers recognise an event by its ID.

import { createHash } from "node:crypto";
import type { Prisma } from "@aestara/database";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import { AwsClients } from "../aws/clients.ts";
import { CONFIG, type WorkerConfig } from "../config.ts";
import { WORKER_LOGGER } from "./logger.ts";
import { WorkerDb } from "./worker-db.ts";

type OutboxRow = {
  id: string;
  organizationId: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  attempts: number;
  createdAt: Date;
};

/** The bus source of every api event; EventBridge rules match on it. */
export const EVENT_SOURCE = "aestara.api";
/** The WORM copy's key prefix; one folder per UTC day of occurrence. */
export const AUDIT_ARCHIVE_PREFIX = "audit";

export function archiveKey(day: string, ids: readonly string[]): string {
  const digest = createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 16);
  return `${AUDIT_ARCHIVE_PREFIX}/${day.replaceAll("-", "/")}/${ids[0]}-${ids.length}-${digest}.jsonl`;
}

@Injectable()
export class OutboxRelay {
  constructor(
    private readonly db: WorkerDb,
    private readonly aws: AwsClients,
    @Inject(CONFIG) private readonly config: Pick<WorkerConfig, "EVENT_BUS_NAME" | "AUDIT_ARCHIVE_BUCKET">,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  /** Relays one batch; returns what it published and archived. */
  async relayOnce(limit = 100): Promise<{ published: number; archived: number; failed: number }> {
    return this.db.client.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, "organizationId", "eventType", "aggregateType", "aggregateId", payload, attempts, "createdAt"
            FROM "OutboxEvent"
           WHERE "publishedAt" IS NULL AND "availableAt" <= now()
           ORDER BY "availableAt", id
           LIMIT ${limit}
           FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return { published: 0, archived: 0, failed: 0 };
        const done: string[] = [];
        const failed: { id: string; code: string; attempts: number }[] = [];

        const audits = rows.filter((r) => r.eventType === "audit.recorded");
        if (audits.length > 0) {
          try {
            await this.archive(
              tx,
              audits.map((a) => a.aggregateId),
            );
            done.push(...audits.map((a) => a.id));
          } catch (error) {
            this.logger.error({ err: error, count: audits.length }, "audit archive write failed");
            failed.push(...audits.map((a) => ({ id: a.id, code: "ARCHIVE_FAILED", attempts: a.attempts })));
          }
        }

        const events = rows.filter((r) => r.eventType !== "audit.recorded");
        for (let i = 0; i < events.length; i += 10) {
          const chunk = events.slice(i, i + 10);
          try {
            const out = await this.aws.events.send(
              new PutEventsCommand({
                Entries: chunk.map((e) => ({
                  EventBusName: this.config.EVENT_BUS_NAME,
                  Source: EVENT_SOURCE,
                  DetailType: e.eventType,
                  Detail: JSON.stringify({
                    eventId: e.id,
                    organizationId: e.organizationId,
                    aggregateType: e.aggregateType,
                    aggregateId: e.aggregateId,
                    payload: e.payload,
                    occurredAt: e.createdAt.toISOString(),
                  }),
                })),
              }),
            );
            chunk.forEach((e, j) => {
              const entry = out.Entries?.[j];
              if (entry?.EventId) done.push(e.id);
              else
                failed.push({
                  id: e.id,
                  code: entry?.ErrorCode ?? "PUT_EVENTS_FAILED",
                  attempts: e.attempts,
                });
            });
          } catch (error) {
            this.logger.error({ err: error, count: chunk.length }, "event publication failed");
            failed.push(...chunk.map((e) => ({ id: e.id, code: "PUT_EVENTS_FAILED", attempts: e.attempts })));
          }
        }

        if (done.length > 0)
          await tx.$executeRaw`UPDATE "OutboxEvent" SET "publishedAt" = now() WHERE id = ANY(${done}::uuid[])`;
        for (const f of failed) {
          // Back off exponentially, at most five minutes between attempts.
          const delaySeconds = Math.min(300, 2 ** Math.min(f.attempts, 8));
          await tx.$executeRaw`
            UPDATE "OutboxEvent"
               SET attempts = attempts + 1, "lastErrorCode" = ${f.code.slice(0, 60)},
                   "availableAt" = now() + make_interval(secs => ${delaySeconds})
             WHERE id = ${f.id}::uuid`;
        }
        const auditIds = new Set(audits.map((a) => a.id));
        const archived = done.filter((id) => auditIds.has(id)).length;
        return { published: done.length - archived, archived, failed: failed.length };
      },
      { timeout: 30_000 },
    );
  }

  /** Writes the audit rows to the WORM bucket, one object per UTC day of occurrence. */
  private async archive(tx: Prisma.TransactionClient, ids: readonly string[]): Promise<void> {
    const rows = await tx.$queryRaw<Record<string, unknown>[]>`
      SELECT id, "organizationId", "actorType", "actorUserId", "actorServiceId", action, outcome, "resourceType",
             "resourceId", "patientId", "requestId", "sessionId", "deviceId", host("ipAddress") AS "ipAddress",
             "userAgent", metadata, "occurredAt"
        FROM "AuditEvent" WHERE id = ANY(${[...ids]}::uuid[]) ORDER BY id`;
    const byDay = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const day = (row.occurredAt as Date).toISOString().slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), row]);
    }
    for (const [day, dayRows] of byDay) {
      const body = Buffer.from(`${dayRows.map((r) => JSON.stringify(r)).join("\n")}\n`);
      try {
        await this.aws.s3.send(
          new PutObjectCommand({
            Bucket: this.config.AUDIT_ARCHIVE_BUCKET,
            Key: archiveKey(
              day,
              dayRows.map((r) => String(r.id)),
            ),
            Body: body,
            ContentType: "application/x-ndjson",
            IfNoneMatch: "*",
            ChecksumSHA256: createHash("sha256").update(body).digest("base64"),
          }),
        );
      } catch (error) {
        // The same batch was archived before a crash, ahead of its commit: already done.
        if ((error as { name?: string }).name !== "PreconditionFailed") throw error;
      }
    }
  }
}
