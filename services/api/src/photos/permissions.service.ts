// Media permissions and releases (spec §5.4.5, §6.3; Bible §7; ADR-0023 K2-15,
// K2-16). Permissions are append-only versions: a change stamps supersededAt on
// the current row and inserts the next one (triggers D1–D9). For a photo, the
// most specific current row wins (photo, then session, then patient-wide); no
// row means NOT_REQUESTED; a grant past expiresAt counts as EXPIRED at once.
// No category implies another, and clinical use implies nothing (Bible §7.2).
// Every use re-checks the grant; a change that ends a release's grant revokes
// that release too, so a later re-grant never revives it.
import {
  MediaPermissionCategory,
  type MediaRelease,
  type MediaReleaseCreate,
  type PhotoPermission,
  type PhotoPermissionChange,
  type PhotoPermissionSummary,
} from "@aestara/api-contracts";
import { uuidv7 } from "@aestara/database";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { defined, iso, lockRow } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { ApiError, notFound } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import type { Tx } from "../db/database.ts";
import { PermissionLedger } from "./permission-ledger.ts";
import {
  type Category,
  governing,
  LAYER_2_EVIDENCE,
  type PermissionRow,
  stateAt,
  TRANSITIONS,
} from "./permission-rules.ts";

export function permissionDto(r: PermissionRow): z.input<typeof PhotoPermission> {
  return {
    id: r.id,
    category: r.category,
    scope: r.scope,
    state: r.state,
    versionNumber: r.versionNumber,
    effectiveAt: iso(r.effectiveAt),
    ...defined({
      photoSessionId: r.photoSessionId,
      photoId: r.photoId,
      expiresAt: r.expiresAt && iso(r.expiresAt),
      evidence: r.evidence,
      reason: r.reason,
      recordedByUserId: r.recordedById,
      supersededAt: r.supersededAt && iso(r.supersededAt),
    }),
    createdAt: iso(r.createdAt),
  };
}

type ReleaseRow = {
  id: string;
  purpose: Category;
  photoId: string | null;
  derivativeId: string | null;
  releasedById: string;
  releasedAt: Date;
  revokedAt: Date | null;
  revokedById: string | null;
  revocationReason: string | null;
  permissions: { permissionId: string }[];
};

function releaseDto(r: ReleaseRow): z.input<typeof MediaRelease> {
  return {
    id: r.id,
    purpose: r.purpose,
    releasedByUserId: r.releasedById,
    releasedAt: iso(r.releasedAt),
    pinnedPermissionIds: r.permissions.map((p) => p.permissionId),
    active: r.revokedAt === null,
    ...defined({
      photoId: r.photoId,
      derivativeId: r.derivativeId,
      revokedAt: r.revokedAt && iso(r.revokedAt),
      revokedByUserId: r.revokedById,
      revocationReason: r.revocationReason,
    }),
  };
}

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

