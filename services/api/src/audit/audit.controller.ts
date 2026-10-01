// Audit query (spec §6.3 "/audit/events"; roadmap M1.7). In an organization
// the tenant policy shows only its events; at platform scope the platform
// role's policy shows only platform-level events (spec §4.5 note 4). Filtering
// by patientId is the per-patient access report.
import type { AuditEvent, OfflineAuditBatch } from "@aestara/api-contracts";
import type { AuditAction } from "@aestara/shared-types";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import { defined, iso } from "../common/concurrency.ts";
import { type RequestContext, requireTx } from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { notFound } from "../common/errors.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { OfflineAuditService } from "./offline-audit.service.ts";

type Row = {
  id: string;
  occurredAt: Date;
  action: string;
  outcome: string;
  actorType: string;
  actorUserId: string | null;
  actorServiceId: string | null;
  resourceType: string;
  resourceId: string | null;
  patientId: string | null;
  requestId: string;
  sessionId: string | null;
  deviceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
};

function auditDto(e: Row): z.input<typeof AuditEvent> {
  return {
    id: e.id,
    occurredAt: iso(e.occurredAt),
    action: e.action as AuditAction,
    outcome: e.outcome as "SUCCESS",
    actorType: e.actorType as "USER",
    ...defined({
      actorUserId: e.actorUserId,
      actorServiceId: e.actorServiceId,
      resourceId: e.resourceId,
      patientId: e.patientId,
      sessionId: e.sessionId,
      deviceId: e.deviceId,
      ipAddress: e.ipAddress,
      userAgent: e.userAgent,
    }),
    resourceType: e.resourceType,
    requestId: e.requestId,
    ...(e.metadata !== null && typeof e.metadata === "object"
      ? { metadata: e.metadata as Record<string, unknown> }
      : {}),
  };
}

@Controller()
export class AuditController {
  constructor(
    private readonly cursors: CursorCodec,
    private readonly offline: OfflineAuditService,
  ) {}

  @Operation("recordOfflineAuditEvents")
  replayOffline(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.offline.replay(ctx, ctx.body as z.output<typeof OfflineAuditBatch>);
  }

  @Operation("listAuditEvents")
  async list(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    const q = ctx.query as {
      limit: number;
      cursor?: string;
      actorUserId?: string;
      patientId?: string;
      action?: AuditAction;
      resourceType?: string;
      resourceId?: string;
      from?: string;
      to?: string;
    };
    const tx = requireTx(ctx);
    const after = this.cursors.decode("audit", q.cursor);
    const rows = await tx.auditEvent.findMany({
      where: {
        ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
        ...(q.patientId ? { patientId: q.patientId } : {}),
        ...(q.action ? { action: q.action } : {}),
        ...(q.resourceType ? { resourceType: q.resourceType } : {}),
        ...(q.resourceId ? { resourceId: q.resourceId } : {}),
        ...(q.from || q.to
          ? {
              occurredAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lt: new Date(q.to) } : {}),
              },
            }
          : {}),
        ...(after
          ? {
              OR: [
                { occurredAt: { lt: new Date(after.k ?? 0) } },
                { occurredAt: new Date(after.k ?? 0), id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
    });
    const { items, page } = paginate(rows, q.limit, (e) =>
      this.cursors.encode("audit", { k: e.occurredAt.toISOString(), id: e.id }),
    );
    return { data: items.map(auditDto), page };
  }

  @Operation("getAuditEvent")
  async get(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    const event = await requireTx(ctx).auditEvent.findUnique({ where: { id: ctx.params.id ?? "" } });
    if (event === null) throw notFound("AUDIT_EVENT_NOT_FOUND");
    return { data: auditDto(event) };
  }
}
