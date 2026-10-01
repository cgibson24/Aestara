// Patients and patient contacts (spec §6.3 "Patients", §6.6.1; Bible §4;
// ADR-0018 K-17, K-20; ADR-0020 search). organizationId is never accepted: the
// server takes the tenant from the access token.
import { PatientContactKind, PatientStatus as PatientStatusValues } from "@aestara/shared-types";
import { Email } from "./auth.ts";
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, PageQuery } from "./pagination.ts";
import { DateOnly, Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

export const PatientStatus = z.enum(PatientStatusValues).meta({ id: "PatientStatus" });

/** Statuses an update may set; ARCHIVED only through /archive (spec §5.4.10). */
export const PatientUpdatableStatus = z
  .enum(PatientStatusValues.filter((s) => s !== "ARCHIVED") as ["ACTIVE", "INACTIVE", "DECEASED"])
  .meta({ id: "PatientUpdatableStatus" });

const PersonName = z.string().trim().min(1).max(100);

export const Phone = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "Use E.164 format, e.g. +15555550123.")
  .meta({ example: "+15555550123" });

export const Mrn = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use letters, digits and . _ / - only.")
  .meta({ description: "Medical record number, unique in the organization. Optional and entered by staff." });

export const BirthDate = DateOnly.refine(
  (d) => d >= "1900-01-01" && d <= new Date().toISOString().slice(0, 10),
  { message: "Must be a real date of birth, not in the future." },
);

export const Patient = z
  .strictObject({
    id: Uuid,
    status: PatientStatus,
    firstName: z.string(),
    middleName: z.string().optional(),
    lastName: z.string(),
    preferredName: z.string().optional(),
    dateOfBirth: DateOnly,
    email: z.string().optional(),
    phone: z.string().optional(),
    mrn: z.string().optional(),
    externalEmrIdentifier: z
      .string()
      .optional()
      .meta({ description: "Set by an EMR integration (Layer 10)." }),
    primaryPracticeId: Uuid.optional(),
    archivedAt: Timestamp.optional(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.int().min(1),
  })
  .meta({ id: "Patient" });

/** The twelve profile tabs (Bible §4.3; PR-PATIENT-06). */
export const PATIENT_PROFILE_TABS = [
  { key: "OVERVIEW", permission: "patient.read" },
  { key: "TIMELINE", permission: "patient.read" },
  { key: "CONSULTATIONS", permission: "consultation.create" },
  { key: "PHOTOS", permission: "photo.view" },
  { key: "BEFORE_AFTER", permission: "photo.view" },
  { key: "SIMULATIONS", permission: "simulation.review" },
  { key: "TREATMENT_PLANS", permission: "treatmentplan.create" },
  { key: "PROCEDURES", permission: "procedure.manage" },
  { key: "DOCUMENTS", permission: "document.read" },
  { key: "INSTRUCTIONS", permission: "content.read" },
  { key: "APPOINTMENTS", permission: "appointment.manage" },
  { key: "MESSAGES", permission: "message.send" },
] as const;

export const PatientProfileTabKey = z
  .enum(PATIENT_PROFILE_TABS.map((t) => t.key) as [string, ...string[]])
  .meta({ id: "PatientProfileTabKey" });

export const PatientProfileTab = z
  .strictObject({
    key: PatientProfileTabKey,
    readable: z.boolean().meta({ description: "The caller holds the tab's read permission (spec §6.3)." }),
    count: z.int().min(0).optional().meta({
      description: "Items in the tab, only when readable and once the tab's domain layer is built.",
    }),
  })
  .meta({ id: "PatientProfileTab" });

export const PatientProfile = z
  .strictObject({ patient: Patient, tabs: z.array(PatientProfileTab).length(PATIENT_PROFILE_TABS.length) })
  .meta({ id: "PatientProfile" });

export const PatientSummary = z
  .strictObject({
    id: Uuid,
    status: PatientStatus,
    firstName: z.string(),
    lastName: z.string(),
    preferredName: z.string().optional(),
    dateOfBirth: DateOnly,
    mrn: z.string().optional(),
    primaryPracticeId: Uuid.optional(),
    updatedAt: Timestamp,
  })
  .meta({ id: "PatientSummary", description: "Search and list row." });

const PatientFields = {
  firstName: PersonName,
  middleName: PersonName.nullable().optional(),
  lastName: PersonName,
  preferredName: PersonName.nullable().optional(),
  dateOfBirth: BirthDate,
  email: Email.nullable().optional(),
  phone: Phone.nullable().optional(),
  // A plain nullable UUID, so generated clients get an optional string rather than a wrapper.
  primaryPracticeId: z.uuid().nullable().optional(),
  mrn: Mrn.nullable().optional(),
};

export const PatientCreate = z
  .strictObject({
    ...PatientFields,
    confirmNoDuplicate: z.boolean().default(false).meta({
      description: "Set after reviewing probable duplicates. Without it, a probable duplicate returns 409.",
    }),
  })
  .meta({ id: "PatientCreate", description: "null and an absent field mean the same: not recorded." });

export const PatientUpdate = z
  .strictObject({
    firstName: PatientFields.firstName.optional(),
    middleName: PatientFields.middleName,
    lastName: PatientFields.lastName.optional(),
    preferredName: PatientFields.preferredName,
    dateOfBirth: PatientFields.dateOfBirth.optional(),
    email: PatientFields.email,
    phone: PatientFields.phone,
    primaryPracticeId: PatientFields.primaryPracticeId,
    mrn: PatientFields.mrn,
    status: PatientUpdatableStatus.optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: "Send at least one field." })
  .meta({
    id: "PatientUpdate",
    description: "null clears an optional field. ARCHIVED is set only by /archive.",
  });

export const PatientSearchRequest = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .meta({
        description:
          "Start of the last, first or preferred name. Case, accents and punctuation are ignored. Two words " +
          "match a first-name prefix and a last-name prefix, in either order.",
      }),
    dateOfBirth: DateOnly.optional(),
    mrn: z.string().trim().min(1).max(40).optional(),
    email: z.string().trim().min(3).max(254).optional(),
    phone: z
      .string()
      .trim()
      .min(4)
      .max(32)
      .optional()
      .meta({ description: "Digits are compared; formatting ignored." }),
    includeArchived: z.boolean().default(false),
    limit: z.int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
    cursor: z.string().min(1).optional(),
  })
  .refine((r) => [r.name, r.dateOfBirth, r.mrn, r.email, r.phone].some((v) => v !== undefined), {
    message: "Send at least one search term.",
    path: ["name"],
  })
  .meta({
    id: "PatientSearchRequest",
    description: "Terms are combined with AND. The body is never logged.",
  });

