// Idempotency-Key handling (spec §6.1.8; ADR-0021). The key row is inserted in
// the request transaction, so a concurrent duplicate waits on the unique index
// and then sees the committed outcome; after 3 seconds it answers
// 409 IDEMPOTENCY_IN_PROGRESS instead. Only the outcome reference is stored
// (status, resource type and ID), never the body; a replay returns the current
// representation of the created resource.

import type { EndpointDefinition } from "@aestara/api-contracts";
import { IDEMPOTENCY_RETENTION_DAYS } from "@aestara/api-contracts";
import { uuidv7 } from "@aestara/database";
import { Injectable } from "@nestjs/common";
import type { Tx } from "../db/database.ts";
import type { RequestContext } from "./context.ts";
import { canonicalJson, sha256Hex } from "./crypto.ts";
import { ApiError, mapDatabaseError } from "./errors.ts";
import type { OperationResult } from "./operation.ts";

interface KeyRow {
  requestHash: string;
  state: string;
  responseStatus: number | null;
  resourceType: string | null;
  resourceId: string | null;
  expiresAt: Date;
}

export type Replayer = (ctx: RequestContext, resourceId: string) => Promise<OperationResult>;

@Injectable()
export class Idempotency {
  private readonly replayers = new Map<string, Replayer>();

  /** Each idempotent create registers how to re-read what it created. */
  register(operationId: string, replayer: Replayer): void {
    this.replayers.set(operationId, replayer);
  }

  hasReplayer(operationId: string): boolean {
    return this.replayers.has(operationId);
  }

  requestHash(op: EndpointDefinition, ctx: RequestContext): string {
    return sha256Hex(
      `${op.method} ${op.path}\n${canonicalJson(ctx.params)}\n${canonicalJson(ctx.body ?? null)}`,
    );
  }

  /**
   * Claims the key. Returns undefined when the request should run, or the
   * replayed result of the first request with the same key and body.
   */
  async begin(
    tx: Tx,
    ctx: RequestContext,
    op: EndpointDefinition,
    actorKey: string,
    organizationId: string | null,
  ): Promise<OperationResult | undefined> {
    const key = ctx.idempotencyKey;
    if (key === undefined) throw new Error("Idempotency key missing");
    const hash = this.requestHash(op, ctx);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + IDEMPOTENCY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    // Keys of this actor that have expired are removed here, in the same tenant context.
    await tx.$executeRaw`DELETE FROM "IdempotencyKey" WHERE "actorKey" = ${actorKey} AND "expiresAt" < ${now}`;
    let inserted: number;
    try {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      inserted = await tx.$executeRaw`
        INSERT INTO "IdempotencyKey" (id, "actorKey", key, "organizationId", method, "routeTemplate", "requestHash", state, "createdAt", "expiresAt")
        VALUES (${uuidv7()}::uuid, ${actorKey}, ${key}, ${organizationId}::uuid, ${op.method}, ${op.path}, ${hash},
                'IN_PROGRESS', ${now}, ${expiresAt})
        ON CONFLICT ("actorKey", key) DO NOTHING`;
      await tx.$executeRaw`SET LOCAL lock_timeout = DEFAULT`;
    } catch (error) {
      throw mapDatabaseError(error) ?? error;
    }
    if (inserted === 1) return undefined;

    const rows = await tx.$queryRaw<KeyRow[]>`
      SELECT "requestHash", state::text AS state, "responseStatus", "resourceType", "resourceId", "expiresAt"
        FROM "IdempotencyKey" WHERE "actorKey" = ${actorKey} AND key = ${key}`;
    const row = rows[0];
    // Invisible here means it was stored under another organization: a different request.
    if (row === undefined || row.requestHash !== hash) throw new ApiError("IDEMPOTENCY_KEY_REUSED");
    if (row.state !== "COMPLETED" || row.resourceId === null || row.responseStatus === null)
      throw new ApiError("IDEMPOTENCY_IN_PROGRESS", undefined, undefined, { "Retry-After": "1" });
    const replay = this.replayers.get(op.operationId);
    if (replay === undefined) throw new Error(`No replayer for ${op.operationId}`);
    const result = await replay(ctx, row.resourceId);
    return { ...result, status: row.responseStatus, replayed: true };
  }

  async complete(
    tx: Tx,
    ctx: RequestContext,
    actorKey: string,
    status: number,
    result: OperationResult,
  ): Promise<void> {
    const resource = result.resource;
    if (resource === undefined)
      throw new Error("An idempotent operation must report the resource it created");
    await tx.$executeRaw`
      UPDATE "IdempotencyKey"
         SET state = 'COMPLETED', "responseStatus" = ${status}, "resourceType" = ${resource.type},
             "resourceId" = ${resource.id}::uuid
       WHERE "actorKey" = ${actorKey} AND key = ${ctx.idempotencyKey}`;
  }
}
