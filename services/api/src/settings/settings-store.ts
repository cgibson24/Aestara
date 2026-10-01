// Reads organization settings registered in the contracts (ADR-0021): the
// stored value when present and valid, otherwise the registered default. The
// caller's transaction must already be in the organization's tenant context.
import {
  ORGANIZATION_SETTINGS,
  type OrganizationSettingKey,
  SESSION_POLICY_DEFAULT,
} from "@aestara/api-contracts";
import type { ClientApp } from "@aestara/shared-types";
import type { z } from "zod";
import type { Tx } from "../db/database.ts";
import { inTenant } from "../db/tenant.ts";

type SettingValue<K extends OrganizationSettingKey> = z.output<(typeof ORGANIZATION_SETTINGS)[K]["schema"]>;

export async function readSetting<K extends OrganizationSettingKey>(
  tx: Tx,
  organizationId: string,
  key: K,
): Promise<{ value: SettingValue<K>; stored: { version: number; updatedAt: Date } | null }> {
  const row = await tx.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key } },
  });
  const definition = ORGANIZATION_SETTINGS[key];
  if (row !== null) {
    const parsed = definition.schema.safeParse(row.value);
    if (parsed.success)
      return {
        value: parsed.data as SettingValue<K>,
        stored: { version: row.version, updatedAt: row.updatedAt },
      };
  }
  return {
    value: definition.default as SettingValue<K>,
    stored: row === null ? null : { version: row.version, updatedAt: row.updatedAt },
  };
}

export interface Lifetimes {
  readonly idleMs: number;
  readonly absoluteMs: number;
}

export function lifetimesFrom(
  policy: typeof SESSION_POLICY_DEFAULT | SettingValue<"security.sessionPolicy">,
  app: ClientApp,
): Lifetimes {
  const entry = policy[app];
  return { idleMs: entry.idleMinutes * 60_000, absoluteMs: entry.absoluteHours * 3_600_000 };
}

/** Session lifetimes for a client in an organization; platform sessions use the defaults (ADR-0021). */
export async function sessionLifetimes(
  tx: Tx,
  organizationId: string | null,
  app: ClientApp,
): Promise<Lifetimes> {
  if (organizationId === null) return lifetimesFrom(SESSION_POLICY_DEFAULT, app);
  const { value } = await inTenant(tx, organizationId, () =>
    readSetting(tx, organizationId, "security.sessionPolicy"),
  );
  return lifetimesFrom(value, app);
}
