// Feature flags, practice settings, the offline cache policy and retention
// policies (spec §6.3 administration rows marked L2, §5.7, §8 rule 7; ADR-0023
// K2-17 to K2-19). Keys are registered in the contracts with their platform
// defaults. A practice value wins over an organization value, which wins over
// the default. Platform-wide rows are not written in Layer 2.
import {
  FEATURE_FLAGS,
  type FeatureFlag,
  type FeatureFlagKey,
  isFeatureFlagKey,
  isPracticeSettingKey,
  PRACTICE_SETTINGS,
  type PracticeSetting,
  type PracticeSettingKey,
  type RetentionPolicy,
  type RetentionPolicyCreate,
} from "@aestara/api-contracts";
import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { checkVersion, iso, lockRow } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { ApiError, notFound } from "../common/errors.ts";
import type { OperationResult } from "../common/operation.ts";
import { requireOrganizationGrant, requireScopedPermission } from "../common/scope.ts";
import { parseInput } from "../common/validation.ts";
import { inOrder, type Tx } from "../db/database.ts";

type RetentionRow = {
  id: string;
  recordCategory: z.output<typeof RetentionPolicyCreate>["recordCategory"];
  retentionDays: number | null;
  action: "ARCHIVE" | "DELETE" | "REVIEW";
  basis: string;
  effectiveFrom: Date;
  createdById: string;
  createdAt: Date;
};

function retentionDto(r: RetentionRow): z.input<typeof RetentionPolicy> {
  return {
    id: r.id,
    recordCategory: r.recordCategory,
    ...(r.retentionDays !== null ? { retentionDays: r.retentionDays } : {}),
    action: r.action,
    basis: r.basis,
    effectiveFrom: iso(r.effectiveFrom),
    createdByUserId: r.createdById,
    createdAt: iso(r.createdAt),
  };
}

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

/** Resolves a flag for an organization and, optionally, one of its practices. */
export async function resolveFlag(
  tx: Tx,
  key: FeatureFlagKey,
  practiceId: string | null,
): Promise<z.input<typeof FeatureFlag>> {
  const rows = await tx.featureFlag.findMany({ where: { key, organizationId: { not: null } } });
  const practiceRow = practiceId === null ? undefined : rows.find((r) => r.practiceId === practiceId);
  const orgRow = rows.find((r) => r.practiceId === null);
  const row = practiceRow ?? orgRow;
  return {
    key,
    enabled: row?.enabled ?? FEATURE_FLAGS[key].default,
    source: practiceRow ? "PRACTICE" : orgRow ? "ORGANIZATION" : "DEFAULT",
    ...(practiceId !== null ? { practiceId } : {}),
    description: FEATURE_FLAGS[key].description,
    ...(row ? { updatedAt: iso(row.updatedAt) } : {}),
  };
}

type SettingValue<K extends PracticeSettingKey> = z.output<(typeof PRACTICE_SETTINGS)[K]["schema"]>;

export async function readPracticeSetting<K extends PracticeSettingKey>(
  tx: Tx,
  practiceId: string,
  key: K,
): Promise<{ value: SettingValue<K>; stored: { version: number; updatedAt: Date } | null }> {
  const row = await tx.practiceSetting.findUnique({ where: { practiceId_key: { practiceId, key } } });
  const definition = PRACTICE_SETTINGS[key];
  const parsed = row === null ? undefined : definition.schema.safeParse(row.value);
  return {
    value: (parsed?.success ? parsed.data : definition.default) as SettingValue<K>,
    stored: row === null ? null : { version: row.version, updatedAt: row.updatedAt },
  };
}

@Injectable()
export class ConfigurationService {
  constructor(
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
  ) {}

  private async practiceExists(tx: Tx, practiceId: string): Promise<boolean> {
    return (await tx.practice.count({ where: { id: practiceId } })) > 0;
  }

