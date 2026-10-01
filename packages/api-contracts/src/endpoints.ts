// The Layer 1 endpoint registry (spec §6.3, §6.4). One entry per operation:
// it drives the OpenAPI paths, the api's route table check, the contract tests
// (permission, envelope, idempotency, If-Match) and the generated cross-tenant
// tests (spec §6.8). Paths are relative to /api/v1 and use OpenAPI `{param}`.

import { AuditEvent, AuditEventQuery } from "./audit.ts";
import {
  AccessTokenResult,
  AuthTokens,
  InvitationAcceptRequest,
  Jwks,
  LoginRequest,
  MfaEnrollment,
  MfaEnrollmentConfirmRequest,
  MfaEnrollmentRequest,
  MfaVerifyRequest,
  PasswordChangeRequest,
  PasswordForgotRequest,
  PasswordResetRequest,
  RefreshRequest,
  SessionInfo,
  SessionListItem,
  SwitchOrganizationRequest,
} from "./auth.ts";
import {
  AdminBootstrapResult,
  FirstAdmin,
  Location,
  LocationCreate,
  LocationListQuery,
  LocationUpdate,
  Organization,
  OrganizationCreate,
  OrganizationCreated,
  OrganizationUpdate,
  Practice,
  PracticeCreate,
  PracticeUpdate,
} from "./organizations.ts";
import { PageQuery } from "./pagination.ts";
import {
  DuplicateCheckRequest,
  DuplicateCheckResult,
  Patient,
  PatientContact,
  PatientContactCreate,
  PatientContactUpdate,
  PatientCreate,
  PatientListQuery,
  PatientProfile,
  PatientSearchRequest,
  PatientSummary,
  PatientUpdate,
} from "./patients.ts";
import { Uuid } from "./primitives.ts";
import {
  HealthStatus,
  OrganizationSetting,
  OrganizationSettingKeySchema,
  OrganizationSettingPut,
} from "./settings.ts";
import {
  MfaResetRequest,
  MfaResetResult,
  PermissionInfo,
  ProviderProfile,
  ProviderProfilePut,
  Role,
  RoleAssignment,
  RoleAssignmentCreate,
  SessionsRevokeResult,
  StaffProfile,
  StaffProfilePut,
  StaffUser,
  UserCreate,
  UserListQuery,
  UserUpdate,
} from "./users.ts";
import { z } from "./zod.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Where a permission is evaluated (spec §4.6). */
export type PermissionScope = "organization" | "platform";

export type EndpointAuth =
  /** No credentials (login, reset, health, JWKS). */
  | { readonly kind: "public" }
  /** A token in the body proves the caller: an MFA challenge, refresh, invitation or reset token. */
  | {
      readonly kind: "token";
      readonly token: "challenge" | "refresh" | "invitation" | "reset" | "challenge-or-session";
    }
  /** Any valid session; the operation only touches the caller's own account. */
  | { readonly kind: "session" }
  /** A permission, evaluated per request from the caller's grants (never from the token). */
  | { readonly kind: "permission"; readonly permission: string; readonly scopes: readonly PermissionScope[] };

export type ResponseShape = "resource" | "collection" | "none" | "bare";

export interface EndpointDefinition {
  readonly operationId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly tag: "Auth" | "Organizations" | "Users" | "Roles" | "Patients" | "Audit" | "Settings" | "Health";
  readonly summary: string;
  readonly auth: EndpointAuth;
  /** Needs a recent MFA (ADR-0021 step-up); else 403 REAUTHENTICATION_REQUIRED. */
  readonly stepUp?: boolean;
  readonly params?: z.ZodObject;
  readonly query?: z.ZodObject;
  readonly body?: z.ZodType;
  readonly response: {
    readonly status: 200 | 201 | 202 | 204;
    readonly shape: ResponseShape;
    readonly schema?: z.ZodType;
    /** Returns `ETag: "v{version}"`. */
    readonly etag?: boolean;
  };
  /** `Idempotency-Key` required (spec §6.1.8). */
  readonly idempotency?: "required";
  /** `If-Match` required (spec §6.1.7); "when-exists" for create-or-replace PUTs. */
  readonly ifMatch?: "required" | "when-exists";
  /** Code returned for an absent, other-tenant or out-of-scope path resource (spec §6.1.10). */
  readonly notFound?: `${string}_NOT_FOUND`;
  /** Audit actions the operation can write. */
  readonly audit?: readonly string[];
  /** Touches patient data: denials are audited as ACCESS_DENIED (ADR-0018 K-10). */
  readonly patientData?: boolean;
  /** Extra error statuses beyond the ones implied by auth, params and headers. */
  readonly errors?: readonly number[];
}

