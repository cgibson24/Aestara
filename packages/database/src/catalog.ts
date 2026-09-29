// Permission catalog and default role matrix (spec §4.3–§4.5; ADR-0018 K-01).
//
// This is data, seeded once by the Layer 1 catalog migration, so later layers
// never rewrite role data. test/catalog.test.ts proves it equals the spec tables
// cell by cell; scripts/generate-catalog-migration.ts renders the migration.
import { createHash } from "node:crypto";

export type PermissionSource = "bible" | "proposed";

export interface PermissionDefinition {
  readonly key: string;
  readonly description: string;
  /** "bible": Bible §3.3. "proposed": spec §4.4 gap resolution (UD-16, confirmed in ADR-0018). */
  readonly source: PermissionSource;
}

export const PERMISSIONS = [
  // Bible §3.3 (41 keys)
  {
    key: "patient.read",
    source: "bible",
    description: "Read patient demographics and the profile shell, never clinical content",
  },
  { key: "patient.create", source: "bible", description: "Create patients" },
  { key: "patient.update", source: "bible", description: "Update patient demographics, contacts and status" },
  { key: "patient.archive", source: "bible", description: "Archive patients" },
  {
    key: "photo.capture",
    source: "bible",
    description: "Capture and upload clinical photos; review patient-submitted photos",
  },
  { key: "photo.view", source: "bible", description: "View clinical photos and derivatives" },
  { key: "photo.annotate", source: "bible", description: "Annotate and tag photos; adjust registration" },
  { key: "photo.export", source: "bible", description: "Export photos and access original images" },
  { key: "photo.permission.read", source: "bible", description: "Read media permission states" },
  { key: "photo.permission.manage", source: "bible", description: "Record media permission changes" },
  {
    key: "consultation.create",
    source: "bible",
    description: "Create consultations and read consultation records",
  },
  {
    key: "consultation.edit",
    source: "bible",
    description: "Edit consultation content; clinically complete instructions",
  },
  {
    key: "consultation.complete",
    source: "bible",
    description: "Complete consultations and release consultation materials",
  },
  { key: "simulation.create", source: "bible", description: "Create simulations and set their parameters" },
  { key: "simulation.generate", source: "bible", description: "Generate and regenerate simulation versions" },
  { key: "simulation.review", source: "bible", description: "View simulations, without review decisions" },
  { key: "simulation.approve", source: "bible", description: "Approve, reject or archive simulations" },
  { key: "simulation.release", source: "bible", description: "Release approved simulations to the patient" },
  {
    key: "treatmentplan.create",
    source: "bible",
    description: "Create treatment plans; read plans and the treatment catalog",
  },
  { key: "treatmentplan.edit", source: "bible", description: "Edit treatment plans" },
  { key: "treatmentplan.send", source: "bible", description: "Send treatment plans to the patient" },
  { key: "consent.template.manage", source: "bible", description: "Manage consent templates" },
  {
    key: "consent.assign",
    source: "bible",
    description: "Assign consents; record witness and staff-assisted signatures",
  },
  { key: "consent.sign.provider", source: "bible", description: "Sign consents as the provider" },
  { key: "consent.void", source: "bible", description: "Void consents" },
  {
    key: "message.send",
    source: "bible",
    description: "Send messages and read threads the user participates in",
  },
  { key: "appointment.manage", source: "bible", description: "Read and manage appointments" },
  { key: "telehealth.start", source: "bible", description: "Start telehealth sessions" },
  { key: "user.read", source: "bible", description: "Read users" },
  { key: "user.create", source: "bible", description: "Invite and create users" },
  { key: "user.update", source: "bible", description: "Update users and their provider or staff profiles" },
  { key: "user.disable", source: "bible", description: "Disable users" },
  { key: "role.read", source: "bible", description: "Read roles and the permission catalog" },
  { key: "role.assign", source: "bible", description: "Assign and revoke roles" },
  { key: "practice.read", source: "bible", description: "Read practices and locations" },
  {
    key: "practice.manage",
    source: "bible",
    description: "Manage practices, locations, protocols, the treatment catalog and appointment types",
  },
  { key: "content.read", source: "bible", description: "Read education content and assign it" },
  { key: "content.manage", source: "bible", description: "Manage education content" },
  { key: "integration.read", source: "bible", description: "Read integrations and their sync status" },
  { key: "integration.manage", source: "bible", description: "Manage integrations" },
  { key: "audit.read", source: "bible", description: "Read audit events" },
  // Spec §4.4 proposed keys (12)
  { key: "organization.read", source: "proposed", description: "Read organizations" },
  {
    key: "organization.manage",
    source: "proposed",
    description: "Create organizations (platform) or update one's own organization",
  },
  { key: "document.read", source: "proposed", description: "Read clinical documents" },
  { key: "document.manage", source: "proposed", description: "Upload and release documents" },
  { key: "procedure.manage", source: "proposed", description: "Manage procedures" },
  { key: "data.export", source: "proposed", description: "Request and download patient data exports" },
  {
    key: "security.manage",
    source: "proposed",
    description: "Revoke sessions and devices; reset a user's second factors",
  },
  { key: "ai.model.read", source: "proposed", description: "Read the AI model registry" },
  { key: "ai.model.manage", source: "proposed", description: "Manage AI model rollouts" },
  { key: "configuration.manage", source: "proposed", description: "Manage settings and feature flags" },
  { key: "similarcase.search", source: "proposed", description: "Search similar cases" },
  {
    key: "marketing.library.read",
    source: "proposed",
    description: "Read marketing assets that have a current release",
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export interface RoleDefinition {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** Spec §4.5 column abbreviation; PATIENT has no column (it holds no staff permission). */
  readonly column: string | null;
}

/** System roles (spec §4.3, one per Bible §3.2 row). Organization-scoped custom roles are UD-07. */
export const ROLES = [
  {
    key: "SUPER_ADMIN",
    column: "SA",
    name: "Super admin",
    description: "Platform operations; organization metadata only, never patient data",
  },
  {
    key: "ORGANIZATION_ADMIN",
    column: "OA",
    name: "Organization admin",
    description: "Administers one organization",
  },
  {
    key: "PRACTICE_ADMIN",
    column: "PA",
    name: "Practice admin",
    description: "Administers the practices in the assignment's scope",
  },
  {
    key: "SURGEON_PHYSICIAN",
    column: "SP",
    name: "Surgeon / physician",
    description: "Clinical lead: consultations, simulations, plans and consents",
  },
  {
    key: "NURSE_INJECTOR_AESTHETICIAN",
    column: "NI",
    name: "Nurse injector / aesthetician",
    description: "Clinical staff: capture, consultations and plans",
  },
  { key: "PHOTOGRAPHER", column: "PH", name: "Photographer", description: "Clinical photography" },
  {
    key: "CONSULTANT",
    column: "CO",
    name: "Consultant",
    description: "Patient consultations without clinical authority",
  },
  { key: "FRONT_DESK", column: "FD", name: "Front desk", description: "Patient registration and scheduling" },
  { key: "MARKETING", column: "MK", name: "Marketing", description: "Released marketing assets only" },
  {
    key: "PATIENT",
    column: null,
    name: "Patient",
    description: "Patient-app access through a patient link; holds no staff permission",
  },
] as const satisfies readonly RoleDefinition[];

export type RoleKey = (typeof ROLES)[number]["key"];

/**
 * Default role → permission grants (spec §4.5, least privilege). A "○" cell in the
 * spec is a grant that applies within the assignment's practice or location
 * scope; scope lives on the assignment (UserRole), not here.
 */
export const ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly PermissionKey[]>> = {
  SUPER_ADMIN: [
    "user.read",
    "user.create",
    "user.update",
    "user.disable",
    "role.read",
    "role.assign",
    "practice.read",
    "integration.read",
    "audit.read",
    "organization.read",
    "organization.manage",
    "security.manage",
    "ai.model.read",
    "ai.model.manage",
  ],
  ORGANIZATION_ADMIN: [
    "consent.template.manage",
    "user.read",
    "user.create",
    "user.update",
    "user.disable",
    "role.read",
    "role.assign",
    "practice.read",
    "practice.manage",
    "content.read",
    "content.manage",
    "integration.read",
    "integration.manage",
    "audit.read",
    "organization.read",
    "organization.manage",
    "data.export",
    "security.manage",
    "ai.model.read",
    "configuration.manage",
  ],
  PRACTICE_ADMIN: [
    "patient.read",
    "patient.create",
    "patient.update",
    "patient.archive",
    "consent.template.manage",
    "appointment.manage",
    "user.read",
    "user.create",
    "user.update",
    "user.disable",
    "role.read",
    "role.assign",
    "practice.read",
    "practice.manage",
    "content.read",
    "content.manage",
    "audit.read",
    "security.manage",
    "configuration.manage",
  ],
  SURGEON_PHYSICIAN: [
    "patient.read",
    "patient.create",
    "patient.update",
    "patient.archive",
    "photo.capture",
    "photo.view",
    "photo.annotate",
    "photo.export",
    "photo.permission.read",
    "photo.permission.manage",
    "consultation.create",
    "consultation.edit",
    "consultation.complete",
    "simulation.create",
    "simulation.generate",
    "simulation.review",
    "simulation.approve",
    "simulation.release",
    "treatmentplan.create",
    "treatmentplan.edit",
    "treatmentplan.send",
    "consent.assign",
    "consent.sign.provider",
    "consent.void",
    "message.send",
    "appointment.manage",
    "telehealth.start",
    "practice.read",
    "content.read",
    "document.read",
    "document.manage",
    "procedure.manage",
    "similarcase.search",
  ],
  NURSE_INJECTOR_AESTHETICIAN: [
    "patient.read",
    "patient.create",
    "patient.update",
    "photo.capture",
    "photo.view",
    "photo.annotate",
    "photo.permission.read",
    "photo.permission.manage",
    "consultation.create",
    "consultation.edit",
    "simulation.create",
    "simulation.generate",
    "simulation.review",
    "treatmentplan.create",
    "treatmentplan.edit",
    "consent.assign",
    "message.send",
    "appointment.manage",
    "telehealth.start",
    "practice.read",
    "content.read",
    "document.read",
    "document.manage",
    "procedure.manage",
  ],
  PHOTOGRAPHER: ["patient.read", "photo.capture", "photo.view", "photo.permission.read", "practice.read"],
  CONSULTANT: [
    "patient.read",
    "patient.create",
    "patient.update",
    "photo.view",
    "photo.permission.read",
    "consultation.create",
    "consultation.edit",
    "simulation.review",
    "treatmentplan.create",
    "treatmentplan.edit",
    "treatmentplan.send",
    "consent.assign",
    "message.send",
    "appointment.manage",
    "practice.read",
    "content.read",
    "document.read",
  ],
  FRONT_DESK: ["patient.read", "patient.create", "patient.update", "appointment.manage", "practice.read"],
  MARKETING: ["photo.export", "marketing.library.read"],
  PATIENT: [],
};

/**
 * Permissions a platform actor can never grant (spec §4.5 rule 2 as corrected by
 * ADR-0018 K-05): any patient, photo, consultation, simulation or document
 * permission, and the clinical consent actions. `consent.template.manage` is
 * administrative and is deliberately not listed.
 */
export const PLATFORM_UNGRANTABLE_PREFIXES = [
  "patient.",
  "photo.",
  "consultation.",
  "simulation.",
  "document.",
] as const;
export const PLATFORM_UNGRANTABLE_KEYS = ["consent.assign", "consent.sign.provider", "consent.void"] as const;

export function isPlatformUngrantable(key: string): boolean {
  return (
    PLATFORM_UNGRANTABLE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    (PLATFORM_UNGRANTABLE_KEYS as readonly string[]).includes(key)
  );
}

// Fixed identifiers, so every environment and every test refers to the same rows.
// They are valid UUIDv7 values: a fixed timestamp (the catalog's creation) plus
// bits taken from a SHA-256 of the key.
const CATALOG_EPOCH_MS = Date.UTC(2026, 8, 29);

export function catalogId(kind: "permission" | "role", key: string): string {
  const hash = createHash("sha256").update(`aestara:${kind}:${key}`).digest();
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(CATALOG_EPOCH_MS, 0, 6);
  hash.copy(bytes, 6, 0, 10);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f); // version 7
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f); // RFC 9562 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
