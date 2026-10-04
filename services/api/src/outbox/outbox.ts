// The transactional outbox (spec §3.3, §2.1 "Queues & events"; ADR-0023 K2-07).
// An event is a row written in the same transaction as the change it reports,
// so it is published only if the change commits. Payloads carry identifiers
// and codes only, never PHI; the worker's relay publishes them.
import { uuidv7 } from "@aestara/database";
import { Injectable } from "@nestjs/common";
import type { Tx } from "../db/database.ts";

/** Every event type the api emits, and who consumes it. */
export const OUTBOX_EVENT_TYPES = {
  /** A verified original entered the scan (spec §3.4 flow A). No Layer 2 consumer; archived on the bus. */
  "photo.captured": "PatientPhoto",
  /** A derivative job is due, first or retried (K2-06). Consumed by the worker's dispatcher. */
  "image.derivative.requested": "AIJob",
  /** A before/after registration job is due (ADR-0026 K3-13). Consumed by the worker's dispatcher. */
  "image.registration.requested": "AIJob",
  /** An export render is due (ADR-0026 K3-15). Consumed by the worker's dispatcher. */
  "image.export.requested": "AIJob",
  /** A grant ended; the payload lists the releases revoked with it [B §7.3] (K2-15). */
  "photo_permission.revoked": "PhotoPermission",
} as const;

export type OutboxEventType = keyof typeof OUTBOX_EVENT_TYPES;

export interface OutboxInput {
  readonly organizationId: string;
  readonly eventType: OutboxEventType;
  readonly aggregateId: string;
  readonly payload?: Record<string, string | number | boolean | null | string[]>;
  /** Publish no earlier than this (retry backoff). */
  readonly availableAt?: Date;
}

@Injectable()
export class Outbox {
  async add(tx: Tx, event: OutboxInput): Promise<void> {
    await tx.outboxEvent.createMany({
      data: [
        {
          id: uuidv7(),
          organizationId: event.organizationId,
          eventType: event.eventType,
          aggregateType: OUTBOX_EVENT_TYPES[event.eventType],
          aggregateId: event.aggregateId,
          payload: event.payload ?? {},
          ...(event.availableAt !== undefined ? { availableAt: event.availableAt } : {}),
        },
      ],
    });
  }
}