export const PatientListQuery = PageQuery.extend({
  status: PatientStatus.optional().meta({ description: "Default: every status except ARCHIVED." }),
  practiceId: Uuid.optional().meta({ description: "Primary practice." }),
  sort: z.enum(["-updatedAt", "lastName"]).default("-updatedAt"),
});

export const DuplicateMatchReason = z
  .enum(["SAME_EMAIL", "SAME_PHONE", "SAME_MRN", "SAME_DATE_OF_BIRTH_SIMILAR_NAME"])
  .meta({ id: "DuplicateMatchReason" });

export const DuplicateCheckRequest = z
  .strictObject({
    firstName: PersonName,
    lastName: PersonName,
    dateOfBirth: BirthDate,
    email: Email.nullable().optional(),
    phone: Phone.nullable().optional(),
    mrn: Mrn.nullable().optional(),
  })
  .meta({ id: "DuplicateCheckRequest" });

export const DuplicateCandidate = z
  .strictObject({
    patientId: Uuid,
    matchReasons: z.array(DuplicateMatchReason).min(1),
    /** Present when the caller holds patient.read. */
    summary: PatientSummary.optional(),
  })
  .meta({ id: "DuplicateCandidate" });

export const DuplicateCheckResult = z
  .strictObject({ candidates: z.array(DuplicateCandidate).max(10) })
  .meta({ id: "DuplicateCheckResult" });

export const PatientContactKindSchema = z.enum(PatientContactKind).meta({ id: "PatientContactKind" });

export const PatientContact = z
  .strictObject({
    id: Uuid,
    patientId: Uuid,
    kind: PatientContactKindSchema,
    fullName: z.string(),
    relationship: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    isPrimary: z.boolean(),
    notes: z.string().optional(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.int().min(1),
  })
  .meta({ id: "PatientContact" });

export const PatientContactCreate = z
  .strictObject({
    kind: PatientContactKindSchema,
    fullName: z.string().trim().min(1).max(200),
    relationship: z.string().trim().min(1).max(100).optional(),
    phone: Phone.optional(),
    email: Email.optional(),
    isPrimary: z.boolean().default(false),
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .meta({ id: "PatientContactCreate" });

export const PatientContactUpdate = z
  .strictObject({
    kind: PatientContactKindSchema.optional(),
    fullName: z.string().trim().min(1).max(200).optional(),
    relationship: z.string().trim().min(1).max(100).nullable().optional(),
    phone: Phone.nullable().optional(),
    email: Email.nullable().optional(),
    isPrimary: z.boolean().optional(),
    notes: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: "Send at least one field." })
  .meta({ id: "PatientContactUpdate", description: "null clears an optional field." });
