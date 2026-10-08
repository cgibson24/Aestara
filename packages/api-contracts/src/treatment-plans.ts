// Treatment plans A/B/C and the in-clinic hand-off (spec §6.3 "Treatment plans &
// estimates", "In-clinic hand-off", §5.4.3; Bible §11; UD-14, UD-31; ADR-0028
// K4-04 to K4-07, K4-13; ADR-0029). Amounts are USD decimal strings computed by
// the server; clients never send totals. Accepting a plan is not consent to
// treatment, and every plan says so.
import {
  HandoffPurpose as HandoffPurposeValues,
  TreatmentPlanResponseSource as TreatmentPlanResponseSourceValues,
  TreatmentPlanStatus as TreatmentPlanStatusValues,
} from "@aestara/shared-types";
import { PageQuery } from "./pagination.ts";
import { Currency, DateOnly, Money, Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

/** Shown with every plan, in the api and in each app [B §11.1]. */
export const NOT_CONSENT_NOTICE = "Accepting this plan is not consent to treatment.";

/**
 * What the patient affirms in the in-clinic response, by decision (ADR-0029).
 * The response must carry the text exactly, so the stored attestation is what
 * was shown. Pending the legal review of LAYER_4_KICKOFF.md §3.
 */
export const PLAN_RESPONSE_ATTESTATIONS = {
  ACCEPTED:
    "I accept this treatment plan option. I understand that accepting a plan is not consent to treatment, and that its total is an estimate, not a bill.",
  DECLINED: "I decline this treatment plan option.",
} as const;

export const TreatmentPlanStatus = z.enum(TreatmentPlanStatusValues).meta({ id: "TreatmentPlanStatus" });
export const TreatmentPlanResponseSource = z
  .enum(TreatmentPlanResponseSourceValues)
  .meta({ id: "TreatmentPlanResponseSource" });
export const HandoffPurpose = z.enum(HandoffPurposeValues).meta({ id: "HandoffPurpose" });

/** A non-negative amount with two fraction digits (Decimal(12, 2)). */
const amount = () =>
  z
    .strictObject({
      amount: z
        .string()
        .regex(
          /^(0|[1-9]\d{0,9})\.\d{2}$/,
          "Zero or more, two fraction digits, at most 10 digits before the point.",
        ),
      currency: Currency,
    })
    .meta({ description: "USD, never negative." });

const Quantity = z
  .string()
  .regex(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/, "A decimal number with at most two fraction digits.")
  .refine((q) => Number(q) > 0, { message: "A quantity is more than zero." })
  .meta({ description: "Provider-entered quantity, for pricing only [B §11.1].", example: "1.5" });

export const TreatmentPlanItem = z
  .strictObject({
    id: Uuid,
    treatmentId: Uuid,
    treatmentName: z.string(),
    area: z.string().optional(),
    providerUserId: Uuid.optional(),
    description: z.string().optional(),
    quantity: z.string(),
    unitPrice: Money,
    discountAmount: Money,
    lineTotal: Money.meta({
      description: "quantity × unit price, rounded half up to cents, less the discount.",
    }),
    notes: z.string().optional(),
    proposedDate: DateOnly.optional(),
    sortOrder: z.int().min(0),
  })
  .meta({ id: "TreatmentPlanItem" });

export const TreatmentPlanResponse = z
  .strictObject({
    source: TreatmentPlanResponseSource,
    respondedAt: Timestamp,
    signerName: z.string().optional().meta({ description: "IN_CLINIC: the name the patient typed." }),
    attestation: z.string().optional().meta({ description: "IN_CLINIC: the exact text shown." }),
    handoffId: Uuid.optional(),
    acceptedSiblingId: Uuid.optional().meta({
      description: "SIBLING_ACCEPTED: the option that was accepted.",
    }),
  })
  .meta({ id: "TreatmentPlanResponse" });

export const TreatmentPlan = z
  .strictObject({
    id: Uuid,
    patientId: Uuid,
    consultationId: Uuid.optional(),
    practiceId: Uuid,
    providerUserId: Uuid.optional(),
    optionLabel: z.string().optional(),
    title: z.string(),
    status: TreatmentPlanStatus,
    items: z.array(TreatmentPlanItem),
    subtotal: Money,
    discountTotal: Money,
    estimatedTotal: Money.meta({ description: "Before any tax; an estimate, not a bill." }),
    financingReference: z.string().optional(),
    notes: z.string().optional(),
    proposedDate: DateOnly.optional(),
    response: TreatmentPlanResponse.optional(),
    cancelledAt: Timestamp.optional(),
    cancellationReason: z.string().optional(),
    notConsentNotice: z.string().meta({ description: `Always "${NOT_CONSENT_NOTICE}"` }),
    createdById: Uuid,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.int().min(1),
  })
  .meta({ id: "TreatmentPlan" });

const Title = z.string().trim().min(1).max(120);
const Label = z.string().trim().min(1).max(40);
const Text = (max: number) => z.string().trim().min(1).max(max);

export const TreatmentPlanCreate = z
  .strictObject({
    consultationId: Uuid.optional().meta({
      description: "Creates an option of this consultation, in its practice, with the next free letter.",
    }),
    practiceId: Uuid.optional().meta({ description: "Required without a consultation." }),
    title: Title,
    optionLabel: Label.optional(),
    providerUserId: Uuid.optional(),
    notes: Text(2000).optional(),
    proposedDate: DateOnly.optional(),
    financingReference: Text(200)
      .optional()
      .meta({ description: "A reference only; no payment is processed." }),
  })
  .refine((b) => b.consultationId !== undefined || b.practiceId !== undefined, {
    message: "Name the consultation, or the practice of a standalone option.",
    path: ["practiceId"],
  })
  .meta({ id: "TreatmentPlanCreate", description: "Creates a DRAFT option." });

export const TreatmentPlanUpdate = z
  .strictObject({
    title: Title.optional(),
    optionLabel: Label.nullable().optional(),
    providerUserId: z.uuid().nullable().optional(),
    notes: Text(2000).nullable().optional(),
    // Inline, not the DateOnly reference: a nullable reference renders as allOf, which would refuse null.
    proposedDate: z.iso.date().nullable().optional(),
    financingReference: Text(200).nullable().optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: "Change at least one field." })
  .meta({ id: "TreatmentPlanUpdate", description: "Only a DRAFT changes." });

export const TreatmentPlanItemInput = z
  .strictObject({
    treatmentId: Uuid.meta({ description: "An active treatment of the catalog." }),
    area: Text(100).optional(),
    providerUserId: Uuid.optional(),
    description: Text(500).optional(),
    quantity: Quantity.optional().meta({ description: 'Default "1".' }),
    unitPrice: amount().optional().meta({ description: "Default: the treatment's default price." }),
    discountAmount: amount().optional().meta({ description: "Default 0; never above the line amount." }),
    notes: Text(1000).optional(),
    proposedDate: DateOnly.optional(),
  })
  .meta({ id: "TreatmentPlanItemInput" });

export const TreatmentPlanItemsPut = z
  .strictObject({ items: z.array(TreatmentPlanItemInput).max(50) })
  .meta({ id: "TreatmentPlanItemsPut", description: "Replaces the items of a DRAFT, in order." });

export const TreatmentPlanCancel = z
  .strictObject({
    reason: Text(500).meta({
      description: "Why the option is discarded or cancelled. Stored, never logged or audited.",
    }),
  })
  .meta({ id: "TreatmentPlanCancel" });

export const TreatmentPlanListQuery = PageQuery.extend({
  consultationId: Uuid.optional(),
  status: TreatmentPlanStatus.optional(),
}).meta({ id: "TreatmentPlanListQuery" });

// ---- The in-clinic hand-off (UD-31; ADR-0028 K4-13) ----------------------------

export const HandoffOpen = z
  .strictObject({
    identityConfirmed: z
      .boolean()
      .refine((confirmed) => confirmed, { message: "Confirm the patient's identity first." })
      .meta({
        description:
          "Must be true: the staff member checked the patient's identity against the name and date of birth shown.",
      }),
  })
  .meta({ id: "HandoffOpen" });

export const HandoffSession = z
  .strictObject({
    handoffId: Uuid,
    purpose: HandoffPurpose,
    token: z.string().meta({
      description:
        "Sent as `Authorization: Bearer` to the /handoff routes only. Shown once; never stored by the server.",
    }),
    absoluteExpiresAt: Timestamp,
    idleTimeoutSeconds: z.int().min(1),
  })
  .meta({ id: "HandoffSession" });

export const HandoffPlanItem = z
  .strictObject({
    treatmentName: z.string(),
    area: z.string().optional(),
    quantity: z.string(),
    lineTotal: Money,
  })
  .meta({ id: "HandoffPlanItem" });

export const HandoffView = z
  .strictObject({
    handoffId: Uuid,
    purpose: HandoffPurpose,
    patient: z.strictObject({ firstName: z.string(), lastName: z.string(), dateOfBirth: DateOnly }),
    plan: z
      .strictObject({
        optionLabel: z.string().optional(),
        title: z.string(),
        items: z.array(HandoffPlanItem),
        estimatedTotal: Money,
        notConsentNotice: z.string().meta({ description: `Always "${NOT_CONSENT_NOTICE}"` }),
        attestations: z.strictObject({
          ACCEPTED: z.string(),
          DECLINED: z.string(),
        }),
      })
      .optional(),
    absoluteExpiresAt: Timestamp,
  })
  .meta({ id: "HandoffView", description: "What the hand-off is scoped to, as the patient sees it." });

export const HandoffPlanResponseRequest = z
  .strictObject({
    decision: z.enum(["ACCEPTED", "DECLINED"]),
    signerName: z.string().trim().min(1).max(200).meta({ description: "The name the patient typed." }),
    attestation: z.string().meta({ description: "The exact attestation text shown for the decision." }),
  })
  .meta({ id: "HandoffPlanResponseRequest" });

export const HandoffPlanResponseResult = z
  .strictObject({
    decision: z.enum(["ACCEPTED", "DECLINED"]),
    respondedAt: Timestamp,
    declinedSiblingIds: z
      .array(Uuid)
      .meta({ description: "Other options of the consultation declined with it." }),
  })
  .meta({ id: "HandoffPlanResponseResult" });
