// GENERATED from packages/database/prisma/schema.prisma by scripts/generate-enums.ts. Do not edit.
// Clients must tolerate values added later (spec §6.1.1).

export const UserKind = ["WORKFORCE", "PATIENT"] as const;
export type UserKind = (typeof UserKind)[number];

export const UserStatus = ["INVITED", "ACTIVE", "LOCKED", "DISABLED"] as const;
export type UserStatus = (typeof UserStatus)[number];

export const OrganizationStatus = ["ACTIVE", "SUSPENDED", "OFFBOARDED"] as const;
export type OrganizationStatus = (typeof OrganizationStatus)[number];

export const OperationalStatus = ["ACTIVE", "INACTIVE"] as const;
export type OperationalStatus = (typeof OperationalStatus)[number];

export const MembershipStatus = ["INVITED", "ACTIVE", "DISABLED"] as const;
export type MembershipStatus = (typeof MembershipStatus)[number];

export const RoleAssignmentScope = ["PLATFORM", "ORGANIZATION", "PRACTICE", "LOCATION"] as const;
export type RoleAssignmentScope = (typeof RoleAssignmentScope)[number];

export const ClientApp = ["IOS_PROVIDER", "IOS_PATIENT", "ADMIN_WEB"] as const;
export type ClientApp = (typeof ClientApp)[number];

export const CredentialType = ["PASSWORD", "TOTP", "WEBAUTHN"] as const;
export type CredentialType = (typeof CredentialType)[number];

export const SessionRevokedReason = ["LOGOUT", "ADMIN_REVOKED", "DEVICE_REVOKED", "REFRESH_TOKEN_REUSE", "CREDENTIAL_CHANGED", "MEMBERSHIP_DISABLED", "USER_DISABLED"] as const;
export type SessionRevokedReason = (typeof SessionRevokedReason)[number];

export const LoginEventType = ["LOGIN_SUCCESS", "LOGIN_FAILURE", "LOGOUT", "MFA_CHALLENGE_ISSUED"] as const;
export type LoginEventType = (typeof LoginEventType)[number];

export const LoginFailureReason = ["INVALID_CREDENTIALS", "ACCOUNT_LOCKED", "ACCOUNT_DISABLED", "NO_ACTIVE_MEMBERSHIP", "MFA_FAILED", "RATE_LIMITED"] as const;
export type LoginFailureReason = (typeof LoginFailureReason)[number];

export const UserTokenPurpose = ["INVITATION", "PASSWORD_RESET", "MFA_CHALLENGE", "WEBAUTHN_REGISTRATION"] as const;
export type UserTokenPurpose = (typeof UserTokenPurpose)[number];

export const PatientStatus = ["ACTIVE", "INACTIVE", "ARCHIVED", "DECEASED"] as const;
export type PatientStatus = (typeof PatientStatus)[number];

export const PatientContactKind = ["EMERGENCY_CONTACT", "GUARDIAN", "CAREGIVER", "OTHER"] as const;
export type PatientContactKind = (typeof PatientContactKind)[number];

export const ActorType = ["USER", "SERVICE", "SYSTEM"] as const;
export type ActorType = (typeof ActorType)[number];

export const AuditOutcome = ["SUCCESS", "DENIED", "FAILURE"] as const;
export type AuditOutcome = (typeof AuditOutcome)[number];

export const IdempotencyState = ["IN_PROGRESS", "COMPLETED"] as const;
export type IdempotencyState = (typeof IdempotencyState)[number];

export const AuditAction = ["LOGIN_SUCCESS", "LOGIN_FAILURE", "LOGOUT", "PATIENT_CREATED", "PATIENT_VIEWED", "PATIENT_UPDATED", "PATIENT_ARCHIVED", "PHOTO_CAPTURED", "PHOTO_VIEWED", "PHOTO_EXPORTED", "PHOTO_PERMISSION_CHANGED", "CONSULTATION_CREATED", "CONSULTATION_COMPLETED", "SIMULATION_GENERATED", "SIMULATION_VIEWED", "SIMULATION_APPROVED", "SIMULATION_REJECTED", "SIMULATION_REGENERATED", "SIMULATION_RELEASED", "CONSENT_ASSIGNED", "CONSENT_VIEWED", "CONSENT_SIGNED", "CONSENT_COMPLETED", "CONSENT_VOIDED", "MESSAGE_SENT", "ATTACHMENT_DOWNLOADED", "USER_CREATED", "USER_UPDATED", "USER_DISABLED", "ROLE_ASSIGNED", "INTEGRATION_SYNC_STARTED", "INTEGRATION_SYNC_SUCCEEDED", "INTEGRATION_SYNC_FAILED", "DATA_EXPORT_REQUESTED", "DATA_EXPORT_COMPLETED", "SECURITY_SESSION_REVOKED", "SIMULATION_CREATED", "SIMULATION_STATUS_CHANGED", "CONSENT_STATUS_CHANGED", "DOCUMENT_VIEWED", "ACCESS_DENIED", "ROLE_REVOKED", "PATIENT_ACCOUNT_LINKED", "CONSULTATION_STATUS_CHANGED", "PHOTO_ANNOTATED", "PHOTO_INTAKE_REVIEWED", "BEFORE_AFTER_CREATED", "MEDIA_RELEASED", "MEDIA_RELEASE_REVOKED", "SIMILAR_CASES_SHOWN", "AI_MODEL_ROLLOUT_CHANGED", "TREATMENT_PLAN_STATUS_CHANGED", "CONSENT_TEMPLATE_PUBLISHED", "DOCUMENT_RELEASED", "CONTENT_ASSIGNED", "INSTRUCTION_ASSIGNED", "INSTRUCTION_ACKNOWLEDGED", "APPOINTMENT_STATUS_CHANGED", "TELEHEALTH_STATUS_CHANGED", "INTEGRATION_CONFIG_CHANGED", "DATA_EXPORT_DOWNLOADED", "CONFIGURATION_CHANGED", "SECURITY_CREDENTIAL_CHANGED", "ORGANIZATION_SWITCHED"] as const;
export type AuditAction = (typeof AuditAction)[number];
