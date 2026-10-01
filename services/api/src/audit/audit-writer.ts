// The audit writer (spec §7.3; Bible §22; ADR-0018 K-04, K-10, K-18).
// Events are written in the same transaction as the change they describe, so a
// change cannot commit without its event. Metadata holds identifiers, codes and
// counts only, never PHI. The table is append-only in the database.
import type { AuditAction, AuditOutcome } from "@aestara/shared-types";
import { Injectable } from "@nestjs/common";
import type { RequestContext } from "../common/context.ts";
import { Database, type Tx } from "../db/database.ts";

export interface AuditInput {
  readonly action: AuditAction;
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly patientId?: string | null;
  readonly outcome?: AuditOutcome;
  readonly metadata?: Record<string, string | number | boolean | null | string[]>;
  /** Defaults to the caller's active organization; null for platform-level events. */
  readonly organizationId?: string | null;
  /** Defaults to the signed-in user. */
  readonly actorUserId?: string | null;
}

const DENIAL_WINDOW_MS = 60_000;

@Injectable()
export class AuditWriter {
  /** Last written denial per actor + operation + resource, and the repeats since (ADR-0021). */
  private readonly denials = new Map<string, { at: number; suppressed: number }>();

  constructor(private readonly db: Database) {}

  async write(tx: Tx, ctx: RequestContext, event: AuditInput): Promise<void> {
    await tx.auditEvent.createMany({ data: [this.row(ctx, event)] });
  }

  async writeMany(tx: Tx, ctx: RequestContext, events: readonly AuditInput[]): Promise<void> {
    if (events.length > 0) await tx.auditEvent.createMany({ data: events.map((e) => this.row(ctx, e)) });
  }

  /**
   * ACCESS_DENIED for a refused request on a patient route, written in its own
   * transaction because the request's transaction rolls back. Identical denials
   * within 60 seconds are counted, and the next written event carries the count.
   */
  async recordDenial(
    ctx: RequestContext,
    details: { permission: string; patientId: string | null },
  ): Promise<void> {
    const auth = ctx.auth;
    const organizationId = auth?.organizationId;
    if (auth === undefined || organizationId === null || organizationId === undefined) return;
    const operationId = ctx.operation?.operationId ?? "unknown";
    const key = `${auth.userId}|${operationId}|${details.patientId ?? ""}`;
    const now = Date.now();
    const last = this.denials.get(key);
    if (last !== undefined && now - last.at < DENIAL_WINDOW_MS) {
      last.suppressed += 1;
      return;
    }
    this.denials.set(key, { at: now, suppressed: 0 });
    if (this.denials.size > 10_000) this.prune(now);
    await this.db.tenant(organizationId, (tx) =>
      this.write(tx, ctx, {
        action: "ACCESS_DENIED",
        outcome: "DENIED",
        resourceType: details.patientId ? "Patient" : "Route",
        resourceId: details.patientId,
        patientId: details.patientId,
        metadata: {
          operationId,
          permission: details.permission,
          ...(last && last.suppressed > 0 ? { suppressedRepeats: last.suppressed } : {}),
        },
      }),
    );
  }

  private prune(now: number): void {
    for (const [key, value] of this.denials) if (now - value.at >= DENIAL_WINDOW_MS) this.denials.delete(key);
  }

  private row(ctx: RequestContext, e: AuditInput) {
    const auth = ctx.auth;
    const actorUserId = e.actorUserId === undefined ? (auth?.userId ?? null) : e.actorUserId;
    return {
      organizationId: e.organizationId === undefined ? (auth?.organizationId ?? null) : e.organizationId,
      actorType: actorUserId !== null ? ("USER" as const) : ("SYSTEM" as const),
      actorUserId,
      action: e.action,
      outcome: e.outcome ?? "SUCCESS",
      resourceType: e.resourceType,
      resourceId: e.resourceId ?? null,
      patientId: e.patientId ?? null,
      requestId: ctx.requestId,
      sessionId: auth?.sessionId ?? null,
      deviceId: auth?.deviceId ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      ...(e.metadata !== undefined ? { metadata: e.metadata } : {}),
    };
  }
}
