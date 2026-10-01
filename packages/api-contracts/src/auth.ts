// Authentication and session contracts (spec §4.2, §6.3 "Auth & session";
// AUTHENTICATION_ARCHITECTURE.md; ADR-0018 K-09 to K-15; ADR-0021).
// Secrets travel only in request bodies, never in a path or query string.
import { ClientApp as ClientAppValues, CredentialType } from "@aestara/shared-types";
import { Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

export const Email = z.email().max(254).meta({ description: "Email address; compared case-insensitively." });

export const ClientApp = z.enum(ClientAppValues).meta({
  id: "ClientApp",
  description:
    "The client signing in. It decides session lifetimes and the MFA rule (ADMIN_WEB always needs MFA).",
});

export const DeviceInfo = z
  .strictObject({
    installationId: Uuid.meta({
      description: "Per-install identifier kept in the Keychain; only its hash is stored.",
    }),
    name: z.string().max(100).optional(),
    model: z.string().max(100).optional(),
    osVersion: z.string().max(40).optional(),
    appVersion: z.string().max(40).optional(),
  })
  .meta({ id: "DeviceInfo", description: "The app install signing in. Required for the iOS apps." });

export const TotpCode = z
  .string()
  .regex(/^\d{6}$/, "Must be the 6-digit code from the authenticator app.")
  .meta({ example: "492039" });

/** A WebAuthn JSON payload produced by the platform (navigator.credentials / AuthenticationServices). */
export const WebAuthnJson = z
  .looseObject({ id: z.string().min(1), type: z.literal("public-key") })
  .meta({ id: "WebAuthnJson", description: "A WebAuthn registration or authentication response, as JSON." });

export const LoginRequest = z
  .strictObject({
    email: Email,
    password: z.string().min(1).max(1024),
    clientApp: ClientApp,
    device: DeviceInfo.optional(),
    organizationId: Uuid.optional().meta({
      description: "Optional choice among the caller's active memberships; verified, never trusted.",
    }),
  })
  .meta({ id: "LoginRequest" });

export const SecondFactorType = z.enum(
  CredentialType.filter((t) => t !== "PASSWORD") as ["TOTP", "WEBAUTHN"],
);

export const Factor = z
  .strictObject({
    id: Uuid,
    type: SecondFactorType,
    label: z.string().optional(),
    confirmed: z.boolean(),
    createdAt: Timestamp,
    lastUsedAt: Timestamp.optional(),
  })
  .meta({ id: "Factor", description: "A second factor of the signed-in user. Secrets are never returned." });

export const Membership = z
  .strictObject({
    organizationId: Uuid,
    organizationName: z.string(),
    status: z.enum(["INVITED", "ACTIVE", "DISABLED"]),
  })
  .meta({ id: "MembershipSummary" });

export const SessionInfo = z
  .strictObject({
    sessionId: Uuid,
    clientApp: ClientApp,
    user: z.strictObject({ id: Uuid, email: Email, displayName: z.string().optional() }),
    organization: z.strictObject({ id: Uuid, name: z.string(), slug: z.string() }).optional(),
    memberships: z.array(Membership),
    permissions: z.array(z.string()).meta({
      description: "Effective permissions in the active organization. UI hints only; the server enforces.",
    }),
    platformPermissions: z.array(z.string()).meta({ description: "Permissions held at platform scope." }),
    factors: z.array(Factor),
    mfaVerifiedAt: Timestamp.optional(),
    idleExpiresAt: Timestamp,
    absoluteExpiresAt: Timestamp,
  })
  .meta({ id: "SessionInfo" });

export const AuthTokens = z
  .strictObject({
    accessToken: z.string().meta({ description: "ES256 JWT, 10 minutes. Keep in memory only." }),
    accessTokenExpiresAt: Timestamp,
    refreshToken: z.string().optional().meta({
      description: "iOS apps only: store in the Keychain. The admin web receives it as an HttpOnly cookie.",
    }),
    session: SessionInfo,
  })
  .meta({ id: "AuthTokens" });

/** `error.details` of `401 MFA_REQUIRED`. */
export const MfaChallengeDetails = z
  .strictObject({
    challengeToken: z
      .string()
      .meta({ description: "Send back in the body of /auth/mfa/verify. Valid 5 minutes." }),
    expiresAt: Timestamp,
    factors: z.array(SecondFactorType).meta({ description: "Confirmed factors the user can answer with." }),
    enrollmentRequired: z.boolean().meta({
      description:
        "True when MFA is required but no factor is confirmed: enroll TOTP with the challenge first.",
    }),
    webauthnOptions: z
      .looseObject({})
      .optional()
      .meta({ description: "Passkey assertion options, when relevant." }),
  })
  .meta({ id: "MfaChallengeDetails" });

export const MfaVerifyRequest = z
  .strictObject({
    challengeToken: z.string().min(1).max(200),
    totpCode: TotpCode.optional(),
    webauthnResponse: WebAuthnJson.optional(),
    device: DeviceInfo.optional().meta({
      description: "The same device as in the login request (iOS apps).",
    }),
    organizationId: Uuid.optional().meta({ description: "As in the login request; verified again." }),
  })
  .refine((r) => (r.totpCode === undefined) !== (r.webauthnResponse === undefined), {
    message: "Send exactly one of totpCode or webauthnResponse.",
    path: ["totpCode"],
  })
  .meta({ id: "MfaVerifyRequest" });

export const RefreshRequest = z
  .strictObject({
    refreshToken: z.string().min(1).max(400).optional().meta({
      description: "iOS apps. The admin web sends no body; its refresh token comes from the cookie.",
    }),
  })
  .meta({ id: "RefreshRequest" });

export const SwitchOrganizationRequest = z
  .strictObject({ organizationId: Uuid })
  .meta({ id: "SwitchOrganizationRequest" });

export const AccessTokenResult = z
  .strictObject({ accessToken: z.string(), accessTokenExpiresAt: Timestamp, session: SessionInfo })
  .meta({ id: "AccessTokenResult" });

export const SessionListItem = z
  .strictObject({
    id: Uuid,
    clientApp: ClientApp,
    organizationId: Uuid.optional(),
    device: z.strictObject({ name: z.string().optional(), model: z.string().optional() }).optional(),
    createdAt: Timestamp,
    lastUsedAt: Timestamp.optional(),
    current: z.boolean(),
  })
  .meta({ id: "SessionListItem" });

/** NIST SP 800-63B: length only; the server also rejects common and breached passwords (ADR-0018 K-15). */
export const NewPassword = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Use at most 128 characters.")
  .meta({ description: "At least 12 characters. Common and breached passwords are rejected." });

export const PasswordForgotRequest = z.strictObject({ email: Email }).meta({ id: "PasswordForgotRequest" });

export const PasswordResetRequest = z
  .strictObject({ token: z.string().min(1).max(200), newPassword: NewPassword })
  .meta({ id: "PasswordResetRequest" });

export const PasswordChangeRequest = z
  .strictObject({ currentPassword: z.string().min(1).max(1024), newPassword: NewPassword })
  .meta({ id: "PasswordChangeRequest" });

export const InvitationAcceptRequest = z
  .strictObject({
    token: z.string().min(1).max(200),
    password: z.string().min(1).max(1024).meta({
      description: "The new password; or, for a user who already has one, the current password.",
    }),
    displayName: z.string().min(1).max(100).optional(),
  })
  .meta({ id: "InvitationAcceptRequest" });

export const MfaEnrollmentRequest = z
  .strictObject({
    type: SecondFactorType,
    label: z.string().min(1).max(60).optional(),
    challengeToken: z.string().min(1).max(200).optional().meta({
      description: "During sign-in only, when MFA_REQUIRED said enrollmentRequired (TOTP only).",
    }),
  })
  .meta({ id: "MfaEnrollmentRequest" });

export const MfaEnrollment = z
  .strictObject({
    id: Uuid,
    type: SecondFactorType,
    totp: z
      .strictObject({
        secret: z.string().meta({ description: "Base32 secret; shown once." }),
        otpauthUri: z.string().meta({ description: "otpauth:// URI for a QR code." }),
      })
      .optional(),
    webauthnOptions: z.looseObject({}).optional().meta({ description: "Passkey registration options." }),
  })
  .meta({ id: "MfaEnrollment" });

export const MfaEnrollmentConfirmRequest = z
  .strictObject({
    totpCode: TotpCode.optional(),
    webauthnResponse: WebAuthnJson.optional(),
    challengeToken: z.string().min(1).max(200).optional().meta({
      description: "During sign-in only, with the challenge used to start the enrollment.",
    }),
  })
  .refine((r) => (r.totpCode === undefined) !== (r.webauthnResponse === undefined), {
    message: "Send exactly one of totpCode or webauthnResponse.",
    path: ["totpCode"],
  })
  .meta({ id: "MfaEnrollmentConfirmRequest" });

export const Jwks = z
  .strictObject({ keys: z.array(z.looseObject({ kty: z.string(), kid: z.string() })) })
  .meta({ id: "Jwks", description: "JSON Web Key Set of the access-token signing keys." });
