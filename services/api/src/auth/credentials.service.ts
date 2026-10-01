// Passwords, invitations and second factors (spec §4.2, §6.3; ADR-0018 K-09,
// K-15; ADR-0021). Secrets travel only in request bodies; tokens are stored
// as SHA-256 hashes and are single-use.
import type {
  InvitationAcceptRequest,
  MfaEnrollment,
  MfaEnrollmentConfirmRequest,
  MfaEnrollmentRequest,
  PasswordChangeRequest,
  PasswordForgotRequest,
  PasswordResetRequest,
} from "@aestara/api-contracts";
import { endpoint, NewPassword } from "@aestara/api-contracts";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { type RequestContext, requireAuth, requireTx } from "../common/context.ts";
import { randomToken, sha256Hex } from "../common/crypto.ts";
import { ApiError, notFound, rateLimited } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import { CONFIG, type Config } from "../config.ts";
import { Database, type Tx } from "../db/database.ts";
import { inTenant } from "../db/tenant.ts";
import { EmailService, invitationEmail, passwordChangedEmail, passwordResetEmail } from "../email/email.ts";
import { AuthService } from "./auth.service.ts";
import { SEALER } from "./keys.provider.ts";
import { type SecretSealer } from "./keys.ts";
import { lockState } from "./lockout.ts";
import { hashPassword, passwordProblem, verifyPassword } from "./passwords.ts";
import { mfaRequired, signInView } from "./sign-in.ts";
import { base32Encode, newTotpSecret, otpauthUri, TOTP_STEP_SECONDS, verifyTotp } from "./totp.ts";

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
const WEBAUTHN_REGISTRATION_TTL_MS = 5 * 60 * 1000;
const RESET_EMAIL_INTERVAL_MS = 60 * 1000;
const MAX_FACTORS = 10;

const invalidLink = () => new ApiError("UNAUTHENTICATED", "This link is invalid or has expired.");

function newPasswordError(path: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, {
    fieldErrors: [{ path, code: "WEAK_PASSWORD", message }],
  });
}

