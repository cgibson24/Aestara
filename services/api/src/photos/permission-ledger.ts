// The media-permission ledger (spec §5.4.5; Bible §7.2–7.3; ADR-0023 K2-15):
// append-only versions, expiry, and withdrawing the releases a change leaves
// without a grant. Shared by the api's permission routes and the worker's
// hourly expiry job; every call runs inside one organization's tenant
// transaction.
import { uuidv7 } from "@aestara/database";
import { Injectable } from "@nestjs/common";
import { type AuditInput, AuditWriter } from "../audit/audit-writer.ts";
import { lockRow } from "../common/concurrency.ts";
import type { RequestContext } from "../common/context.ts";
import type { Tx } from "../db/database.ts";
import { Outbox } from "../outbox/outbox.ts";
import { type Category, governing, type PermissionRow, stateAt } from "./permission-rules.ts";

@Injectable()
export class PermissionLedger {
  constructor(
    private readonly audit: AuditWriter,
    private readonly outbox: Outbox,
  ) {}

  current(tx: Tx, patientId: string, category?: Category): Promise<PermissionRow[]> {
    return tx.photoPermission.findMany({
      where: { patientId, supersededAt: null, ...(category ? { category } : {}) },
    }) as Promise<PermissionRow[]>;
  }

  /** Inserts the next version after `current` (which gets supersededAt), returning the new row. */
  async append(
    tx: Tx,
    current: PermissionRow | undefined,
    next: Omit<PermissionRow, "id" | "versionNumber" | "createdAt" | "supersededAt" | "effectiveAt"> & {
      effectiveAt?: Date;
    },
  ): Promise<PermissionRow> {
    const now = new Date();
    if (current !== undefined)
      await tx.photoPermission.update({ where: { id: current.id }, data: { supersededAt: now } });
    return (await tx.photoPermission.create({
      data: {
        id: uuidv7(),
        organizationId: next.organizationId,
        patientId: next.patientId,
        category: next.category,
        scope: next.scope,
        photoSessionId: next.photoSessionId,
        photoId: next.photoId,
        state: next.state,
        versionNumber: (current?.versionNumber ?? 0) + 1,
        previousVersionId: current?.id ?? null,
        effectiveAt: next.effectiveAt ?? now,
        expiresAt: next.expiresAt,
        evidence: next.evidence,
        reason: next.reason,
        recordedById: next.recordedById,
      },
    })) as PermissionRow;
  }

  /** Writes the EXPIRED version of a grant past its expiry (system actor). */
  async expire(tx: Tx, ctx: RequestContext, row: PermissionRow): Promise<PermissionRow> {
    const expired = await this.append(tx, row, {
      ...row,
      state: "EXPIRED",
      evidence: null,
      reason: null,
      recordedById: null,
      effectiveAt: row.expiresAt ?? new Date(),
    });
    await this.audit.write(tx, ctx, {
      action: "PHOTO_PERMISSION_CHANGED",
      resourceType: "PhotoPermission",
      resourceId: expired.id,
      patientId: row.patientId,
      organizationId: row.organizationId,
      actorUserId: null,
      metadata: { category: row.category, scope: row.scope, from: "GRANTED", to: "EXPIRED" },
    });
    return expired;
  }

  /**
   * After a change that may end grants: revokes every active release of the
   * category whose governing permission is no longer granted, and emits
   * photo_permission.revoked for the downstream compliance workflow [B §7.3].
   */
  async withdraw(
    tx: Tx,
    ctx: RequestContext,
    patientId: string,
    category: Category,
    change: PermissionRow,
  ): Promise<void> {
    const releases = await tx.mediaRelease.findMany({
      where: { patientId, purpose: category, revokedAt: null, photoId: { not: null } },
      include: { photo: { select: { id: true, photoSessionId: true } } },
    });
    const now = new Date();
    const rows = await this.current(tx, patientId, category);
    const revoked: string[] = [];
    const events: AuditInput[] = [];
    for (const release of releases) {
      if (release.photo === null) continue;
      if (stateAt(governing(rows, release.photo), now) === "GRANTED") continue;
      await tx.mediaRelease.update({
        where: { id: release.id },
        data: {
          revokedAt: now,
          revokedById: change.recordedById,
          revocationReason: `Permission ${change.state.toLowerCase()}`,
        },
      });
      revoked.push(release.id);
      events.push({
        action: "MEDIA_RELEASE_REVOKED",
        resourceType: "MediaRelease",
        resourceId: release.id,
        patientId,
        organizationId: change.organizationId,
        actorUserId: change.recordedById,
        metadata: { purpose: category, reason: "PERMISSION_WITHDRAWN", permissionId: change.id },
      });
    }
    await this.audit.writeMany(tx, ctx, events);
    if (change.state === "REVOKED" || change.state === "EXPIRED" || revoked.length > 0)
      await this.outbox.add(tx, {
        organizationId: change.organizationId,
        eventType: "photo_permission.revoked",
        aggregateId: change.id,
        payload: { patientId, category, state: change.state, releaseIds: revoked },
      });
  }

  /** The expiry job (K2-15): every grant of this tenant past expiresAt becomes EXPIRED. */
  async expireDue(tx: Tx, ctx: RequestContext, now = new Date()): Promise<number> {
    const due = (await tx.photoPermission.findMany({
      where: { supersededAt: null, state: "GRANTED", expiresAt: { lte: now } },
      take: 500,
    })) as PermissionRow[];
    for (const row of due) {
      await lockRow(tx, "PhotoPermission", row.id);
      const fresh = (await tx.photoPermission.findUniqueOrThrow({ where: { id: row.id } })) as PermissionRow;
      if (fresh.supersededAt !== null || fresh.state !== "GRANTED") continue;
      const expired = await this.expire(tx, ctx, fresh);
      await this.withdraw(tx, ctx, fresh.patientId, fresh.category, expired);
    }
    return due.length;
  }
}
