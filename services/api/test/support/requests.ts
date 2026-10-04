// Builds a valid request for any registry operation, so authorization and
// cross-tenant tests can be generated from the endpoint registry (spec §6.8).
import type { EndpointDefinition } from "@aestara/api-contracts";
import { catalogId, uuidv7 } from "@aestara/database";

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
  protocolId: string;
  photoSessionId: string;
  photoId: string;
  releaseId: string;
  consultationId: string;
  noteId: string;
  concernId: string;
  entryId: string;
  setId: string;
  annotationId: string;
  exportId: string;
  documentId: string;
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
    "photography-protocols": refs.protocolId,
  };
  const key = e.path.startsWith("/feature-flags")
    ? "photography.ghostOverlay"
    : e.path.startsWith("/settings/practices")
      ? "offline.cachePolicy"
      : "patients.primaryPracticeRequired";
  return `/api/v1${e.path
    .replace("{id}", idFor[segment ?? ""] ?? "")
    .replace("{patientId}", refs.patientId)
    .replace("{contactId}", refs.contactId)
    .replace("{assignmentId}", refs.assignmentId)
    .replace("{sessionId}", refs.photoSessionId)
    .replace("{photoId}", refs.photoId)
    .replace("{releaseId}", refs.releaseId)
    .replace("{consultationId}", refs.consultationId)
    .replace("{noteId}", refs.noteId)
    .replace("{concernId}", refs.concernId)
    .replace("{entryId}", refs.entryId)
    .replace("{setId}", refs.setId)
    .replace("{annotationId}", refs.annotationId)
    .replace("{exportId}", refs.exportId)
    .replace("{documentId}", refs.documentId)
    .replace("{practiceId}", refs.practiceId)
    .replace("{key}", key)}`;
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
    createPhotographyProtocol: {
      name: `Protocol ${u}`,
      bodyRegion: "FACE",
      views: [{ viewKey: "FRONT", name: "Front", isRequired: true }],
    },
    updatePhotographyProtocol: { name: `Protocol ${u}` },
    createPhotoSession: { protocolId: refs.protocolId },
    completePhotoSession: { acknowledgeMissingRequiredViews: true },
    createPhotoUpload: {
      photoSessionId: refs.photoSessionId,
      viewKey: "FRONT",
      contentType: "image/jpeg",
      byteSize: 4,
      sha256: "b".repeat(64),
      capturedAt: new Date().toISOString(),
    },
    createPhotoAccessUrl: { variant: "THUMBNAIL" },
    createPhotoAccessUrls: { photoIds: [refs.photoId], variant: "THUMBNAIL" },
    replacePhotoTags: { tags: ["fixture"] },
    recordPhotoPermission: { category: "WEBSITE", state: "REQUESTED" },
    createMediaRelease: { purpose: "PATIENT_APP", photoId: refs.photoId },
    revokeMediaRelease: { reason: "Fixture" },
    recordOfflineAuditEvents: {
      events: [
        {
          id: uuidv7(),
          action: "PATIENT_VIEWED",
          patientId: refs.patientId,
          occurredAt: new Date().toISOString(),
        },
      ],
    },
    createConsultation: { practiceId: refs.practiceId, reason: "Fixture" },
    updateConsultation: { reason: `Reason ${u}` },
    cancelConsultation: { reason: "Fixture" },
    completeConsultation: { releaseDecision: "NOTHING_TO_RELEASE" },
    putConsultationConcerns: { concernIds: [refs.concernId] },
    createConsultationNote: { body: "Fixture note" },
    updateConsultationNote: { body: `Fixture note ${u}` },
    createPatientConcern: { area: "LIPS", description: "Fixture concern" },
    createBeforeAfterSet: { beforePhotoId: refs.photoId, afterPhotoId: uuidv7() },
    updateBeforeAfterSet: { title: `Set ${u}` },
    createPhotoAnnotation: { layer: { schemaVersion: 1, shapes: [] } },
    updatePhotoAnnotation: { label: `Layer ${u}` },
    createPhotoExport: { purpose: "CLINICAL_USE" },
    createBeforeAfterExport: { purpose: "CLINICAL_USE" },
    createDocumentUpload: {
      title: `Letter ${u}`,
      contentType: "application/pdf",
      byteSize: 10,
      sha256: "c".repeat(64),
    },
    completeDocumentUpload: { uploadId: uuidv7() },
    updatePatientConcern: { description: `Fixture concern ${u}` },
    createMedicalHistoryEntry: { category: "ALLERGY", description: "Fixture allergy" },
    updateMedicalHistoryEntry: { description: `Fixture entry ${u}` },
    putFeatureFlag: { enabled: false },
    putPracticeSetting: { value: { maxPatients: 10, maxAgeDays: 3 } },
    createRetentionPolicy: {
      recordCategory: "CLINICAL_PHOTO",
      action: "REVIEW",
      retentionDays: 3650,
      basis: "Fixture schedule",
      effectiveFrom: new Date(Date.now() + 60_000 + n).toISOString(),
    },
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
