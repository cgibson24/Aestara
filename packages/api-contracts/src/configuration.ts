// Feature flags, practice settings and retention policies (spec §6.3
// administration rows marked L2, §5.7; ADR-0023 K2-17 to K2-19). Flag and setting
// keys are registered here with their platform defaults, as organization
// settings are (settings.ts); an unknown key is 404.
import {
  RetentionAction as RetentionActionValues,
  RetentionRecordCategory as RetentionRecordCategoryValues,
} from "@aestara/shared-types";
import { PageQuery } from "./pagination.ts";
import { Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

// ---- Feature flags ------------------------------------------------------------

/** Registered flags and their platform defaults. A flag only hides a feature; it never grants access. */
export const FEATURE_FLAGS = {
  "photography.ghostOverlay": {
    default: true,
    description: "Show an earlier photo of the same view over the live camera [B §6.5].",
  },
  "photography.liveGuidance": {
    default: true,
    description: "Show live pose, framing and lighting guidance while capturing [B §6.3–6.4].",
  },
  "beforeAfter.autoRegistration": {
    default: true,
    description: "Offer automatic alignment of before/after sets; manual alignment stays (ADR-0026 K3-13).",
  },
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export const FeatureFlagKeySchema = z
  .enum(Object.keys(FEATURE_FLAGS) as [FeatureFlagKey, ...FeatureFlagKey[]])
  .meta({ id: "FeatureFlagKey" });

export function isFeatureFlagKey(key: string): key is FeatureFlagKey {
  return Object.hasOwn(FEATURE_FLAGS, key);
}

export const FeatureFlag = z
  .strictObject({
    key: FeatureFlagKeySchema,
    enabled: z.boolean(),
    source: z.enum(["DEFAULT", "ORGANIZATION", "PRACTICE"]).meta({
      description:
        "Where the value comes from: a practice row wins over an organization row over the default.",
    }),
    practiceId: Uuid.optional(),
    description: z.string(),
    updatedAt: Timestamp.optional(),
  })
  .meta({ id: "FeatureFlag" });

export const FeatureFlagQuery = z
  .strictObject({
    practiceId: Uuid.optional().meta({ description: "Resolve the flag for this practice." }),
  })
  .meta({ id: "FeatureFlagQuery" });

export const FeatureFlagPut = z
  .strictObject({
    enabled: z.boolean(),
    practiceId: Uuid.optional().meta({
      description: "Set the practice's value; absent sets the organization's.",
    }),
  })
  .meta({ id: "FeatureFlagPut" });

// ---- Practice settings ----------------------------------------------------------

export const OfflineCachePolicy = z
  .strictObject({
    maxPatients: z.int().min(1).max(100),
    maxAgeDays: z.int().min(1).max(7).meta({
      description: "At most 7: offline use ends with the session's absolute lifetime (ADR-0023 K2-17).",
    }),
  })
  .meta({ id: "OfflineCachePolicy" });

/** Registered practice settings: key → value schema and default. */
export const PRACTICE_SETTINGS = {
  "offline.cachePolicy": {
    schema: OfflineCachePolicy,
    default: { maxPatients: 25, maxAgeDays: 7 },
  },
} as const;

export type PracticeSettingKey = keyof typeof PRACTICE_SETTINGS;

export const PracticeSettingKeySchema = z
  .enum(Object.keys(PRACTICE_SETTINGS) as [PracticeSettingKey, ...PracticeSettingKey[]])
  .meta({ id: "PracticeSettingKey" });

export function isPracticeSettingKey(key: string): key is PracticeSettingKey {
  return Object.hasOwn(PRACTICE_SETTINGS, key);
}

export const PracticeSetting = z
  .strictObject({
    practiceId: Uuid,
    key: PracticeSettingKeySchema,
    value: z.unknown().meta({ description: "Shape depends on the key; see the setting schemas." }),
    isDefault: z.boolean(),
    updatedAt: Timestamp.optional(),
    version: z.int().min(0).meta({ description: "0 while the default applies." }),
  })
  .meta({ id: "PracticeSetting" });

export const PracticeSettingPut = z
  .strictObject({ value: z.unknown() })
  .meta({ id: "PracticeSettingPut", description: "Validated against the key's schema." });

export const EffectiveOfflineCachePolicy = OfflineCachePolicy.extend({
  practiceIds: z.array(Uuid).meta({ description: "The practices whose policies were combined." }),
}).meta({
  id: "EffectiveOfflineCachePolicy",
  description: "The strictest cache policy among the practices the caller's grants cover.",
});

// ---- Retention ---------------------------------------------------------------------

export const RetentionRecordCategory = z
  .enum(RetentionRecordCategoryValues)
  .meta({ id: "RetentionRecordCategory" });
export const RetentionAction = z.enum(RetentionActionValues).meta({ id: "RetentionAction" });

export const RetentionPolicy = z
  .strictObject({
    id: Uuid,
    recordCategory: RetentionRecordCategory,
    retentionDays: z.int().optional().meta({ description: "Absent: retain indefinitely." }),
    action: RetentionAction,
    basis: z.string(),
    effectiveFrom: Timestamp,
    createdByUserId: Uuid,
    createdAt: Timestamp,
  })
  .meta({
    id: "RetentionPolicy",
    description: "Recorded only: no retention job runs before production readiness (ADR-0023 K2-19).",
  });

export const RetentionPolicyCreate = z
  .strictObject({
    recordCategory: RetentionRecordCategory,
    retentionDays: z.int().min(1).max(36_500).optional(),
    action: RetentionAction.meta({ description: "DELETE is refused until legal hold is modelled (UD-24)." }),
    basis: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .meta({ description: "The customer's policy or legal basis, e.g. a records schedule reference." }),
    effectiveFrom: Timestamp,
  })
  .meta({ id: "RetentionPolicyCreate" });

export const RetentionPolicyListQuery = PageQuery.extend({
  recordCategory: RetentionRecordCategory.optional(),
}).meta({ id: "RetentionPolicyListQuery" });
