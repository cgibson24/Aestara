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

export const MedicalHistoryCategory = ["ALLERGY", "MEDICATION", "CONDITION", "PRIOR_PROCEDURE", "PRIOR_AESTHETIC_TREATMENT", "OTHER"] as const;
export type MedicalHistoryCategory = (typeof MedicalHistoryCategory)[number];

export const RecordSource = ["STAFF", "PATIENT_INTAKE", "INTEGRATION"] as const;
export type RecordSource = (typeof RecordSource)[number];

export const ConsultationStatus = ["DRAFT", "IN_PROGRESS", "AWAITING_INFORMATION", "READY_FOR_REVIEW", "COMPLETED", "CANCELLED", "ARCHIVED"] as const;
export type ConsultationStatus = (typeof ConsultationStatus)[number];

export const NoteStatus = ["DRAFT", "FINAL"] as const;
export type NoteStatus = (typeof NoteStatus)[number];

export const ConsultationReleaseDecision = ["NOTHING_TO_RELEASE", "MATERIALS_RELEASED"] as const;
export type ConsultationReleaseDecision = (typeof ConsultationReleaseDecision)[number];

export const ProcedureStatus = ["PLANNED", "SCHEDULED", "COMPLETED", "CANCELLED"] as const;
export type ProcedureStatus = (typeof ProcedureStatus)[number];

