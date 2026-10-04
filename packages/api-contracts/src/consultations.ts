// Consultations (spec §6.3 "Consultations", §5.4.1; Bible §5; ADR-0026 K3-01
// to K3-05). The machine and its frozen states are enforced by the database;
// these contracts carry the transitions and what completion still needs.
import {
  ConsultationReleaseDecision as ConsultationReleaseDecisionValues,
  ConsultationStatus as ConsultationStatusValues,
  MedicalHistoryCategory as MedicalHistoryCategoryValues,
  NoteStatus as NoteStatusValues,
  RecordSource as RecordSourceValues,
} from "@aestara/shared-types";
import { PageQuery } from "./pagination.ts";
import { DateOnly, Timestamp, Uuid } from "./primitives.ts";
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

export const ConsultationConcernsPut = z
  .strictObject({
    concernIds: z
      .array(Uuid)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, { message: "List each concern once." })
      .meta({ description: "The patient's concerns this consultation addresses; replaces the set." }),
  })
  .meta({ id: "ConsultationConcernsPut" });

// ---- Concerns and medical history (spec §6.3 "Patients"; ADR-0026 K3-08) -------

/**
 * Concern areas, registered in code as flag keys are (ADR-0026 K3-08). Changing
 * the list is a reviewed code change; a clinical lead reviews it before first
 * clinical use.
 */
export const CONCERN_AREAS = [
  "FOREHEAD",
  "BROW",
  "EYES",
  "NOSE",
  "CHEEKS",
  "LIPS",
  "CHIN",
  "JAWLINE",
  "NECK",
  "FACE_SKIN",
  "BREAST",
  "ABDOMEN",
  "FLANKS",
  "BACK",
  "BUTTOCKS",
  "ARMS",
  "THIGHS",
  "BODY_SKIN",
  "OTHER",
] as const;
export const ConcernArea = z.enum(CONCERN_AREAS).meta({
  id: "ConcernArea",
  description: "Anatomical or aesthetic area of a concern (ADR-0026 K3-08).",
});

const ConcernDescription = z.string().trim().min(1).max(500);

export const PatientConcern = z
  .strictObject({
    id: Uuid,
    patientId: Uuid,
    area: ConcernArea,
    description: z.string(),
    recordedById: Uuid.optional(),
    resolvedAt: Timestamp.optional(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.number().int().positive(),
  })
  .meta({ id: "PatientConcern" });

export const PatientConcernCreate = z
  .strictObject({ area: ConcernArea, description: ConcernDescription })
  .meta({ id: "PatientConcernCreate" });

export const PatientConcernUpdate = z
  .strictObject({
    description: ConcernDescription.optional(),
    resolved: z.boolean().optional().meta({ description: "Mark the concern resolved, or open again." }),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field." })
  .meta({ id: "PatientConcernUpdate" });

export const PatientConcernListQuery = PageQuery.extend({
  includeResolved: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
}).meta({ id: "PatientConcernListQuery" });

export const MedicalHistoryCategory = z.enum(MedicalHistoryCategoryValues).meta({
  id: "MedicalHistoryCategory",
});
export const RecordSource = z.enum(RecordSourceValues).meta({ id: "RecordSource" });

const HistoryDescription = z.string().trim().min(1).max(1000);

export const MedicalHistoryEntry = z
  .strictObject({
    id: Uuid,
    patientId: Uuid,
    category: MedicalHistoryCategory,
    description: z.string(),
    onsetDate: DateOnly.optional(),
    resolvedOn: DateOnly.optional(),
    source: RecordSource,
    recordedById: Uuid.optional(),
    recordedAt: Timestamp,
    updatedAt: Timestamp,
    version: z.number().int().positive(),
  })
  .meta({
    id: "MedicalHistoryEntry",
    description: "Clinical history: readable with consultation.create, never with patient.read alone.",
  });

export const MedicalHistoryCreate = z
  .strictObject({
    category: MedicalHistoryCategory,
    description: HistoryDescription,
    onsetDate: DateOnly.optional(),
    resolvedOn: DateOnly.optional(),
  })
  .meta({ id: "MedicalHistoryCreate", description: "Recorded by staff (source STAFF) in Layer 3." });

export const MedicalHistoryUpdate = z
  .strictObject({
    category: MedicalHistoryCategory.optional(),
    description: HistoryDescription.optional(),
    onsetDate: z.iso.date().nullable().optional(),
    resolvedOn: z.iso.date().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field." })
  .meta({ id: "MedicalHistoryUpdate", description: "Entries are corrected, never deleted." });

export const MedicalHistoryListQuery = PageQuery.extend({
  category: MedicalHistoryCategory.optional(),
}).meta({ id: "MedicalHistoryListQuery" });

// ---- Notes (spec §6.3 "Consultations"; UD-15; ADR-0026 K3-06, K3-07) -----------

export const NoteStatus = z.enum(NoteStatusValues).meta({ id: "NoteStatus" });

/** A note body: plain text, never logged (ADR-0026 K3-07). */
export const NOTE_MAX_LENGTH = 20_000;
const NoteBody = z.string().trim().min(1).max(NOTE_MAX_LENGTH);

export const ConsultationNote = z
  .strictObject({
    id: Uuid,
    consultationId: Uuid,
    authorUserId: Uuid,
    status: NoteStatus,
    body: z.string(),
    correctsNoteId: Uuid.optional().meta({ description: "The FINAL note this addendum corrects." }),
    finalizedAt: Timestamp.optional(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.number().int().positive(),
  })
  .meta({ id: "ConsultationNote" });

export const ConsultationNoteCreate = z
  .strictObject({
    id: z
      .uuid({ version: "v7" })
      .optional()
      .meta({ description: "Client-generated UUIDv7 for a note drafted offline." }),
    body: NoteBody,
    correctsNoteId: Uuid.optional().meta({
      description: "Write an addendum to this FINAL note of the consultation (UD-15).",
    }),
  })
  .meta({ id: "ConsultationNoteCreate" });

export const ConsultationNoteUpdate = z
  .strictObject({ body: NoteBody })
  .meta({ id: "ConsultationNoteUpdate", description: "Only the author changes a DRAFT note." });

export const ConsultationNoteListQuery = PageQuery.extend({}).meta({ id: "ConsultationNoteListQuery" });