  /** configuration.manage organization-wide, or over the practice for a practice value (K2-18). */
  private requireConfigure(ctx: RequestContext, practiceId: string | null): void {
    const auth = requireAuth(ctx);
    if (practiceId === null) requireOrganizationGrant(auth, "configuration.manage");
    else
      requireScopedPermission(auth, "configuration.manage", {
        scope: "PRACTICE",
        practiceId,
        locationId: null,
      });
  }

  // ---- Feature flags ----------------------------------------------------------------

  async listFlags(ctx: RequestContext, practiceId: string | undefined): Promise<OperationResult> {
    const tx = requireTx(ctx);
    requireOrganization(ctx);
    if (practiceId !== undefined && !(await this.practiceExists(tx, practiceId)))
      throw invalid("practiceId", "UNKNOWN_PRACTICE", "Choose one of the organization's practices.");
    const data = await inOrder(Object.keys(FEATURE_FLAGS) as FeatureFlagKey[], (key) =>
      resolveFlag(tx, key, practiceId ?? null),
    );
    return { data, page: { hasMore: false } };
  }

  async getFlag(ctx: RequestContext, key: string, practiceId: string | undefined): Promise<OperationResult> {
    if (!isFeatureFlagKey(key)) throw notFound("FEATURE_FLAG_NOT_FOUND");
    const tx = requireTx(ctx);
    if (practiceId !== undefined && !(await this.practiceExists(tx, practiceId)))
      throw invalid("practiceId", "UNKNOWN_PRACTICE", "Choose one of the organization's practices.");
    return { data: await resolveFlag(tx, key, practiceId ?? null) };
  }