export const TreatmentPlanStatus = ["DRAFT", "PROPOSED", "SENT_TO_PATIENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "SCHEDULED", "COMPLETED", "CANCELLED"] as const;
export type TreatmentPlanStatus = (typeof TreatmentPlanStatus)[number];

export const TreatmentPlanResponseSource = ["IN_CLINIC", "PATIENT_APP", "SIBLING_ACCEPTED"] as const;
export type TreatmentPlanResponseSource = (typeof TreatmentPlanResponseSource)[number];

export const ProtocolStatus = ["DRAFT", "ACTIVE", "RETIRED"] as const;
export type ProtocolStatus = (typeof ProtocolStatus)[number];

export const BodyRegion = ["FACE", "BREAST", "ABDOMEN_BODY", "OTHER"] as const;
export type BodyRegion = (typeof BodyRegion)[number];

export const PhotoSessionStatus = ["IN_PROGRESS", "COMPLETED", "ABANDONED"] as const;
export type PhotoSessionStatus = (typeof PhotoSessionStatus)[number];

export const PhotoSource = ["PROVIDER_CAPTURE", "PATIENT_UPLOAD", "IMPORT"] as const;
export type PhotoSource = (typeof PhotoSource)[number];

export const PhotoStatus = ["UPLOAD_PENDING", "QUARANTINED", "PENDING_REVIEW", "ACCEPTED", "RETAKE_REQUESTED", "REJECTED", "ARCHIVED"] as const;
export type PhotoStatus = (typeof PhotoStatus)[number];

export const DerivativeKind = ["THUMBNAIL", "DISPLAY_PREVIEW", "ANNOTATED_DERIVATIVE", "BEFORE_AFTER_DERIVATIVE", "AI_SIMULATION_DERIVATIVE", "MARKETING_DERIVATIVE", "EXPORT_DERIVATIVE"] as const;
export type DerivativeKind = (typeof DerivativeKind)[number];

export const MediaPermissionCategory = ["CLINICAL_USE", "PATIENT_APP", "EDUCATION", "WEBSITE", "SOCIAL_MEDIA", "PAID_ADVERTISING", "RESEARCH", "AI_TRAINING", "INTERNAL_AI_EVALUATION"] as const;
export type MediaPermissionCategory = (typeof MediaPermissionCategory)[number];

export const PhotoPermissionState = ["NOT_REQUESTED", "REQUESTED", "GRANTED", "DECLINED", "REVOKED", "EXPIRED"] as const;
export type PhotoPermissionState = (typeof PhotoPermissionState)[number];

export const PermissionScope = ["PATIENT_WIDE", "PHOTO_SESSION", "PHOTO"] as const;
export type PermissionScope = (typeof PermissionScope)[number];

export const PermissionEvidence = ["SIGNED_CONSENT", "PATIENT_APP_ACTION", "STAFF_ATTESTATION", "INTEGRATION_IMPORT"] as const;
export type PermissionEvidence = (typeof PermissionEvidence)[number];

export const RegistrationMode = ["NONE", "AUTOMATIC", "MANUAL"] as const;
export type RegistrationMode = (typeof RegistrationMode)[number];

export const StorageObjectClass = ["CLINICAL_ORIGINAL", "CLINICAL_DERIVATIVE", "AI_ARTIFACT", "DOCUMENT", "SIGNATURE", "MESSAGE_ATTACHMENT", "CONTENT_MEDIA", "DATA_EXPORT", "INTEGRATION_PAYLOAD"] as const;
export type StorageObjectClass = (typeof StorageObjectClass)[number];

export const StorageObjectStatus = ["PENDING_UPLOAD", "QUARANTINED", "AVAILABLE", "REJECTED", "PURGED"] as const;
export type StorageObjectStatus = (typeof StorageObjectStatus)[number];

export const MalwareScanStatus = ["NOT_REQUIRED", "PENDING", "CLEAN", "INFECTED", "ERROR"] as const;
export type MalwareScanStatus = (typeof MalwareScanStatus)[number];

export const AIJobType = ["IMAGE_DERIVATIVE", "INPUT_QUALITY_CHECK", "LANDMARK_DETECTION", "SEGMENTATION", "SIMULATION_GENERATION", "OUTPUT_VALIDATION", "IMAGE_REGISTRATION", "SIMILAR_CASE_SEARCH", "OUTCOME_MEASUREMENT"] as const;
export type AIJobType = (typeof AIJobType)[number];

export const AIJobStatus = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"] as const;
export type AIJobStatus = (typeof AIJobStatus)[number];

export const SimulationCategory = ["LIP_FILLER", "RHINOPLASTY", "BOTULINUM_TOXIN", "CHEEK_CHIN_JAW_FILLER", "FACIAL_LIFT_PROCEDURES", "BREAST_BODY_CONTOUR", "SKIN_RESURFACING_TIGHTENING"] as const;
export type SimulationCategory = (typeof SimulationCategory)[number];

export const TemplateVersionStatus = ["DRAFT", "PUBLISHED", "RETIRED"] as const;
export type TemplateVersionStatus = (typeof TemplateVersionStatus)[number];

export const ConsentStatus = ["DRAFT", "ASSIGNED", "VIEWED", "IN_PROGRESS", "SIGNED_BY_PATIENT", "SIGNED_BY_PROVIDER", "COMPLETE", "VOIDED", "SUPERSEDED"] as const;
export type ConsentStatus = (typeof ConsentStatus)[number];

export const SignerRole = ["PATIENT", "PROVIDER", "WITNESS"] as const;
export type SignerRole = (typeof SignerRole)[number];

export const SignatureMethod = ["DRAWN", "TYPED"] as const;
export type SignatureMethod = (typeof SignatureMethod)[number];

export const HandoffPurpose = ["CONSENT_SIGNING", "PLAN_RESPONSE"] as const;
export type HandoffPurpose = (typeof HandoffPurpose)[number];

export const HandoffEndReason = ["EXITED", "COMPLETED", "IDLE_TIMEOUT", "MAX_LIFETIME", "REVOKED"] as const;
export type HandoffEndReason = (typeof HandoffEndReason)[number];

export const DocumentType = ["CONSULTATION_SUMMARY", "SIGNED_CONSENT", "TREATMENT_PLAN", "ESTIMATE", "UPLOADED_CLINICAL", "EXTERNAL_EMR", "OTHER"] as const;
export type DocumentType = (typeof DocumentType)[number];

export const DocumentStatus = ["ACTIVE", "ARCHIVED"] as const;
export type DocumentStatus = (typeof DocumentStatus)[number];

export const EducationContentType = ["VIDEO", "IMAGE", "ANIMATION", "TEXT", "PDF", "PROCEDURE_EXPLANATION", "FAQ", "PRE_OP_INSTRUCTION", "POST_OP_INSTRUCTION"] as const;
export type EducationContentType = (typeof EducationContentType)[number];

export const ContentAssignmentStatus = ["ASSIGNED", "OPENED", "VIEWED", "COMPLETED", "ACKNOWLEDGED"] as const;
export type ContentAssignmentStatus = (typeof ContentAssignmentStatus)[number];

export const ActorType = ["USER", "SERVICE", "SYSTEM"] as const;
export type ActorType = (typeof ActorType)[number];

export const AuditOutcome = ["SUCCESS", "DENIED", "FAILURE"] as const;
export type AuditOutcome = (typeof AuditOutcome)[number];

export const IdempotencyState = ["IN_PROGRESS", "COMPLETED"] as const;
export type IdempotencyState = (typeof IdempotencyState)[number];

export const AuditAction = ["LOGIN_SUCCESS", "LOGIN_FAILURE", "LOGOUT", "PATIENT_CREATED", "PATIENT_VIEWED", "PATIENT_UPDATED", "PATIENT_ARCHIVED", "PHOTO_CAPTURED", "PHOTO_VIEWED", "PHOTO_EXPORTED", "PHOTO_PERMISSION_CHANGED", "CONSULTATION_CREATED", "CONSULTATION_COMPLETED", "SIMULATION_GENERATED", "SIMULATION_VIEWED", "SIMULATION_APPROVED", "SIMULATION_REJECTED", "SIMULATION_REGENERATED", "SIMULATION_RELEASED", "CONSENT_ASSIGNED", "CONSENT_VIEWED", "CONSENT_SIGNED", "CONSENT_COMPLETED", "CONSENT_VOIDED", "MESSAGE_SENT", "ATTACHMENT_DOWNLOADED", "USER_CREATED", "USER_UPDATED", "USER_DISABLED", "ROLE_ASSIGNED", "INTEGRATION_SYNC_STARTED", "INTEGRATION_SYNC_SUCCEEDED", "INTEGRATION_SYNC_FAILED", "DATA_EXPORT_REQUESTED", "DATA_EXPORT_COMPLETED", "SECURITY_SESSION_REVOKED", "SIMULATION_CREATED", "SIMULATION_STATUS_CHANGED", "CONSENT_STATUS_CHANGED", "DOCUMENT_VIEWED", "ACCESS_DENIED", "ROLE_REVOKED", "PATIENT_ACCOUNT_LINKED", "CONSULTATION_STATUS_CHANGED", "PHOTO_ANNOTATED", "PHOTO_INTAKE_REVIEWED", "PHOTO_REJECTED", "PHOTO_ARCHIVED", "BEFORE_AFTER_CREATED", "MEDIA_RELEASED", "MEDIA_RELEASE_REVOKED", "SIMILAR_CASES_SHOWN", "AI_MODEL_ROLLOUT_CHANGED", "TREATMENT_PLAN_STATUS_CHANGED", "CONSENT_TEMPLATE_PUBLISHED", "DOCUMENT_RELEASED", "CONTENT_ASSIGNED", "INSTRUCTION_ASSIGNED", "INSTRUCTION_ACKNOWLEDGED", "APPOINTMENT_STATUS_CHANGED", "TELEHEALTH_STATUS_CHANGED", "INTEGRATION_CONFIG_CHANGED", "DATA_EXPORT_DOWNLOADED", "CONFIGURATION_CHANGED", "SECURITY_CREDENTIAL_CHANGED", "ORGANIZATION_SWITCHED", "CONSULTATION_NOTE_FINALIZED", "DOCUMENT_ADDED", "PROCEDURE_STATUS_CHANGED"] as const;
export type AuditAction = (typeof AuditAction)[number];

export const EstimateStatus = ["DRAFT", "ISSUED", "SUPERSEDED", "VOID"] as const;
export type EstimateStatus = (typeof EstimateStatus)[number];

export const RetentionRecordCategory = ["CLINICAL_PHOTO", "CLINICAL_RECORD", "CONSENT_DOCUMENT", "MESSAGE", "AUDIT_EVENT", "LOGIN_EVENT", "AI_ARTIFACT", "DATA_EXPORT", "TELEHEALTH_METADATA", "INTEGRATION_PAYLOAD"] as const;
export type RetentionRecordCategory = (typeof RetentionRecordCategory)[number];

export const RetentionAction = ["ARCHIVE", "DELETE", "REVIEW"] as const;
export type RetentionAction = (typeof RetentionAction)[number];

export const DataExportPurpose = ["PATIENT_REQUEST", "TRANSFER_OF_CARE", "LEGAL_REQUEST", "OTHER"] as const;
export type DataExportPurpose = (typeof DataExportPurpose)[number];

export const ExportJobStatus = ["REQUESTED", "RUNNING", "COMPLETED", "FAILED", "EXPIRED", "CANCELLED"] as const;
export type ExportJobStatus = (typeof ExportJobStatus)[number];
