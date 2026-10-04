// Consultations (spec §6.3 "Consultations", §5.4.1; Bible §5; ADR-0026 K3-01
// to K3-05). The machine and its frozen states are enforced by the database;
// these contracts carry the transitions and what completion still needs.
import {
  ConsultationReleaseDecision as ConsultationReleaseDecisionValues,
  ConsultationStatus as ConsultationStatusValues,
} from "@aestara/shared-types";
import { PageQuery } from "./pagination.ts";
import { Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

export const ConsultationStatus = z.enum(ConsultationStatusValues).meta({
  id: "ConsultationStatus",
  description: "Bible §5.2 states; spec §5.4.1 transitions.",
});

export const ConsultationReleaseDecision = z.enum(ConsultationReleaseDecisionValues).meta({
  id: "ConsultationReleaseDecision",
  description:
    "What the consultation released to the patient before completion (ADR-0026 K3-04). " +
    "Layer 3 records only NOTHING_TO_RELEASE.",
});

/**
 * The spec §5.4.1 completion preconditions a Layer 3 consultation can fail
 * (ADR-0026 K3-03). The release decision travels in the /complete request.
 */
export const COMPLETION_PRECONDITIONS = ["REASON_OR_CONCERN", "NO_DRAFT_NOTES", "CURRENT_SUMMARY"] as const;
export const CompletionPrecondition = z.enum(COMPLETION_PRECONDITIONS).meta({
  id: "CompletionPrecondition",
  description:
    "REASON_OR_CONCERN: record a reason or at least one concern. NO_DRAFT_NOTES: finalize or " +
    "discard every draft note. CURRENT_SUMMARY: generate the summary after the consultation " +
    "last went to review.",
});

const Reason = z.string().trim().min(1).max(500);

export const Consultation = z
  .strictObject({
    id: Uuid,
    patientId: Uuid,
    practiceId: Uuid,
    locationId: Uuid.optional(),
    primaryProviderUserId: Uuid.optional(),
    status: ConsultationStatus,
    reason: z.string().optional(),
    concernIds: z.array(Uuid).meta({ description: "The patient concerns this consultation addresses." }),
    startedAt: Timestamp.optional(),
    readyForReviewAt: Timestamp.optional().meta({
      description: "When the consultation last went to review.",
    }),
    completedAt: Timestamp.optional(),
    completedById: Uuid.optional(),
    releaseDecision: ConsultationReleaseDecision.optional(),
    cancelledAt: Timestamp.optional(),
    cancelledById: Uuid.optional(),
    cancellationReason: z.string().optional(),
    archivedAt: Timestamp.optional(),
    unmetCompletionPreconditions: z.array(CompletionPrecondition).meta({
      description: "What /complete would still refuse; empty once the consultation is final.",
    }),
    createdById: Uuid,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.number().int().positive(),
  })
  .meta({ id: "Consultation" });

export const ConsultationCreate = z
  .strictObject({
    practiceId: Uuid,
    locationId: Uuid.optional(),
    primaryProviderUserId: Uuid.optional().meta({ description: "A provider of this organization." }),
    reason: Reason.optional(),
  })
  .meta({ id: "ConsultationCreate" });

export const ConsultationUpdate = z
  .strictObject({
    locationId: z.uuid().nullable().optional(),
    primaryProviderUserId: z.uuid().nullable().optional(),
    reason: Reason.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field." })
  .meta({ id: "ConsultationUpdate", description: "The practice never changes; null clears a field." });

export const ConsultationCancel = z
  .strictObject({
    reason: Reason.meta({ description: "Why the consultation is cancelled. Stored, never logged." }),
  })
  .meta({ id: "ConsultationCancel" });

export const ConsultationComplete = z
  .strictObject({
    releaseDecision: z.enum(["NOTHING_TO_RELEASE"]).meta({
      description:
        "The provider confirms nothing is released to the patient: nothing reaches a patient " +
        "before Layer 5 (ADR-0026 K3-04).",
    }),
  })
  .meta({ id: "ConsultationComplete" });

export const ConsultationListQuery = PageQuery.extend({
  status: ConsultationStatus.optional(),
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true")
    .meta({ description: "Archived consultations are hidden unless asked for (ADR-0026 K3-02)." }),
}).meta({ id: "ConsultationListQuery" });
