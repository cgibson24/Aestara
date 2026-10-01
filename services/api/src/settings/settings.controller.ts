// Organization policy settings (spec §6.3 "/settings/organization/{key}";
// ADR-0021). Values are validated against the schema registered for the key.
import {
  isOrganizationSettingKey,
  ORGANIZATION_SETTINGS,
  type OrganizationSetting,
} from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { checkVersion, iso, lockRow } from "../common/concurrency.ts";
import { type RequestContext, requireOrganization, requireTx } from "../common/context.ts";
import { notFound } from "../common/errors.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { parseInput } from "../common/validation.ts";
import { readSetting } from "./settings-store.ts";

@Controller()
export class SettingsController {
  constructor(private readonly audit: AuditWriter) {}

  @Operation("getOrganizationSetting")
  async get(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    const key = ctx.params.key ?? "";
    if (!isOrganizationSettingKey(key)) throw notFound("SETTING_NOT_FOUND");
    const { value, stored } = await readSetting(requireTx(ctx), requireOrganization(ctx), key);
    const data: z.input<typeof OrganizationSetting> = {
      key,
      value,
      isDefault: stored === null,
      ...(stored ? { updatedAt: iso(stored.updatedAt) } : {}),
      version: stored?.version ?? 0,
    };
    return { data, version: data.version };
  }

  @Operation("putOrganizationSetting")
  async put(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    const key = ctx.params.key ?? "";
    if (!isOrganizationSettingKey(key)) throw notFound("SETTING_NOT_FOUND");
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    const value = parseInput(
      ORGANIZATION_SETTINGS[key].schema,
      (ctx.body as { value: unknown }).value,
      "value",
    );
    const existing = await tx.organizationSetting.findUnique({
      where: { organizationId_key: { organizationId, key } },
      select: { id: true },
    });
    let row: { id: string; version: number; updatedAt: Date };
    if (existing === null) {
      checkVersion(ctx, 0);
      row = await tx.organizationSetting.create({
        data: { organizationId, key, value: value as object, updatedById: ctx.auth?.userId ?? null },
      });
    } else {
      await lockRow(tx, "OrganizationSetting", existing.id);
      const current = await tx.organizationSetting.findUniqueOrThrow({ where: { id: existing.id } });
      checkVersion(ctx, current.version);
      row = await tx.organizationSetting.update({
        where: { id: existing.id },
        data: { value: value as object, updatedById: ctx.auth?.userId ?? null, version: { increment: 1 } },
      });
    }
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      resourceType: "OrganizationSetting",
      resourceId: row.id,
      metadata: { key },
    });
    const data: z.input<typeof OrganizationSetting> = {
      key,
      value,
      isDefault: false,
      updatedAt: iso(row.updatedAt),
      version: row.version,
    };
    return { data, version: row.version };
  }
}