  /** A flag is a boolean without a version column in the schema, so the PUT is an unconditional replace. */
  async putFlag(
    ctx: RequestContext,
    key: string,
    body: { enabled: boolean; practiceId?: string | undefined },
  ): Promise<OperationResult> {
    if (!isFeatureFlagKey(key)) throw notFound("FEATURE_FLAG_NOT_FOUND");
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    const practiceId = body.practiceId ?? null;
    this.requireConfigure(ctx, practiceId);
    if (practiceId !== null && !(await this.practiceExists(tx, practiceId)))
      throw invalid("practiceId", "UNKNOWN_PRACTICE", "Choose one of the organization's practices.");
    const existing = await tx.featureFlag.findFirst({ where: { key, practiceId } });
    const updatedById = requireAuth(ctx).userId;
    const row =
      existing === null
        ? await tx.featureFlag.create({
            data: { key, organizationId, practiceId, enabled: body.enabled, updatedById },
          })
        : await tx.featureFlag.update({
            where: { id: existing.id },
            data: { enabled: body.enabled, updatedById },
          });
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      resourceType: "FeatureFlag",
      resourceId: row.id,
      metadata: { key, enabled: body.enabled, scope: practiceId === null ? "ORGANIZATION" : "PRACTICE" },
    });
    return { data: await resolveFlag(tx, key, practiceId) };
  }

  // ---- Practice settings and the offline cache policy ------------------------------------

  async getPracticeSetting(ctx: RequestContext, practiceId: string, key: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    if (!isPracticeSettingKey(key) || !(await this.practiceExists(tx, practiceId)))
      throw notFound("SETTING_NOT_FOUND");
    const { value, stored } = await readPracticeSetting(tx, practiceId, key);
    const data: z.input<typeof PracticeSetting> = {
      practiceId,
      key,
      value,
      isDefault: stored === null,
      ...(stored ? { updatedAt: iso(stored.updatedAt) } : {}),
      version: stored?.version ?? 0,
    };
    return { data, version: data.version };
  }

  async putPracticeSetting(
    ctx: RequestContext,
    practiceId: string,
    key: string,
    rawValue: unknown,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    if (!isPracticeSettingKey(key) || !(await this.practiceExists(tx, practiceId)))
      throw notFound("SETTING_NOT_FOUND");
    this.requireConfigure(ctx, practiceId);
    const value = parseInput(PRACTICE_SETTINGS[key].schema, rawValue, "value");
    const updatedById = requireAuth(ctx).userId;
    const existing = await tx.practiceSetting.findUnique({
      where: { practiceId_key: { practiceId, key } },
      select: { id: true },
    });
    let row: { id: string; version: number; updatedAt: Date };
    if (existing === null) {
      checkVersion(ctx, 0);
      row = await tx.practiceSetting.create({
        data: { organizationId, practiceId, key, value: value as object, updatedById },
      });
    } else {
      await lockRow(tx, "PracticeSetting", existing.id);
      const current = await tx.practiceSetting.findUniqueOrThrow({ where: { id: existing.id } });
      checkVersion(ctx, current.version);
      row = await tx.practiceSetting.update({
        where: { id: existing.id },
        data: { value: value as object, updatedById, version: { increment: 1 } },
      });
    }
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      resourceType: "PracticeSetting",
      resourceId: row.id,
      metadata: { key, practiceId },
    });
    const data: z.input<typeof PracticeSetting> = {
      practiceId,
      key,
      value,
      isDefault: false,
      updatedAt: iso(row.updatedAt),
      version: row.version,
    };
    return { data, version: row.version };
  }

  /**
   * The cache policy the provider app applies (spec §8 rule 7; K2-17): the
   * strictest policy among the practices the caller's grants cover, so a device
   * never keeps more than any of those practices allows.
   */
  async offlineCachePolicy(ctx: RequestContext): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    requireOrganization(ctx);
    const orgWide = auth.grants.some((g) => g.scope === "ORGANIZATION");
    const scoped = [...new Set(auth.grants.map((g) => g.practiceId).filter((p): p is string => p !== null))];
    const practices = orgWide
      ? (await tx.practice.findMany({ select: { id: true } })).map((p) => p.id)
      : scoped;
    const policies = await inOrder(practices, (id) => readPracticeSetting(tx, id, "offline.cachePolicy"));
    const fallback = PRACTICE_SETTINGS["offline.cachePolicy"].default;
    const data = {
      maxPatients: Math.min(fallback.maxPatients, ...policies.map((p) => p.value.maxPatients)),
      maxAgeDays: Math.min(fallback.maxAgeDays, ...policies.map((p) => p.value.maxAgeDays)),
      practiceIds: practices,
    };
    return { data };
  }

  // ---- Retention policies -----------------------------------------------------------------

  async listRetention(
    ctx: RequestContext,
    query: { limit: number; cursor?: string; recordCategory?: RetentionRow["recordCategory"] },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const after = this.cursors.decode("retention", query.cursor);
    const rows = (await tx.retentionPolicy.findMany({
      where: {
        ...(query.recordCategory ? { recordCategory: query.recordCategory } : {}),
        ...(after ? { id: { lt: after.id } } : {}),
      },
      orderBy: { id: "desc" },
      take: query.limit + 1,
    })) as RetentionRow[];
    const { items, page } = paginate(rows, query.limit, (r) =>
      this.cursors.encode("retention", { k: null, id: r.id }),
    );
    return { data: items.map(retentionDto), page };
  }

  async createRetention(
    ctx: RequestContext,
    body: z.output<typeof RetentionPolicyCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    requireOrganizationGrant(requireAuth(ctx), "configuration.manage");
    // UD-24: no automated deletion before legal hold is modelled (K2-19).
    if (body.action === "DELETE")
      throw invalid(
        "action",
        "LEGAL_HOLD_REQUIRED",
        "Delete policies are not available until legal hold exists.",
      );
    let row: RetentionRow;
    try {
      row = (await tx.retentionPolicy.create({
        data: {
          organizationId,
          recordCategory: body.recordCategory,
          retentionDays: body.retentionDays ?? null,
          action: body.action,
          basis: body.basis,
          effectiveFrom: new Date(body.effectiveFrom),
          createdById: requireAuth(ctx).userId,
        },
      })) as RetentionRow;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ApiError("CONFLICT", "A policy for this category already starts at that time.");
      throw error;
    }
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      resourceType: "RetentionPolicy",
      resourceId: row.id,
      metadata: { recordCategory: body.recordCategory, action: body.action },
    });
    return { data: retentionDto(row) };
  }
}
