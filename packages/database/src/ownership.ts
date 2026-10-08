// Ownership classification of every table in packages/database (ADR-0018 K-08,
// K-16; spec §3.5, §4.1, §4.6).
//
// The class decides three things:
//   - Row-Level Security: tenant classes are FORCE'd on organizationId; identity
//     and catalog tables are platform-level (spec §4.1) and are not.
//   - Which grants may change a row (spec §4.6): "practice" rows need an
//     ORGANIZATION grant or a PRACTICE/LOCATION grant that covers the row's
//     practice (and location); "organization" rows follow reads across the whole
//     organization (D-01); "user-management" rows follow §4.5 rule 3 (K-07).
//   - Which database role reaches the table (security migration grants).
// scripts/check-rls.ts compares this file with the live database, and
// test/ownership.test.ts compares it with prisma/schema.prisma.

export type OwnershipClass =
  /** Platform-level identity and its security ledger. No organization owns the row. */
  | "identity"
  /** Platform reference data: the permission catalog and system roles. */
  | "catalog"
  /** The organization row itself: the tenant boundary. */
  | "tenant-root"
  /** Owned by the organization as a whole; any in-scope grant in the organization applies. */
  | "organization"
  /** Owned by one practice (and possibly one location) of the organization. */
  | "practice"
  /** Describes another user's access; changes follow separation-of-duties rule 3. */
  | "user-management"
  /** Written by the system for the organization, or for the platform when organizationId is NULL. */
  | "system";

export interface TableOwnership {
  readonly table: string;
  readonly class: OwnershipClass;
  /** Column naming the owning practice ("practice" class only). */
  readonly practiceColumn?: string;
  /** Column naming the owning location, when LOCATION grants can match it. */
  readonly locationColumn?: string;
  /**
   * Whether the platform role (aestara_platform) may reach the table at all.
   * Patient, profile and settings tables are "none" (ADR-0018 K-06).
   */
  readonly platform: "metadata" | "none";
  readonly note: string;
}