const IdParam = z.strictObject({ id: Uuid });
const PatientParam = z.strictObject({ patientId: Uuid });
const ContactParams = z.strictObject({ patientId: Uuid, contactId: Uuid });
const AssignmentParams = z.strictObject({ id: Uuid, assignmentId: Uuid });
const SettingParam = z.strictObject({ key: z.string().min(1).max(100) });

const perm = (permission: string, ...scopes: PermissionScope[]): EndpointAuth => ({
  kind: "permission",
  permission,
  scopes: scopes.length > 0 ? scopes : ["organization"],
});
const SESSION: EndpointAuth = { kind: "session" };
const PUBLIC: EndpointAuth = { kind: "public" };

export const ENDPOINTS = [
  // ---- Auth & session -------------------------------------------------------
  {
    operationId: "login",
    method: "POST",
    path: "/auth/login",
    tag: "Auth",
    summary: "Sign in with email and password. 401 MFA_REQUIRED carries a challenge in error.details.",
    auth: PUBLIC,
    body: LoginRequest,
    response: { status: 200, shape: "resource", schema: AuthTokens },
    audit: ["LOGIN_SUCCESS", "LOGIN_FAILURE"],
    errors: [401, 429],
  },
  {
    operationId: "verifyMfa",
    method: "POST",
    path: "/auth/mfa/verify",
    tag: "Auth",
    summary: "Complete a sign-in MFA challenge with a TOTP code or a passkey assertion.",
    auth: { kind: "token", token: "challenge" },
    body: MfaVerifyRequest,
    response: { status: 200, shape: "resource", schema: AuthTokens },
    audit: ["LOGIN_SUCCESS", "LOGIN_FAILURE"],
    errors: [401, 429],
  },
  {
    operationId: "refreshToken",
    method: "POST",
    path: "/auth/token/refresh",
    tag: "Auth",
    summary:
      "Rotate the refresh token. The admin web sends no body: the cookie carries it and Origin is checked.",
    auth: { kind: "token", token: "refresh" },
    body: RefreshRequest,
    response: { status: 200, shape: "resource", schema: AuthTokens },
    audit: ["SECURITY_SESSION_REVOKED"],
    errors: [401, 403],
  },
  {
    operationId: "logout",
    method: "POST",
    path: "/auth/logout",
    tag: "Auth",
    summary: "Revoke the current session.",
    auth: SESSION,
    response: { status: 204, shape: "none" },
    audit: ["LOGOUT"],
  },
  {
    operationId: "getSession",
    method: "GET",
    path: "/auth/session",
    tag: "Auth",
    summary:
      "The signed-in user, active organization, memberships and effective permissions (UI hints only).",
    auth: SESSION,
    response: { status: 200, shape: "resource", schema: SessionInfo },
  },
  {
    operationId: "switchOrganization",
    method: "PUT",
    path: "/auth/session/organization",
    tag: "Auth",
    summary: "Bind the session to another active membership and issue new tokens.",
    auth: SESSION,
    body: SwitchOrganizationRequest,
    response: { status: 200, shape: "resource", schema: AccessTokenResult },
    audit: ["ORGANIZATION_SWITCHED"],
    errors: [403, 404],
    notFound: "ORGANIZATION_NOT_FOUND",
  },
  {
    operationId: "listOwnSessions",
    method: "GET",
    path: "/auth/sessions",
    tag: "Auth",
    summary: "The caller's active sessions and devices.",
    auth: SESSION,
    query: PageQuery,
    response: { status: 200, shape: "collection", schema: SessionListItem },
  },
  {
    operationId: "revokeOwnSession",
    method: "DELETE",
    path: "/auth/sessions/{id}",
    tag: "Auth",
    summary: "Revoke one of the caller's sessions.",
    auth: SESSION,
    params: IdParam,
    response: { status: 204, shape: "none" },
    notFound: "SESSION_NOT_FOUND",
    audit: ["SECURITY_SESSION_REVOKED"],
  },
  {
    operationId: "forgotPassword",
    method: "POST",
    path: "/auth/password/forgot",
    tag: "Auth",
    summary: "Email a reset link if the account exists. The response is identical either way.",
    auth: PUBLIC,
    body: PasswordForgotRequest,
    response: { status: 202, shape: "none" },
    errors: [429],
  },
  {
    operationId: "resetPassword",
    method: "POST",
    path: "/auth/password/reset",
    tag: "Auth",
    summary: "Set a new password with the emailed token. Revokes every session of the user.",
    auth: { kind: "token", token: "reset" },
    body: PasswordResetRequest,
    response: { status: 204, shape: "none" },
    audit: ["SECURITY_CREDENTIAL_CHANGED", "SECURITY_SESSION_REVOKED"],
    errors: [401],
  },
  {
    operationId: "changePassword",
    method: "POST",
    path: "/auth/password/change",
    tag: "Auth",
    summary: "Change the password (current password and a recent MFA). Ends the user's other sessions.",
    auth: SESSION,
    stepUp: true,
    body: PasswordChangeRequest,
    response: { status: 204, shape: "none" },
    audit: ["SECURITY_CREDENTIAL_CHANGED", "SECURITY_SESSION_REVOKED"],
    errors: [403],
  },
  {
    operationId: "acceptInvitation",
    method: "POST",
    path: "/auth/invitations/accept",
    tag: "Auth",
    summary:
      "Accept a staff invitation: set the password (or prove the current one) and activate the membership.",
    auth: { kind: "token", token: "invitation" },
    body: InvitationAcceptRequest,
    response: { status: 204, shape: "none" },
    audit: ["SECURITY_CREDENTIAL_CHANGED", "USER_UPDATED"],
    errors: [401],
  },
  {
    operationId: "createMfaEnrollment",
    method: "POST",
    path: "/auth/mfa/enrollments",
    tag: "Auth",
    summary:
      "Start enrolling a TOTP or passkey factor. During sign-in, TOTP may be enrolled with the challenge.",
    auth: { kind: "token", token: "challenge-or-session" },
    stepUp: true,
    body: MfaEnrollmentRequest,
    idempotency: "required",
    response: { status: 201, shape: "resource", schema: MfaEnrollment },
    errors: [403],
  },
  {
    operationId: "confirmMfaEnrollment",
    method: "POST",
    path: "/auth/mfa/enrollments/{id}/confirm",
    tag: "Auth",
    summary: "Confirm a pending factor with a TOTP code or the passkey registration.",
    auth: { kind: "token", token: "challenge-or-session" },
    stepUp: true,
    params: IdParam,
    body: MfaEnrollmentConfirmRequest,
    response: { status: 204, shape: "none" },
    notFound: "FACTOR_NOT_FOUND",
    audit: ["SECURITY_CREDENTIAL_CHANGED"],
    errors: [403],
  },
  {
    operationId: "deleteMfaEnrollment",
    method: "DELETE",
    path: "/auth/mfa/enrollments/{id}",
    tag: "Auth",
    summary: "Remove one of the caller's second factors. The last factor of a user who must use MFA stays.",
    auth: SESSION,
    stepUp: true,
    params: IdParam,
    response: { status: 204, shape: "none" },
    notFound: "FACTOR_NOT_FOUND",
    audit: ["SECURITY_CREDENTIAL_CHANGED"],
    errors: [403, 409],
  },
  {
    operationId: "getJwks",
    method: "GET",
    path: "/.well-known/jwks.json",
    tag: "Auth",
    summary: "Public keys that verify access tokens.",
    auth: PUBLIC,
    response: { status: 200, shape: "bare", schema: Jwks },
  },

  // ---- Organizations, practices, locations ---------------------------------
  {
    operationId: "listOrganizations",
    method: "GET",
    path: "/organizations",
    tag: "Organizations",
    summary: "List organizations (platform scope).",
    auth: perm("organization.read", "platform"),
    query: PageQuery,
    response: { status: 200, shape: "collection", schema: Organization },
  },
  {
    operationId: "createOrganization",
    method: "POST",
    path: "/organizations",
    tag: "Organizations",
    summary: "Create an organization and invite its first ORGANIZATION_ADMIN (platform scope).",
    auth: perm("organization.manage", "platform"),
    body: OrganizationCreate,
    idempotency: "required",
    response: { status: 201, shape: "resource", schema: OrganizationCreated, etag: true },
    audit: ["CONFIGURATION_CHANGED", "USER_CREATED", "ROLE_ASSIGNED"],
    errors: [409],
  },
  {
    operationId: "getOrganization",
    method: "GET",
    path: "/organizations/{id}",
    tag: "Organizations",
    summary: "View the caller's organization, or any organization at platform scope.",
    auth: perm("organization.read", "organization", "platform"),
    params: IdParam,
    response: { status: 200, shape: "resource", schema: Organization, etag: true },
    notFound: "ORGANIZATION_NOT_FOUND",
  },
  {
    operationId: "updateOrganization",
    method: "PATCH",
    path: "/organizations/{id}",
    tag: "Organizations",
    summary: "Rename the caller's organization; change any organization's status at platform scope.",
    auth: perm("organization.manage", "organization", "platform"),
    params: IdParam,
    body: OrganizationUpdate,
    ifMatch: "required",
    response: { status: 200, shape: "resource", schema: Organization, etag: true },
    notFound: "ORGANIZATION_NOT_FOUND",
    audit: ["CONFIGURATION_CHANGED"],
  },
  {
    operationId: "bootstrapOrganizationAdmin",
    method: "POST",
    path: "/organizations/{id}/admin-bootstrap",
    tag: "Organizations",
    summary:
      "Invite the first ORGANIZATION_ADMIN of an organization that has no active one (platform scope).",
    auth: perm("organization.manage", "platform"),
    params: IdParam,
    body: FirstAdmin,
    idempotency: "required",
    response: { status: 201, shape: "resource", schema: AdminBootstrapResult },
    notFound: "ORGANIZATION_NOT_FOUND",
    audit: ["USER_CREATED", "ROLE_ASSIGNED"],
    errors: [403, 409],
  },
  {
    operationId: "listPractices",
    method: "GET",
    path: "/practices",
    tag: "Organizations",
    summary: "Practices of the organization.",
    auth: perm("practice.read"),
    query: PageQuery,
    response: { status: 200, shape: "collection", schema: Practice },
  },
  {
    operationId: "createPractice",
    method: "POST",
    path: "/practices",
    tag: "Organizations",
    summary: "Create a practice (organization-scope grant).",
    auth: perm("practice.manage"),
    body: PracticeCreate,
    response: { status: 201, shape: "resource", schema: Practice, etag: true },
    audit: ["CONFIGURATION_CHANGED"],
    errors: [409],
  },
  {
    operationId: "getPractice",
    method: "GET",
    path: "/practices/{id}",
    tag: "Organizations",
    summary: "View a practice.",
    auth: perm("practice.read"),
    params: IdParam,
    response: { status: 200, shape: "resource", schema: Practice, etag: true },
    notFound: "PRACTICE_NOT_FOUND",
  },
  {
    operationId: "updatePractice",
    method: "PATCH",
    path: "/practices/{id}",
    tag: "Organizations",
    summary: "Update a practice within the caller's scope.",
    auth: perm("practice.manage"),
    params: IdParam,
    body: PracticeUpdate,
    ifMatch: "required",
    response: { status: 200, shape: "resource", schema: Practice, etag: true },
    notFound: "PRACTICE_NOT_FOUND",
    audit: ["CONFIGURATION_CHANGED"],
    errors: [409],
  },
  {
    operationId: "listLocations",
    method: "GET",
    path: "/locations",
    tag: "Organizations",
    summary: "Locations of the organization's practices.",
    auth: perm("practice.read"),
    query: LocationListQuery,
    response: { status: 200, shape: "collection", schema: Location },
  },
  {
    operationId: "createLocation",
    method: "POST",
    path: "/locations",
    tag: "Organizations",
    summary: "Create a location in a practice within the caller's scope.",
    auth: perm("practice.manage"),
    body: LocationCreate,
    response: { status: 201, shape: "resource", schema: Location, etag: true },
    audit: ["CONFIGURATION_CHANGED"],
    errors: [409, 404],
  },
  {
    operationId: "getLocation",
    method: "GET",
    path: "/locations/{id}",
    tag: "Organizations",
    summary: "View a location.",
    auth: perm("practice.read"),
    params: IdParam,
    response: { status: 200, shape: "resource", schema: Location, etag: true },
    notFound: "LOCATION_NOT_FOUND",
  },
  {
    operationId: "updateLocation",
    method: "PATCH",
    path: "/locations/{id}",
    tag: "Organizations",
    summary: "Update a location within the caller's scope.",
    auth: perm("practice.manage"),
    params: IdParam,
    body: LocationUpdate,
    ifMatch: "required",
    response: { status: 200, shape: "resource", schema: Location, etag: true },
    notFound: "LOCATION_NOT_FOUND",
    audit: ["CONFIGURATION_CHANGED"],
    errors: [409],
  },

  // ---- Users, roles, permissions --------------------------------------------
  {
    operationId: "listUsers",
    method: "GET",
    path: "/users",
    tag: "Users",
    summary: "Members of the organization (filter by status, practice, role).",
    auth: perm("user.read"),
    query: UserListQuery,
    response: { status: 200, shape: "collection", schema: StaffUser },
  },
  {
    operationId: "createUser",
    method: "POST",
    path: "/users",
    tag: "Users",
    summary: "Invite a person to the organization, optionally with role assignments.",
    auth: perm("user.create"),
    body: UserCreate,
    idempotency: "required",
    response: { status: 201, shape: "resource", schema: StaffUser, etag: true },
    audit: ["USER_CREATED", "ROLE_ASSIGNED"],
    errors: [409],
  },
  {
    operationId: "getUser",
    method: "GET",
    path: "/users/{id}",
    tag: "Users",
    summary: "View a member.",
    auth: perm("user.read"),
    params: IdParam,
    response: { status: 200, shape: "resource", schema: StaffUser, etag: true },
    notFound: "USER_NOT_FOUND",
  },
  {
    operationId: "updateUser",
    method: "PATCH",
    path: "/users/{id}",
    tag: "Users",
    summary: "Update a member's name or phone.",
    auth: perm("user.update"),
    params: IdParam,
    body: UserUpdate,
    ifMatch: "required",
    response: { status: 200, shape: "resource", schema: StaffUser, etag: true },
    notFound: "USER_NOT_FOUND",
    audit: ["USER_UPDATED"],
  },
  {
    operationId: "disableUser",
    method: "POST",
    path: "/users/{id}/disable",
    tag: "Users",
    summary: "Disable the membership and revoke the user's sessions in this organization.",
    auth: perm("user.disable"),
    params: IdParam,
    response: { status: 200, shape: "resource", schema: StaffUser, etag: true },
    notFound: "USER_NOT_FOUND",
    audit: ["USER_DISABLED", "SECURITY_SESSION_REVOKED"],
    errors: [409],
  },
  {
    operationId: "createRoleAssignment",
    method: "POST",
    path: "/users/{id}/role-assignments",
    tag: "Users",
    summary: "Assign a role at a scope (never to oneself, never beyond one's own scope).",
    auth: perm("role.assign"),
    params: IdParam,
    body: RoleAssignmentCreate,
    response: { status: 201, shape: "resource", schema: RoleAssignment },
    notFound: "USER_NOT_FOUND",
    audit: ["ROLE_ASSIGNED"],
    errors: [409],
  },
  {
    operationId: "revokeRoleAssignment",
    method: "DELETE",
    path: "/users/{id}/role-assignments/{assignmentId}",
    tag: "Users",
    summary: "Revoke a role assignment.",
    auth: perm("role.assign"),
    params: AssignmentParams,
    response: { status: 204, shape: "none" },
    notFound: "ROLE_ASSIGNMENT_NOT_FOUND",
    audit: ["ROLE_REVOKED"],
  },
  {
    operationId: "getProviderProfile",
    method: "GET",
    path: "/users/{id}/provider-profile",
    tag: "Users",
    summary: "The member's provider profile.",
    auth: perm("user.read"),
    params: IdParam,
    response: { status: 200, shape: "resource", schema: ProviderProfile, etag: true },
    notFound: "PROVIDER_PROFILE_NOT_FOUND",
  },
  {
    operationId: "putProviderProfile",
    method: "PUT",
    path: "/users/{id}/provider-profile",
    tag: "Users",
    summary: "Create or replace the provider profile (If-Match once it exists).",
    auth: perm("user.update"),
    params: IdParam,
    body: ProviderProfilePut,
    ifMatch: "when-exists",
    response: { status: 200, shape: "resource", schema: ProviderProfile, etag: true },
    notFound: "USER_NOT_FOUND",
    audit: ["USER_UPDATED"],
  },
  {
    operationId: "getStaffProfile",
    method: "GET",
    path: "/users/{id}/staff-profile",
    tag: "Users",
    summary: "The member's staff profile.",
    auth: perm("user.read"),
    params: IdParam,
    response: { status: 200, shape: "resource", schema: StaffProfile, etag: true },
    notFound: "STAFF_PROFILE_NOT_FOUND",
  },
  {
    operationId: "putStaffProfile",
    method: "PUT",
    path: "/users/{id}/staff-profile",
    tag: "Users",
    summary: "Create or replace the staff profile (If-Match once it exists).",
    auth: perm("user.update"),
    params: IdParam,
    body: StaffProfilePut,
    ifMatch: "when-exists",
    response: { status: 200, shape: "resource", schema: StaffProfile, etag: true },
    notFound: "USER_NOT_FOUND",
    audit: ["USER_UPDATED"],
  },
  {
    operationId: "revokeUserSessions",
    method: "POST",
    path: "/users/{id}/sessions/revoke",
    tag: "Users",
    summary: "Revoke the user's sessions bound to this organization; at platform scope, all of them.",
    auth: perm("security.manage", "organization", "platform"),
    params: IdParam,
    response: { status: 200, shape: "resource", schema: SessionsRevokeResult },
    notFound: "USER_NOT_FOUND",
    audit: ["SECURITY_SESSION_REVOKED"],
  },
  {
    operationId: "resetUserMfa",
    method: "POST",
    path: "/users/{id}/mfa-reset",
    tag: "Users",
    summary: "Remove every second factor of a user who lost them, and revoke all their sessions.",
    auth: perm("security.manage", "organization", "platform"),
    stepUp: true,
    params: IdParam,
    body: MfaResetRequest,
    response: { status: 200, shape: "resource", schema: MfaResetResult },
    notFound: "USER_NOT_FOUND",
    audit: ["SECURITY_CREDENTIAL_CHANGED", "SECURITY_SESSION_REVOKED"],
  },
  {
    operationId: "listRoles",
    method: "GET",
    path: "/roles",
    tag: "Roles",
    summary: "Roles and their permissions.",
    auth: perm("role.read", "organization", "platform"),
    query: PageQuery,
    response: { status: 200, shape: "collection", schema: Role },
  },
  {
    operationId: "getRole",
    method: "GET",
    path: "/roles/{id}",
    tag: "Roles",
    summary: "One role and its permissions.",
    auth: perm("role.read", "organization", "platform"),
    params: IdParam,
    response: { status: 200, shape: "resource", schema: Role },
    notFound: "ROLE_NOT_FOUND",
  },
  {
    operationId: "listPermissions",
    method: "GET",
    path: "/permissions",
    tag: "Roles",
    summary: "The permission catalog.",
    auth: perm("role.read", "organization", "platform"),
    query: PageQuery,
    response: { status: 200, shape: "collection", schema: PermissionInfo },
  },

  // ---- Patients --------------------------------------------------------------
  {
    operationId: "searchPatients",
    method: "POST",
    path: "/patients/search",
    tag: "Patients",
    summary:
      "Search by a name prefix or an exact date of birth, MRN, email or phone. Terms travel in the body.",
    auth: perm("patient.read"),
    body: PatientSearchRequest,
    response: { status: 200, shape: "collection", schema: PatientSummary },
    patientData: true,
    errors: [429],
  },
  {
    operationId: "listPatients",
    method: "GET",
    path: "/patients",
    tag: "Patients",
    summary: "Recently updated patients, filtered by status or primary practice. No PHI in the query.",
    auth: perm("patient.read"),
    query: PatientListQuery,
    response: { status: 200, shape: "collection", schema: PatientSummary },
    patientData: true,
  },
  {
    operationId: "checkPatientDuplicates",
    method: "POST",
    path: "/patients/duplicate-check",
    tag: "Patients",
    summary: "Probable duplicates of a patient about to be created.",
    auth: perm("patient.create"),
    body: DuplicateCheckRequest,
    response: { status: 200, shape: "resource", schema: DuplicateCheckResult },
    patientData: true,
  },
  {
    operationId: "createPatient",
    method: "POST",
    path: "/patients",
    tag: "Patients",
    summary: "Create a patient. Probable duplicates need confirmNoDuplicate.",
    auth: perm("patient.create"),
    body: PatientCreate,
    idempotency: "required",
    response: { status: 201, shape: "resource", schema: Patient, etag: true },
    audit: ["PATIENT_CREATED"],
    patientData: true,
    errors: [409],
  },
  {
    operationId: "getPatient",
    method: "GET",
    path: "/patients/{patientId}",
    tag: "Patients",
    summary: "The patient profile: demographics, and which profile tabs the caller may read.",
    auth: perm("patient.read"),
    params: PatientParam,
    response: { status: 200, shape: "resource", schema: PatientProfile, etag: true },
    notFound: "PATIENT_NOT_FOUND",
    audit: ["PATIENT_VIEWED"],
    patientData: true,
  },
  {
    operationId: "updatePatient",
    method: "PATCH",
    path: "/patients/{patientId}",
    tag: "Patients",
    summary: "Update demographics or set status ACTIVE, INACTIVE or DECEASED.",
    auth: perm("patient.update"),
    params: PatientParam,
    body: PatientUpdate,
    ifMatch: "required",
    response: { status: 200, shape: "resource", schema: Patient, etag: true },
    notFound: "PATIENT_NOT_FOUND",
    audit: ["PATIENT_UPDATED"],
    patientData: true,
    errors: [409],
  },
  {
    operationId: "archivePatient",
    method: "POST",
    path: "/patients/{patientId}/archive",
    tag: "Patients",
    summary: "Archive the patient. Records are kept.",
    auth: perm("patient.archive"),
    params: PatientParam,
    ifMatch: "required",
    response: { status: 200, shape: "resource", schema: Patient, etag: true },
    notFound: "PATIENT_NOT_FOUND",
    audit: ["PATIENT_ARCHIVED"],
    patientData: true,
    errors: [409],
  },
  {
    operationId: "listPatientContacts",
    method: "GET",
    path: "/patients/{patientId}/contacts",
    tag: "Patients",
    summary: "The patient's contacts.",
    auth: perm("patient.read"),
    params: PatientParam,
    query: PageQuery,
    response: { status: 200, shape: "collection", schema: PatientContact },
    notFound: "PATIENT_NOT_FOUND",
    patientData: true,
  },
  {
    operationId: "createPatientContact",
    method: "POST",
    path: "/patients/{patientId}/contacts",
    tag: "Patients",
    summary: "Add a contact.",
    auth: perm("patient.update"),
    params: PatientParam,
    body: PatientContactCreate,
    response: { status: 201, shape: "resource", schema: PatientContact, etag: true },
    notFound: "PATIENT_NOT_FOUND",
    audit: ["PATIENT_UPDATED"],
    patientData: true,
    errors: [409],
  },
  {
    operationId: "updatePatientContact",
    method: "PATCH",
    path: "/patients/{patientId}/contacts/{contactId}",
    tag: "Patients",
    summary: "Update a contact.",
    auth: perm("patient.update"),
    params: ContactParams,
    body: PatientContactUpdate,
    ifMatch: "required",
    response: { status: 200, shape: "resource", schema: PatientContact, etag: true },
    notFound: "PATIENT_CONTACT_NOT_FOUND",
    audit: ["PATIENT_UPDATED"],
    patientData: true,
    errors: [409],
  },
  {
    operationId: "deletePatientContact",
    method: "DELETE",
    path: "/patients/{patientId}/contacts/{contactId}",
    tag: "Patients",
    summary: "Remove a contact.",
    auth: perm("patient.update"),
    params: ContactParams,
    response: { status: 204, shape: "none" },
    notFound: "PATIENT_CONTACT_NOT_FOUND",
    audit: ["PATIENT_UPDATED"],
    patientData: true,
  },

  // ---- Audit, settings, health -------------------------------------------------
  {
    operationId: "listAuditEvents",
    method: "GET",
    path: "/audit/events",
    tag: "Audit",
    summary: "Audit events of the organization (platform scope: platform-level events only), newest first.",
    auth: perm("audit.read", "organization", "platform"),
    query: AuditEventQuery,
    response: { status: 200, shape: "collection", schema: AuditEvent },
  },
  {
    operationId: "getAuditEvent",
    method: "GET",
    path: "/audit/events/{id}",
    tag: "Audit",
    summary: "One audit event.",
    auth: perm("audit.read", "organization", "platform"),
    params: IdParam,
    response: { status: 200, shape: "resource", schema: AuditEvent },
    notFound: "AUDIT_EVENT_NOT_FOUND",
  },
  {
    operationId: "getOrganizationSetting",
    method: "GET",
    path: "/settings/organization/{key}",
    tag: "Settings",
    summary: "An organization policy setting, or its default.",
    auth: perm("configuration.manage"),
    params: SettingParam,
    response: { status: 200, shape: "resource", schema: OrganizationSetting, etag: true },
    notFound: "SETTING_NOT_FOUND",
  },
  {
    operationId: "putOrganizationSetting",
    method: "PUT",
    path: "/settings/organization/{key}",
    tag: "Settings",
    summary: 'Set a policy setting. If-Match is required; a setting still at its default has ETag "v0".',
    auth: perm("configuration.manage"),
    params: SettingParam,
    body: OrganizationSettingPut,
    ifMatch: "required",
    response: { status: 200, shape: "resource", schema: OrganizationSetting, etag: true },
    notFound: "SETTING_NOT_FOUND",
    audit: ["CONFIGURATION_CHANGED"],
  },
  {
    operationId: "getLiveness",
    method: "GET",
    path: "/health/live",
    tag: "Health",
    summary: "The process is up. No data and no dependency details.",
    auth: PUBLIC,
    response: { status: 200, shape: "bare", schema: HealthStatus },
  },
  {
    operationId: "getReadiness",
    method: "GET",
    path: "/health/ready",
    tag: "Health",
    summary: "The process can serve requests (database reachable). 503 otherwise.",
    auth: PUBLIC,
    response: { status: 200, shape: "bare", schema: HealthStatus },
    errors: [503],
  },
] as const satisfies readonly EndpointDefinition[];

export type OperationId = (typeof ENDPOINTS)[number]["operationId"];

export function endpoint(operationId: OperationId): EndpointDefinition {
  const found = ENDPOINTS.find((e) => e.operationId === operationId);
  if (found === undefined) throw new Error(`Unknown operation ${operationId}`);
  return found;
}

/** `/patients/{patientId}` → `/patients/:patientId` (Fastify/NestJS form). */
export function routePath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ":$1");
}

/** Every error status an endpoint can return, from its auth, inputs and headers. */
export function errorStatuses(e: EndpointDefinition): number[] {
  const statuses = new Set<number>([400, 500, ...(e.errors ?? [])]);
  if (e.auth.kind !== "public") statuses.add(401);
  if (e.auth.kind === "permission" || e.stepUp) statuses.add(403);
  if (e.params !== undefined || e.notFound !== undefined) statuses.add(404);
  if (e.idempotency !== undefined) statuses.add(409);
  if (e.ifMatch !== undefined) {
    statuses.add(412);
    if (e.ifMatch === "required") statuses.add(428);
  }
  return [...statuses].sort((a, b) => a - b);
}

/** Settings keys accepted in the path, for documentation. */
export const SettingKeyParam = OrganizationSettingKeySchema;
