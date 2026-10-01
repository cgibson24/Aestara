// Organization policy settings (spec §6.3 "/settings/organization/{key}",
// §4.2; ADR-0021). Each key is registered here with its value schema and
// default; an unknown key is 404 SETTING_NOT_FOUND. A setting that was never
// stored reports its default with ETag "v0".
import { Timestamp } from "./primitives.ts";
import { z } from "./zod.ts";

export const MfaPolicy = z.enum(["ADMINS_ONLY", "ALL_STAFF"]).meta({
  id: "MfaPolicy",
  description: "Who must use a second factor. Admin roles and the admin web always need MFA either way.",
});

const Lifetime = (maxIdleMinutes: number, maxAbsoluteHours: number) =>
  z.strictObject({
    idleMinutes: z.int().min(5).max(maxIdleMinutes),
    absoluteHours: z.int().min(1).max(maxAbsoluteHours),
  });

/** Spec §4.2 defaults. Organizations may shorten them, never extend them (ADR-0021 amendment). */
export const SESSION_POLICY_DEFAULT = {
  IOS_PROVIDER: { idleMinutes: 8 * 60, absoluteHours: 7 * 24 },
  ADMIN_WEB: { idleMinutes: 30, absoluteHours: 12 },
  IOS_PATIENT: { idleMinutes: 30 * 24 * 60, absoluteHours: 90 * 24 },
} as const;

export const SessionPolicy = z
  .strictObject({
    IOS_PROVIDER: Lifetime(
      SESSION_POLICY_DEFAULT.IOS_PROVIDER.idleMinutes,
      SESSION_POLICY_DEFAULT.IOS_PROVIDER.absoluteHours,
    ),
    ADMIN_WEB: Lifetime(
      SESSION_POLICY_DEFAULT.ADMIN_WEB.idleMinutes,
      SESSION_POLICY_DEFAULT.ADMIN_WEB.absoluteHours,
    ),
    IOS_PATIENT: Lifetime(
      SESSION_POLICY_DEFAULT.IOS_PATIENT.idleMinutes,
      SESSION_POLICY_DEFAULT.IOS_PATIENT.absoluteHours,
    ),
  })
  .refine((p) => Object.values(p).every((l) => l.idleMinutes <= l.absoluteHours * 60), {
    message: "The idle lifetime cannot exceed the absolute lifetime.",
  })
  .meta({ id: "SessionPolicy", description: "Idle and absolute session lifetimes per client." });

/** Registered settings: key → value schema and default. */
export const ORGANIZATION_SETTINGS = {
  "security.mfaPolicy": { schema: MfaPolicy, default: "ADMINS_ONLY" as const },
  "security.sessionPolicy": { schema: SessionPolicy, default: SESSION_POLICY_DEFAULT },
  "patients.primaryPracticeRequired": { schema: z.boolean(), default: false },
} as const;

export type OrganizationSettingKey = keyof typeof ORGANIZATION_SETTINGS;

export const OrganizationSettingKeySchema = z
  .enum(Object.keys(ORGANIZATION_SETTINGS) as [OrganizationSettingKey, ...OrganizationSettingKey[]])
  .meta({ id: "OrganizationSettingKey" });

export function isOrganizationSettingKey(key: string): key is OrganizationSettingKey {
  return Object.hasOwn(ORGANIZATION_SETTINGS, key);
}

export const OrganizationSetting = z
  .strictObject({
    key: OrganizationSettingKeySchema,
    value: z.unknown().meta({ description: "Shape depends on the key; see the setting schemas." }),
    isDefault: z.boolean(),
    updatedAt: Timestamp.optional(),
    version: z.int().min(0).meta({ description: "0 while the default applies." }),
  })
  .meta({ id: "OrganizationSetting" });

export const OrganizationSettingPut = z
  .strictObject({ value: z.unknown() })
  .meta({ id: "OrganizationSettingPut", description: "Validated against the key's schema." });

export const HealthStatus = z.strictObject({ status: z.literal("ok") }).meta({ id: "HealthStatus" });