@Injectable()
export class PermissionsService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
    private readonly idempotency: Idempotency,
    private readonly ledger: PermissionLedger,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("recordPhotoPermission", async (ctx, id) => {
      const row = await requireTx(ctx).photoPermission.findUnique({ where: { id } });
      if (row === null) throw notFound("PATIENT_NOT_FOUND");
      return { data: permissionDto(row as PermissionRow), resource: { type: "PhotoPermission", id } };
    });
    this.idempotency.register("createMediaRelease", async (ctx, id) => ({
      data: releaseDto(await this.release(requireTx(ctx), ctx.params.patientId ?? "", id)),
      resource: { type: "MediaRelease", id },
    }));
  }

  private async patient(tx: Tx, patientId: string): Promise<void> {
    if ((await tx.patient.count({ where: { id: patientId } })) === 0) throw notFound("PATIENT_NOT_FOUND");
  }

  private async release(tx: Tx, patientId: string, id: string): Promise<ReleaseRow> {
    const r = await tx.mediaRelease.findFirst({
      where: { id, patientId },
      include: { permissions: { select: { permissionId: true } } },
    });
    if (r === null) throw notFound("MEDIA_RELEASE_NOT_FOUND");
    return r as ReleaseRow;
  }

  // ---- Reading ------------------------------------------------------------------------

  async summary(ctx: RequestContext, patientId: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const rows = await this.ledger.current(tx, patientId);
    const now = new Date();
    const data: z.input<typeof PhotoPermissionSummary> = {
      categories: MediaPermissionCategory.options.map((category) => {
        const mine = rows.filter((r) => r.category === category);
        const wide = mine.find((r) => r.scope === "PATIENT_WIDE");
        return {
          category,
          patientWideState: stateAt(wide, now),
          ...(wide ? { patientWide: permissionDto(wide) } : {}),
          exceptions: mine.filter((r) => r.scope !== "PATIENT_WIDE").map(permissionDto),
        };
      }),
    };
    return { data };
  }

  async history(
    ctx: RequestContext,
    patientId: string,
    query: { limit: number; cursor?: string; category?: Category },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const after = this.cursors.decode("permission-history", query.cursor);
    const rows = (await tx.photoPermission.findMany({
      where: {
        patientId,
        ...(query.category ? { category: query.category } : {}),
        ...(after ? { id: { lt: after.id } } : {}),
      },
      orderBy: { id: "desc" },
      take: query.limit + 1,
    })) as PermissionRow[];
    const { items, page } = paginate(rows, query.limit, (r) =>
      this.cursors.encode("permission-history", { k: null, id: r.id }),
    );
    return { data: items.map(permissionDto), page };
  }

  // ---- Transitions ------------------------------------------------------------------------

  async record(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof PhotoPermissionChange>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    const auth = requireAuth(ctx);
    await this.patient(tx, patientId);
    if (body.scope === "PHOTO") {
      const photo = await tx.patientPhoto.findFirst({
        where: { id: body.photoId ?? "", patientId },
        select: { status: true },
      });
      if (photo === null || photo.status === "UPLOAD_PENDING")
        throw invalid("photoId", "UNKNOWN_PHOTO", "Choose one of this patient's photos.");
    }
    if (
      body.scope === "PHOTO_SESSION" &&
      (await tx.photoSession.count({ where: { id: body.photoSessionId ?? "", patientId } })) === 0
    )
      throw invalid("photoSessionId", "UNKNOWN_SESSION", "Choose one of this patient's photo sessions.");
    if (body.state === "GRANTED") {
      if (body.evidence === undefined) throw invalid("evidence", "REQUIRED", "A grant records its evidence.");
      if (!LAYER_2_EVIDENCE.has(body.evidence))
        throw invalid(
          "evidence",
          "NOT_AVAILABLE",
          "Use STAFF_ATTESTATION; other evidence arrives with later layers.",
        );
    } else if (body.evidence !== undefined && !LAYER_2_EVIDENCE.has(body.evidence)) {
      throw invalid(
        "evidence",
        "NOT_AVAILABLE",
        "Use STAFF_ATTESTATION; other evidence arrives with later layers.",
      );
    }
    const now = new Date();
    if (body.expiresAt !== undefined) {
      if (body.state !== "GRANTED") throw invalid("expiresAt", "NOT_ALLOWED", "Only a grant can expire.");
      if (new Date(body.expiresAt) <= now)
        throw invalid("expiresAt", "IN_PAST", "The expiry must be in the future.");
    }

    const target = {
      scope: body.scope,
      photoSessionId: body.scope === "PHOTO_SESSION" ? (body.photoSessionId ?? null) : null,
      photoId: body.scope === "PHOTO" ? (body.photoId ?? null) : null,
    };
    let current = (await this.ledger.current(tx, patientId, body.category)).find(
      (r) =>
        r.scope === target.scope &&
        r.photoSessionId === target.photoSessionId &&
        r.photoId === target.photoId,
    );
    if (current !== undefined) {
      await lockRow(tx, "PhotoPermission", current.id);
      const fresh = (await tx.photoPermission.findUniqueOrThrow({
        where: { id: current.id },
      })) as PermissionRow;
      if (fresh.supersededAt !== null)
        throw new ApiError("CONFLICT", "The permission changed meanwhile. Reload it.");
      current = fresh;
      if (stateAt(current, now) === "EXPIRED" && current.state === "GRANTED")
        current = await this.ledger.expire(tx, ctx, current);
    }
    const from = stateAt(current, now);
    if (!TRANSITIONS[from].includes(body.state))
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        `A permission cannot go from ${from} to ${body.state}.`,
        {
          from,
          to: body.state,
        },
      );
    let created: PermissionRow;
    try {
      created = await this.ledger.append(tx, current, {
        organizationId,
        patientId,
        category: body.category,
        ...target,
        state: body.state,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        evidence: body.evidence ?? null,
        reason: body.reason ?? null,
        recordedById: auth.userId,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ApiError("CONFLICT", "The permission changed meanwhile. Reload it.");
      throw error;
    }
    await this.audit.write(tx, ctx, {
      action: "PHOTO_PERMISSION_CHANGED",
      resourceType: "PhotoPermission",
      resourceId: created.id,
      patientId,
      metadata: {
        category: body.category,
        scope: body.scope,
        from,
        to: body.state,
        ...(body.evidence ? { evidence: body.evidence } : {}),
      },
    });
    // A decline at a narrower scope or a revocation can end the grant some releases rely on.
    if (body.state === "DECLINED" || body.state === "REVOKED")
      await this.ledger.withdraw(tx, ctx, patientId, body.category, created);
    return { data: permissionDto(created), resource: { type: "PhotoPermission", id: created.id } };
  }

  // ---- Releases --------------------------------------------------------------------------------

  private requireReleasePermission(ctx: RequestContext, purpose: Category): void {
    const needed = purpose === "PATIENT_APP" ? "consultation.complete" : "photo.export";
    if (!requireAuth(ctx).permissions.has(needed))
      throw new ApiError("PERMISSION_DENIED", `Releasing for ${purpose} needs the ${needed} permission.`);
  }

  async listReleases(
    ctx: RequestContext,
    patientId: string,
    query: { limit: number; cursor?: string; purpose?: Category; activeOnly: boolean },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const after = this.cursors.decode("media-releases", query.cursor);
    const rows = await tx.mediaRelease.findMany({
      where: {
        patientId,
        ...(query.purpose ? { purpose: query.purpose } : {}),
        ...(query.activeOnly ? { revokedAt: null } : {}),
        ...(after ? { id: { lt: after.id } } : {}),
      },
      include: { permissions: { select: { permissionId: true } } },
      orderBy: { id: "desc" },
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows as ReleaseRow[], query.limit, (r) =>
      this.cursors.encode("media-releases", { k: null, id: r.id }),
    );
    return { data: items.map(releaseDto), page };
  }

  async createRelease(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof MediaReleaseCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    await this.patient(tx, patientId);
    this.requireReleasePermission(ctx, body.purpose);
    await lockRow(tx, "PatientPhoto", body.photoId);
    const photo = await tx.patientPhoto.findFirst({
      where: { id: body.photoId, patientId },
      select: { id: true, status: true, photoSessionId: true },
    });
    if (photo === null || photo.status === "UPLOAD_PENDING")
      throw invalid("photoId", "UNKNOWN_PHOTO", "Choose one of this patient's photos.");
    if (photo.status !== "ACCEPTED")
      throw new ApiError("INVALID_STATE_TRANSITION", "Only an accepted, unarchived photo can be released.");
    const rows = await this.ledger.current(tx, patientId, body.purpose);
    const governingRow = governing(rows, photo);
    if (stateAt(governingRow, new Date()) !== "GRANTED" || governingRow === undefined)
      throw new ApiError(
        "MEDIA_PERMISSION_NOT_GRANTED",
        `The patient has not granted ${body.purpose} for this photo.`,
        { category: body.purpose },
      );
    const active = await tx.mediaRelease.count({
      where: { patientId, photoId: photo.id, purpose: body.purpose, revokedAt: null },
    });
    if (active > 0) throw new ApiError("CONFLICT", "This photo is already released for that purpose.");
    const id = uuidv7();
    await tx.mediaRelease.create({
      data: {
        id,
        organizationId,
        patientId,
        purpose: body.purpose,
        photoId: photo.id,
        releasedById: requireAuth(ctx).userId,
      },
    });
    // The pin is checked at commit: a release without one cannot exist (R15).
    await tx.mediaReleasePermission.createMany({
      data: [{ organizationId, patientId, mediaReleaseId: id, permissionId: governingRow.id }],
    });
    await this.audit.write(tx, ctx, {
      action: "MEDIA_RELEASED",
      resourceType: "MediaRelease",
      resourceId: id,
      patientId,
      metadata: { purpose: body.purpose, photoId: photo.id, permissionId: governingRow.id },
    });
    return {
      data: releaseDto(await this.release(tx, patientId, id)),
      resource: { type: "MediaRelease", id },
    };
  }

  async revokeRelease(
    ctx: RequestContext,
    patientId: string,
    releaseId: string,
    reason: string,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "MediaRelease", releaseId);
    const release = await this.release(tx, patientId, releaseId);
    this.requireReleasePermission(ctx, release.purpose);
    if (release.revokedAt !== null)
      throw new ApiError("INVALID_STATE_TRANSITION", "The release is already revoked.");
    await tx.mediaRelease.update({
      where: { id: releaseId },
      data: { revokedAt: new Date(), revokedById: requireAuth(ctx).userId, revocationReason: reason },
    });
    await this.audit.write(tx, ctx, {
      action: "MEDIA_RELEASE_REVOKED",
      resourceType: "MediaRelease",
      resourceId: releaseId,
      patientId,
      metadata: { purpose: release.purpose, reason: "STAFF_REVOKED" },
    });
    return { data: releaseDto(await this.release(tx, patientId, releaseId)) };
  }
}