export const TABLE_OWNERSHIP: readonly TableOwnership[] = [
  {
    table: "User",
    class: "identity",
    platform: "metadata",
    note: "One person may work for several organizations (spec §4.1)",
  },
  {
    table: "UserCredential",
    class: "identity",
    platform: "metadata",
    note: "Belongs to the platform-level user",
  },
  {
    table: "UserToken",
    class: "identity",
    platform: "metadata",
    note: "Invitation, reset and sign-in step tokens",
  },
  { table: "Device", class: "identity", platform: "metadata", note: "An app install of a user" },
  {
    table: "Session",
    class: "identity",
    platform: "metadata",
    note: "organizationId is the active tenant context, not ownership (spec §4.2)",
  },
  {
    table: "LoginEvent",
    class: "identity",
    platform: "metadata",
    note: "Security ledger; written before any tenant is chosen",
  },
  { table: "Permission", class: "catalog", platform: "metadata", note: "Spec §4.4 catalog" },
  { table: "RolePermission", class: "catalog", platform: "metadata", note: "Spec §4.5 default matrix" },
  {
    table: "Role",
    class: "catalog",
    platform: "metadata",
    note: "System roles only in Layer 1 (UD-07, ADR-0018 K-02)",
  },
  { table: "Organization", class: "tenant-root", platform: "metadata", note: "The tenant" },
  {
    table: "Practice",
    class: "practice",
    platform: "metadata",
    practiceColumn: "id",
    note: "A practice owns itself",
  },
  {
    table: "Location",
    class: "practice",
    platform: "metadata",
    practiceColumn: "practiceId",
    locationColumn: "id",
    note: "Owned by its practice; a LOCATION grant covers only that location",
  },
  {
    table: "Membership",
    class: "user-management",
    platform: "metadata",
    note: "A user's membership in the organization",
  },
  {
    table: "UserRole",
    class: "user-management",
    platform: "metadata",
    note: "Scoped grants; PLATFORM grants have no organization",
  },
  {
    table: "ProviderProfile",
    class: "user-management",
    platform: "none",
    note: "Clinical identity of a member",
  },
  {
    table: "StaffProfile",
    class: "user-management",
    platform: "none",
    note: "Profile of a non-clinical member",
  },
  {
    table: "OrganizationSetting",
    class: "organization",
    platform: "none",
    note: "Organization policy",
  },
  {
    table: "PracticeSetting",
    class: "practice",
    platform: "none",
    practiceColumn: "practiceId",
    note: "Practice policy, such as the offline cache (ADR-0023 K2-17)",
  },
  {
    table: "FeatureFlag",
    class: "system",
    platform: "none",
    note: "Organization or practice override of a flag registered in code; no platform rows in Layer 2 (K2-18)",
  },
  {
    table: "RetentionPolicy",
    class: "organization",
    platform: "none",
    note: "Recorded only; no retention job runs in Layer 2 (K2-19)",
  },
  {
    table: "Patient",
    class: "organization",
    platform: "none",
    note: "Shared across the organization's practices (D-01); primaryPracticeId is not ownership",
  },
  { table: "PatientContact", class: "organization", platform: "none", note: "Follows its patient" },
  {
    table: "StorageObject",
    class: "organization",
    platform: "none",
    note: "Ledger of every stored object; the key is opaque and never returned (spec §6.1.9)",
  },
  {
    table: "PhotographyProtocol",
    class: "organization",
    platform: "none",
    note: "Organization-wide when practiceId is NULL; a practice-scoped admin manages only its practice's protocols (ADR-0023 K2-10)",
  },
  {
    table: "PhotographyProtocolView",
    class: "organization",
    platform: "none",
    note: "Follows its protocol; frozen once the protocol leaves DRAFT",
  },
  {
    table: "PhotoSession",
    class: "organization",
    platform: "none",
    note: "Patient data, shared across practices (D-01); practiceId records where it was captured",
  },
  { table: "PatientPhoto", class: "organization", platform: "none", note: "Follows its patient" },
  { table: "PhotoDerivative", class: "organization", platform: "none", note: "Follows its source photo" },
  { table: "PhotoTag", class: "organization", platform: "none", note: "Follows its photo" },
  { table: "PhotoPermission", class: "organization", platform: "none", note: "Versioned media permission" },
  {
    table: "MediaRelease",
    class: "organization",
    platform: "none",
    note: "A release of one asset for one purpose",
  },
  {
    table: "MediaReleasePermission",
    class: "organization",
    platform: "none",
    note: "The permission versions a release pinned",
  },
  {
    table: "AIJob",
    class: "organization",
    platform: "none",
    note: "Generic job record; image derivatives from Layer 2 (K2-06)",
  },
  {
    table: "PatientMedicalHistory",
    class: "organization",
    platform: "none",
    note: "Clinical patient data, shared across practices (D-01; ADR-0026 K3-08)",
  },
  {
    table: "PatientConcern",
    class: "organization",
    platform: "none",
    note: "Follows its patient (ADR-0026 K3-08)",
  },
  {
    table: "Consultation",
    class: "practice",
    platform: "none",
    practiceColumn: "practiceId",
    locationColumn: "locationId",
    note: "Practice-owned record (spec §4.6; ADR-0026 K3-20)",
  },
  {
    table: "ConsultationConcern",
    class: "organization",
    platform: "none",
    note: "Follows its consultation; the service scopes writes by the consultation's practice (K3-20)",
  },
  {
    table: "ConsultationNote",
    class: "organization",
    platform: "none",
    note: "Follows its consultation; the service scopes writes by the consultation's practice (K3-20)",
  },
  {
    table: "PhotoAnnotation",
    class: "organization",
    platform: "none",
    note: "Follows its photo (ADR-0026 K3-10)",
  },
  { table: "BeforeAfterSet", class: "organization", platform: "none", note: "Patient data (ADR-0026 K3-20)" },
  { table: "Document", class: "organization", platform: "none", note: "Patient document (ADR-0026 K3-16)" },
  { table: "DocumentVersion", class: "organization", platform: "none", note: "Immutable file version" },
  {
    table: "TreatmentCategory",
    class: "organization",
    platform: "none",
    note: "Organization-wide catalog; the service changes it only through an organization-wide grant (ADR-0028 K4-03, K4-22)",
  },
  {
    table: "Treatment",
    class: "organization",
    platform: "none",
    note: "Organization-wide catalog; the service changes it only through an organization-wide grant (ADR-0028 K4-03, K4-22)",
  },
  {
    table: "TreatmentPlan",
    class: "practice",
    platform: "none",
    practiceColumn: "practiceId",
    note: "Practice-owned; no location, so a LOCATION grant reads plans but never changes them (ADR-0028 K4-22)",
  },
  {
    table: "TreatmentPlanItem",
    class: "organization",
    platform: "none",
    note: "Follows its plan; the service scopes writes by the plan's practice (K4-22)",
  },
  {
    table: "Procedure",
    class: "practice",
    platform: "none",
    practiceColumn: "practiceId",
    locationColumn: "locationId",
    note: "Practice-owned; its location is optional (ADR-0028 K4-09, K4-22)",
  },
  {
    table: "Estimate",
    class: "organization",
    platform: "none",
    note: "Follows its plan; the service scopes writes by the plan's practice (K4-22)",
  },
  {
    table: "ConsentTemplate",
    class: "organization",
    platform: "none",
    note: "Organization-wide when practiceId is NULL; a practice-scoped admin manages only its practice's templates (ADR-0028 K4-11)",
  },
  {
    table: "ConsentTemplateVersion",
    class: "organization",
    platform: "none",
    note: "Follows its template",
  },
  {
    table: "ConsentAssignment",
    class: "organization",
    platform: "none",
    note: "Takes the practice of its linked consultation, plan, procedure or practice template; otherwise patient-level (ADR-0028 K4-22)",
  },
  {
    table: "ConsentSignature",
    class: "organization",
    platform: "none",
    note: "Follows its consent; written once",
  },
  {
    table: "PatientHandoff",
    class: "organization",
    platform: "none",
    note: "Follows the consent or plan it is scoped to (ADR-0028 K4-13)",
  },
  {
    table: "EducationContent",
    class: "organization",
    platform: "none",
    note: "Organization-wide library; changed only through an organization-wide grant (ADR-0028 K4-17)",
  },
  {
    table: "EducationContentVersion",
    class: "organization",
    platform: "none",
    note: "Follows its content",
  },
  {
    table: "ContentAssignment",
    class: "organization",
    platform: "none",
    note: "Patient data (ADR-0028 K4-18)",
  },
  {
    table: "PatientInstruction",
    class: "organization",
    platform: "none",
    note: "Patient data (ADR-0028 K4-18)",
  },
  {
    table: "DataExportJob",
    class: "organization",
    platform: "none",
    note: "One patient's export, requested with data.export (ADR-0028 K4-21)",
  },
  {
    table: "AuditEvent",
    class: "system",
    platform: "metadata",
    note: "organizationId NULL for platform-level events",
  },
  {
    table: "IdempotencyKey",
    class: "system",
    platform: "metadata",
    note: "organizationId NULL for requests made before a tenant is chosen",
  },
  {
    table: "OutboxEvent",
    class: "system",
    platform: "metadata",
    note: "Append-only for the api and platform (the audit feed); relayed by aestara_worker (K2-07)",
  },
];

/** Classes whose tables carry a tenant and are protected by forced Row-Level Security. */
export const TENANT_CLASSES: readonly OwnershipClass[] = [
  "tenant-root",
  "organization",
  "practice",
  "user-management",
  "system",
];

export function ownershipOf(table: string): TableOwnership {
  const entry = TABLE_OWNERSHIP.find((t) => t.table === table);
  if (!entry) throw new Error(`table ${table} has no ownership classification`);
  return entry;
}
