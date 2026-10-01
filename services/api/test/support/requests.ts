// Builds a valid request for any registry operation, so authorization and
// cross-tenant tests can be generated from the endpoint registry (spec §6.8).
import type { EndpointDefinition } from "@aestara/api-contracts";
import { catalogId } from "@aestara/database";

export interface ResourceRefs {
  organizationId: string;
  practiceId: string;
  locationId: string;
  patientId: string;
  contactId: string;
  userId: string;
  assignmentId: string;
  auditEventId: string;
  sessionId: string;
  factorId: string;
}

let n = 0;
const unique = () => `${Date.now().toString(36)}${(++n).toString(36)}`;

export function pathFor(e: EndpointDefinition, refs: ResourceRefs): string {
  const segment = e.path.split("/")[1];
  const idFor: Record<string, string> = {
    organizations: refs.organizationId,
    practices: refs.practiceId,
    locations: refs.locationId,
    users: refs.userId,
    roles: catalogId("role", "FRONT_DESK"),
    audit: refs.auditEventId,
    auth: e.path.includes("/sessions/") ? refs.sessionId : refs.factorId,
  };
  return `/api/v1${e.path
    .replace("{id}", idFor[segment ?? ""] ?? "")
    .replace("{patientId}", refs.patientId)
    .replace("{contactId}", refs.contactId)
    .replace("{assignmentId}", refs.assignmentId)
    .replace("{key}", "patients.primaryPracticeRequired")}`;
}

export function bodyFor(e: EndpointDefinition, refs: ResourceRefs): Record<string, unknown> | undefined {
  const u = unique();
  const bodies: Record<string, Record<string, unknown>> = {
    switchOrganization: { organizationId: refs.organizationId },
    changePassword: { currentPassword: "not the password", newPassword: "a long new passphrase 9" },
    createMfaEnrollment: { type: "TOTP" },
    confirmMfaEnrollment: { totpCode: "123456" },
    createOrganization: {
      name: `Org ${u}`,
      slug: `org-${u}`,
      firstAdmin: { email: `first-${u}@example.test`, displayName: "First Admin" },
    },
    updateOrganization: { name: `Renamed ${u}` },
    bootstrapOrganizationAdmin: { email: `boot-${u}@example.test`, displayName: "Boot Admin" },
    createPractice: { name: `Practice ${u}`, timezone: "America/Chicago" },
    updatePractice: { name: `Practice ${u}` },
    createLocation: { practiceId: refs.practiceId, name: `Location ${u}`, timezone: "America/Chicago" },
    updateLocation: { name: `Location ${u}` },
    createUser: { email: `user-${u}@example.test`, displayName: "New User" },
    updateUser: { displayName: `Name ${u}` },
    createRoleAssignment: { roleId: catalogId("role", "CONSULTANT"), scope: "ORGANIZATION" },
    putProviderProfile: { displayName: "Dr Synthetic" },
    putStaffProfile: { displayName: "Staff Synthetic" },
    resetUserMfa: { identityVerificationMethod: "IN_PERSON" },
    searchPatients: { name: "syn" },
    checkPatientDuplicates: { firstName: "Ana", lastName: "Synthetic", dateOfBirth: "1988-04-12" },
    createPatient: {
      firstName: "Bea",
      lastName: `Synthetic${u}`,
      dateOfBirth: "1990-01-02",
      confirmNoDuplicate: true,
    },
    updatePatient: { preferredName: `P${u}` },
    createPatientContact: { kind: "OTHER", fullName: "Contact Synthetic" },
    updatePatientContact: { fullName: `Contact ${u}` },
    putOrganizationSetting: { value: false },
  };
  if (e.body === undefined) return undefined;
  return bodies[e.operationId] ?? {};
}

export function headersFor(e: EndpointDefinition, version = 1): Record<string, string> {
  return {
    ...(e.idempotency === "required" ? { "idempotency-key": crypto.randomUUID() } : {}),
    ...(e.ifMatch === "required" ? { "if-match": `"v${e.path.startsWith("/settings") ? 0 : version}"` } : {}),
  };
}