@Injectable()
export class CredentialsService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
    private readonly audit: AuditWriter,
    private readonly email: EmailService,
    private readonly idempotency: Idempotency,
    @Inject(SEALER) private readonly sealer: SecretSealer,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("createMfaEnrollment", (ctx, id) => this.replayEnrollment(ctx, id));
  }

  // ---------------------------------------------------------------------------
  // Passwords
  // ---------------------------------------------------------------------------
  async forgot(_ctx: RequestContext, body: z.output<typeof PasswordForgotRequest>): Promise<OperationResult> {
    const email = body.email.trim().toLowerCase();
    const message = await this.db.identity(async (tx) => {
      const user = await tx.user.findUnique({ where: { kind_email: { kind: "WORKFORCE", email } } });
      if (user === null || user.status !== "ACTIVE") return undefined;
      const recent = await tx.userToken.count({
        where: {
          userId: user.id,
          purpose: "PASSWORD_RESET",
          createdAt: { gt: new Date(Date.now() - RESET_EMAIL_INTERVAL_MS) },
        },
      });
      if (recent > 0) return undefined;
      // A new link replaces any earlier one.
      await tx.userToken.updateMany({
        where: { userId: user.id, purpose: "PASSWORD_RESET", consumedAt: null },
        data: { consumedAt: new Date() },
      });
      const token = randomToken();
      await tx.userToken.create({
        data: {
          userId: user.id,
          purpose: "PASSWORD_RESET",
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      return passwordResetEmail(user.email, this.email.link("/reset-password", token));
    });
    // Sent after the response is decided, so the answer and its timing are the same for every input.
    if (message !== undefined) void this.email.send(message);
    return {};
  }

  async reset(ctx: RequestContext, body: z.output<typeof PasswordResetRequest>): Promise<OperationResult> {
    const outcome = await this.db.identity(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; userId: string; expiresAt: Date; consumedAt: Date | null }[]
      >`
        SELECT id, "userId", "expiresAt", "consumedAt" FROM "UserToken"
         WHERE "tokenHash" = ${sha256Hex(body.token)} AND purpose = 'PASSWORD_RESET' FOR UPDATE`;
      const token = rows[0];
      if (token === undefined || token.consumedAt !== null || token.expiresAt <= new Date())
        return invalidLink();
      const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
      if (user.status !== "ACTIVE") return invalidLink();
      const problem = passwordProblem(body.newPassword, { email: user.email });
      if (problem !== undefined) return newPasswordError("newPassword", problem);
      await tx.userToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
      await this.replacePassword(tx, user.id, body.newPassword);
      await this.audit.write(tx, ctx, {
        action: "SECURITY_CREDENTIAL_CHANGED",
        organizationId: null,
        actorUserId: user.id,
        resourceType: "User",
        resourceId: user.id,
        metadata: { change: "PASSWORD_RESET" },
      });
      // A completed reset ends every session of the user (spec §4.2).
      await this.auth.revokeSessions(tx, ctx, { userId: user.id }, "CREDENTIAL_CHANGED", user.id);
      return user.email;
    });
    if (outcome instanceof ApiError) throw outcome;
    void this.email.send(passwordChangedEmail(outcome));
    return {};
  }

  async change(ctx: RequestContext, body: z.output<typeof PasswordChangeRequest>): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const current = await tx.userCredential.findFirst({
      where: { userId: user.id, type: "PASSWORD", revokedAt: null },
    });
    const identifierHash = this.auth.identifierHash(user.email);
    const lock = await lockState(tx, identifierHash, current?.createdAt ?? null);
    if (lock.locked) throw rateLimited(lock.retryAfterSeconds);
    if (
      current?.passwordHash == null ||
      !(await verifyPassword(current.passwordHash, body.currentPassword))
    ) {
      // Counted towards lockout, and committed even though this request fails.
      await this.db.identity((ledger) =>
        this.auth.recordFailure(
          ledger,
          ctx,
          { userId: user.id, identifierHash, app: auth.clientApp },
          "INVALID_CREDENTIALS",
        ),
      );
      throw new ApiError("VALIDATION_FAILED", undefined, {
        fieldErrors: [
          { path: "currentPassword", code: "INCORRECT", message: "The current password is not correct." },
        ],
      });
    }
    const problem = passwordProblem(body.newPassword, { email: user.email });
    if (problem !== undefined) throw newPasswordError("newPassword", problem);
    await this.replacePassword(tx, user.id, body.newPassword);
    await this.audit.write(tx, ctx, {
      action: "SECURITY_CREDENTIAL_CHANGED",
      organizationId: null,
      resourceType: "User",
      resourceId: user.id,
      metadata: { change: "PASSWORD_CHANGED" },
    });
    await this.auth.revokeSessions(
      tx,
      ctx,
      { userId: user.id, exceptId: auth.sessionId },
      "CREDENTIAL_CHANGED",
      user.id,
    );
    void this.email.send(passwordChangedEmail(user.email));
    return {};
  }

  private async replacePassword(tx: Tx, userId: string, password: string): Promise<void> {
    const now = new Date();
    await tx.userCredential.updateMany({
      where: { userId, type: "PASSWORD", revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.userCredential.create({
      data: {
        userId,
        type: "PASSWORD",
        passwordHash: await hashPassword(password),
        confirmedAt: now,
        createdAt: now,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  /** Creates an invitation token in the caller's transaction and returns the email to send after commit. */
  async createInvitation(
    tx: Tx,
    input: {
      userId: string;
      email: string;
      organizationId: string;
      organizationName: string;
      createdById: string | null;
    },
  ) {
    await tx.userToken.updateMany({
      where: {
        userId: input.userId,
        purpose: "INVITATION",
        organizationId: input.organizationId,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await tx.userToken.create({
      data: {
        userId: input.userId,
        purpose: "INVITATION",
        tokenHash: sha256Hex(token),
        organizationId: input.organizationId,
        createdById: input.createdById,
        expiresAt,
      },
    });
    return {
      expiresAt,
      email: invitationEmail(
        input.email,
        input.organizationName,
        this.email.link("/accept-invitation", token),
      ),
    };
  }

  async acceptInvitation(
    ctx: RequestContext,
    body: z.output<typeof InvitationAcceptRequest>,
  ): Promise<OperationResult> {
    const outcome = await this.db.identity(async (tx): Promise<ApiError | undefined> => {
      const rows = await tx.$queryRaw<
        { id: string; userId: string; organizationId: string; expiresAt: Date; consumedAt: Date | null }[]
      >`SELECT id, "userId", "organizationId", "expiresAt", "consumedAt" FROM "UserToken"
         WHERE "tokenHash" = ${sha256Hex(body.token)} AND purpose = 'INVITATION' FOR UPDATE`;
      const token = rows[0];
      if (token === undefined || token.consumedAt !== null || token.expiresAt <= new Date())
        return invalidLink();
      const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
      if (user.status === "DISABLED" || user.status === "LOCKED") return invalidLink();
      const password = await tx.userCredential.findFirst({
        where: { userId: user.id, type: "PASSWORD", revokedAt: null },
      });
      const identifierHash = this.auth.identifierHash(user.email);

      if (password?.passwordHash) {
        // An existing account proves its current password (counted towards lockout).
        const lock = await lockState(tx, identifierHash, password.createdAt);
        if (lock.locked) return rateLimited(lock.retryAfterSeconds);
        if (!(await verifyPassword(password.passwordHash, body.password))) {
          await this.auth.recordFailure(
            tx,
            ctx,
            { userId: user.id, identifierHash, app: null },
            "INVALID_CREDENTIALS",
          );
          return new ApiError("UNAUTHENTICATED", "The password is not correct.");
        }
      } else {
        const length = NewPassword.safeParse(body.password);
        if (!length.success)
          return newPasswordError("password", length.error.issues[0]?.message ?? "Too short.");
        const problem = passwordProblem(body.password, { email: user.email });
        if (problem !== undefined) return newPasswordError("password", problem);
        await this.replacePassword(tx, user.id, body.password);
      }

      return inTenant(tx, token.organizationId, async () => {
        const membership = await tx.membership.findUnique({
          where: { organizationId_userId: { organizationId: token.organizationId, userId: user.id } },
        });
        if (membership === null || membership.status !== "INVITED") return invalidLink();
        const now = new Date();
        await tx.userToken.update({ where: { id: token.id }, data: { consumedAt: now } });
        await tx.membership.update({
          where: { id: membership.id },
          data: { status: "ACTIVE", activatedAt: now, version: { increment: 1 } },
        });
        await tx.user.update({
          where: { id: user.id },
          data: {
            status: "ACTIVE",
            emailVerifiedAt: user.emailVerifiedAt ?? now,
            ...(body.displayName && !user.displayName ? { displayName: body.displayName } : {}),
            version: { increment: 1 },
          },
        });
        if (!password?.passwordHash)
          await this.audit.write(tx, ctx, {
            action: "SECURITY_CREDENTIAL_CHANGED",
            organizationId: token.organizationId,
            actorUserId: user.id,
            resourceType: "User",
            resourceId: user.id,
            metadata: { change: "PASSWORD_SET" },
          });
        await this.audit.write(tx, ctx, {
          action: "USER_UPDATED",
          organizationId: token.organizationId,
          actorUserId: user.id,
          resourceType: "Membership",
          resourceId: membership.id,
          metadata: { change: "INVITATION_ACCEPTED" },
        });
        return undefined;
      });
    });
    if (outcome !== undefined) throw outcome;
    return {};
  }

  // ---------------------------------------------------------------------------
  // Second factors
  // ---------------------------------------------------------------------------

  /** The user acting: the signed-in user, or the holder of a sign-in challenge (TOTP only). */
  private async enrollingUser(
    tx: Tx,
    ctx: RequestContext,
    challengeToken: string | undefined,
    type: "TOTP" | "WEBAUTHN" | undefined,
  ): Promise<{ userId: string; challengeId?: string }> {
    if (ctx.auth !== undefined) return { userId: ctx.auth.userId };
    if (challengeToken === undefined) throw new ApiError("UNAUTHENTICATED");
    const challenge = await this.auth.lockChallenge(tx, challengeToken);
    if (challenge === undefined)
      throw new ApiError("UNAUTHENTICATED", "This sign-in step has expired. Sign in again.");
    if (type === "WEBAUTHN")
      throw new ApiError("VALIDATION_FAILED", undefined, {
        fieldErrors: [
          { path: "type", code: "UNSUPPORTED", message: "During sign-in, set up an authenticator app." },
        ],
      });
    const confirmed = await tx.userCredential.count({
      where: {
        userId: challenge.userId,
        type: { in: ["TOTP", "WEBAUTHN"] },
        revokedAt: null,
        confirmedAt: { not: null },
      },
    });
    // The challenge enrolls only a user who has no factor yet (ADR-0021).
    if (confirmed > 0) throw new ApiError("PERMISSION_DENIED", "Sign in with your existing second factor.");
    return { userId: challenge.userId, challengeId: challenge.id };
  }

  async createEnrollment(
    ctx: RequestContext,
    body: z.output<typeof MfaEnrollmentRequest>,
  ): Promise<OperationResult> {
    if (ctx.auth !== undefined) return this.enroll(requireTx(ctx), ctx, ctx.auth.userId, body);
    // During sign-in: run in our own transaction, with the same idempotency rules.
    const op = endpoint("createMfaEnrollment");
    return this.db.identity(async (tx) => {
      ctx.tx = tx;
      try {
        const { userId } = await this.enrollingUser(tx, ctx, body.challengeToken, body.type);
        const replay = await this.idempotency.begin(tx, ctx, op, userId, null);
        if (replay !== undefined) return replay;
        const out = await this.enroll(tx, ctx, userId, { ...body, challengeToken: undefined });
        await this.idempotency.complete(tx, ctx, userId, 201, out);
        return out;
      } finally {
        ctx.tx = undefined;
      }
    });
  }

  private async enroll(
    tx: Tx,
    ctx: RequestContext,
    userId: string,
    body: z.output<typeof MfaEnrollmentRequest>,
  ): Promise<OperationResult> {
    if (ctx.auth !== undefined && body.challengeToken !== undefined)
      throw new ApiError("VALIDATION_FAILED", undefined, {
        fieldErrors: [{ path: "challengeToken", code: "UNKNOWN_FIELD", message: "Only during sign-in." }],
      });
    const active = await tx.userCredential.count({
      where: { userId, type: { in: ["TOTP", "WEBAUTHN"] }, revokedAt: null },
    });
    if (active >= MAX_FACTORS) throw new ApiError("CONFLICT", "Remove a factor before adding another.");
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (body.type === "TOTP") {
      // An unconfirmed authenticator from an earlier attempt is replaced.
      await tx.userCredential.updateMany({
        where: { userId, type: "TOTP", confirmedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const secret = newTotpSecret();
      const credential = await tx.userCredential.create({
        data: {
          userId,
          type: "TOTP",
          totpSecretCiphertext: new Uint8Array(await this.sealer.seal(secret, `totp:${userId}`)),
          label: body.label ?? "Authenticator app",
        },
      });
      const data: z.input<typeof MfaEnrollment> = {
        id: credential.id,
        type: "TOTP",
        totp: { secret: base32Encode(secret), otpauthUri: otpauthUri(secret, user.email) },
      };
      return { data, resource: { type: "UserCredential", id: credential.id } };
    }
    const existing = await tx.userCredential.findMany({
      where: { userId, type: "WEBAUTHN", revokedAt: null },
      select: { webauthnCredentialId: true },
    });
    const options = await generateRegistrationOptions({
      rpName: this.config.WEBAUTHN_RP_NAME,
      rpID: this.config.WEBAUTHN_RP_ID,
      userName: user.email,
      userID: new TextEncoder().encode(userId),
      attestationType: "none",
      excludeCredentials: existing
        .filter((c) => c.webauthnCredentialId !== null)
        .map((c) => ({ id: Buffer.from(c.webauthnCredentialId ?? []).toString("base64url") })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    const token = await tx.userToken.create({
      data: {
        userId,
        purpose: "WEBAUTHN_REGISTRATION",
        tokenHash: sha256Hex(randomToken()),
        webauthnChallenge: new Uint8Array(Buffer.from(options.challenge, "utf8")),
        expiresAt: new Date(Date.now() + WEBAUTHN_REGISTRATION_TTL_MS),
      },
    });
    const data: z.input<typeof MfaEnrollment> = {
      id: token.id,
      type: "WEBAUTHN",
      webauthnOptions: options as unknown as Record<string, unknown>,
    };
    return { data, resource: { type: "UserToken", id: token.id } };
  }

  private async replayEnrollment(ctx: RequestContext, id: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const credential = await tx.userCredential.findUnique({ where: { id } });
    if (credential !== null) {
      if (
        credential.confirmedAt !== null ||
        credential.revokedAt !== null ||
        credential.totpSecretCiphertext === null
      )
        throw new ApiError("CONFLICT", "This enrollment is no longer pending. Start a new one.");
      const user = await tx.user.findUniqueOrThrow({ where: { id: credential.userId } });
      const secret = await this.sealer.open(
        Buffer.from(credential.totpSecretCiphertext),
        `totp:${credential.userId}`,
      );
      const data: z.input<typeof MfaEnrollment> = {
        id,
        type: "TOTP",
        totp: { secret: base32Encode(secret), otpauthUri: otpauthUri(secret, user.email) },
      };
      return { data, resource: { type: "UserCredential", id } };
    }
    const token = await tx.userToken.findUnique({ where: { id } });
    if (
      token === null ||
      token.consumedAt !== null ||
      token.expiresAt <= new Date() ||
      token.webauthnChallenge === null
    )
      throw new ApiError("CONFLICT", "This enrollment is no longer pending. Start a new one.");
    const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
    const options = await generateRegistrationOptions({
      rpName: this.config.WEBAUTHN_RP_NAME,
      rpID: this.config.WEBAUTHN_RP_ID,
      userName: user.email,
      userID: new TextEncoder().encode(user.id),
      challenge: Buffer.from(token.webauthnChallenge).toString("utf8"),
      attestationType: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    const data: z.input<typeof MfaEnrollment> = {
      id,
      type: "WEBAUTHN",
      webauthnOptions: options as unknown as Record<string, unknown>,
    };
    return { data, resource: { type: "UserToken", id } };
  }

  async confirmEnrollment(
    ctx: RequestContext,
    id: string,
    body: z.output<typeof MfaEnrollmentConfirmRequest>,
  ): Promise<OperationResult> {
    if (ctx.auth !== undefined) {
      await this.confirm(requireTx(ctx), ctx, ctx.auth.userId, id, body);
      return {};
    }
    const error = await this.db.identity(async (tx) => {
      const { userId, challengeId } = await this.enrollingUser(tx, ctx, body.challengeToken, "TOTP");
      try {
        await this.confirm(tx, ctx, userId, id, body);
        return undefined;
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "VALIDATION_FAILED" || challengeId === undefined) throw e;
        // A wrong code during sign-in spends one of the challenge's attempts.
        await tx.userToken.update({ where: { id: challengeId }, data: { attemptCount: { increment: 1 } } });
        return e;
      }
    });
    if (error !== undefined) throw error;
    return {};
  }

  private async confirm(
    tx: Tx,
    ctx: RequestContext,
    userId: string,
    id: string,
    body: z.output<typeof MfaEnrollmentConfirmRequest>,
  ): Promise<void> {
    const wrongCode = () =>
      new ApiError("VALIDATION_FAILED", undefined, {
        fieldErrors: [
          { path: "totpCode", code: "INCORRECT", message: "The code is not correct. Try the next one." },
        ],
      });
    const pending = await tx.userCredential.findFirst({
      where: { id, userId, type: "TOTP", confirmedAt: null, revokedAt: null },
    });
    let factor: "TOTP" | "WEBAUTHN";
    if (pending !== null) {
      if (body.totpCode === undefined || pending.totpSecretCiphertext === null) throw wrongCode();
      const secret = await this.sealer.open(Buffer.from(pending.totpSecretCiphertext), `totp:${userId}`);
      const step = verifyTotp(secret, body.totpCode, undefined);
      if (step === undefined) throw wrongCode();
      const now = new Date();
      await tx.userCredential.update({
        where: { id },
        data: { confirmedAt: now, lastUsedAt: new Date(step * TOTP_STEP_SECONDS * 1000) },
      });
      factor = "TOTP";
    } else {
      const token = await tx.userToken.findFirst({
        where: {
          id,
          userId,
          purpose: "WEBAUTHN_REGISTRATION",
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (token === null || token.webauthnChallenge === null || ctx.auth === undefined)
        throw notFound("FACTOR_NOT_FOUND");
      if (body.webauthnResponse === undefined)
        throw new ApiError("VALIDATION_FAILED", undefined, {
          fieldErrors: [
            { path: "webauthnResponse", code: "REQUIRED", message: "Send the passkey registration." },
          ],
        });
      let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
      try {
        verified = await verifyRegistrationResponse({
          response: body.webauthnResponse as unknown as RegistrationResponseJSON,
          expectedChallenge: Buffer.from(token.webauthnChallenge).toString("utf8"),
          expectedOrigin: this.config.WEBAUTHN_ORIGINS,
          expectedRPID: this.config.WEBAUTHN_RP_ID,
          requireUserVerification: true,
        });
      } catch {
        verified = { verified: false };
      }
      if (!verified.verified)
        throw new ApiError("VALIDATION_FAILED", undefined, {
          fieldErrors: [
            { path: "webauthnResponse", code: "INVALID", message: "The passkey could not be verified." },
          ],
        });
      const now = new Date();
      await tx.userToken.update({ where: { id: token.id }, data: { consumedAt: now } });
      const credential = verified.registrationInfo.credential;
      await tx.userCredential.create({
        data: {
          userId,
          type: "WEBAUTHN",
          webauthnCredentialId: new Uint8Array(Buffer.from(credential.id, "base64url")),
          webauthnPublicKey: new Uint8Array(credential.publicKey),
          webauthnSignCount: BigInt(credential.counter),
          label: "Passkey",
          confirmedAt: now,
        },
      });
      factor = "WEBAUTHN";
    }
    await this.audit.write(tx, ctx, {
      action: "SECURITY_CREDENTIAL_CHANGED",
      organizationId: ctx.auth?.organizationId ?? null,
      actorUserId: userId,
      resourceType: "User",
      resourceId: userId,
      metadata: { change: "FACTOR_ENROLLED", factor },
    });
  }

  async deleteFactor(ctx: RequestContext, id: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const credential = await tx.userCredential.findFirst({
      where: { id, userId: auth.userId, type: { in: ["TOTP", "WEBAUTHN"] }, revokedAt: null },
    });
    if (credential === null) throw notFound("FACTOR_NOT_FOUND");
    if (credential.confirmedAt !== null) {
      const others = await tx.userCredential.count({
        where: {
          userId: auth.userId,
          type: { in: ["TOTP", "WEBAUTHN"] },
          revokedAt: null,
          confirmedAt: { not: null },
          NOT: { id },
        },
      });
      const view = await signInView(tx, auth.userId);
      if (others === 0 && mfaRequired(view, "IOS_PROVIDER"))
        throw new ApiError(
          "CONFLICT",
          "Your role requires a second factor. Add another before removing this one.",
        );
    }
    await tx.userCredential.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.write(tx, ctx, {
      action: "SECURITY_CREDENTIAL_CHANGED",
      resourceType: "User",
      resourceId: auth.userId,
      metadata: { change: "FACTOR_REMOVED", factor: credential.type },
    });
    return {};
  }
}
