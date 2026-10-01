// Sign-in, MFA verification, refresh, logout, sessions and organization switch
// (spec §4.2, §6.3 "Auth & session"; ADR-0018 K-11 to K-15; ADR-0021).
//
// Ledger rule: every attempt writes a LoginEvent, and an AuditEvent when the
// identifier matches a user. Failures commit those rows first and only then
// answer, so a refused attempt is never rolled back out of the ledger.
import type {
  AccessTokenResult,
  AuthTokens,
  LoginRequest,
  MfaChallengeDetails,
  MfaVerifyRequest,
  RefreshRequest,
  SessionInfo,
  SessionListItem,
  SwitchOrganizationRequest,
} from "@aestara/api-contracts";
import type { ClientApp, LoginFailureReason } from "@aestara/shared-types";
import { Inject, Injectable } from "@nestjs/common";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { type RequestContext, requireAuth, requireTx } from "../common/context.ts";
import { hmacHex, randomToken, sha256Hex } from "../common/crypto.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { ApiError, notFound, rateLimited } from "../common/errors.ts";
import type { OperationResult } from "../common/operation.ts";
import { CONFIG, type Config } from "../config.ts";
import { Database, type Tx } from "../db/database.ts";
import { inTenant } from "../db/tenant.ts";
import { sessionLifetimes } from "../settings/settings-store.ts";
import { KEYS, SEALER, type ServerKeys } from "./keys.provider.ts";
import { type SecretSealer } from "./keys.ts";
import { lockState } from "./lockout.ts";
import { dummyPasswordHash, verifyPassword } from "./passwords.ts";
import { SessionFactory, type SessionRecord } from "./session-factory.ts";
import { mfaRequired, mfaRequiredIn, normalizeEmail, type SignInView, signInView } from "./sign-in.ts";
import { RefreshTokens } from "./tokens.ts";
import { TOTP_STEP_SECONDS, totpStep, verifyTotp } from "./totp.ts";

export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MFA_CHALLENGE_ATTEMPTS = 5;

const INVALID_CREDENTIALS = "The email or password is incorrect.";

type Outcome<T> = { ok: true; value: T } | { ok: false; error: ApiError };
const fail = (error: ApiError): { ok: false; error: ApiError } => ({ ok: false, error });

interface ChallengeRow {
  id: string;
  userId: string;
  clientApp: ClientApp | null;
  webauthnChallenge: Uint8Array | null;
  attemptCount: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly sessions: SessionFactory,
    private readonly refreshTokens: RefreshTokens,
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
    @Inject(KEYS) private readonly keys: ServerKeys,
    @Inject(SEALER) private readonly sealer: SecretSealer,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  identifierHash(email: string): string {
    return hmacHex(this.keys.identifier, normalizeEmail(email));
  }

  // ---------------------------------------------------------------------------
  // POST /auth/login
  // ---------------------------------------------------------------------------
  async login(ctx: RequestContext, body: z.output<typeof LoginRequest>): Promise<OperationResult> {
    this.checkClient(body.clientApp, body.device !== undefined);
    const email = normalizeEmail(body.email);
    const identifierHash = this.identifierHash(email);
    // Argon2id is deliberately slow, so the password is checked between two short
    // transactions rather than inside one: no connection or transaction waits on it.
    const stored = await this.db.identity(async (tx) => {
      const user = await tx.user.findUnique({ where: { kind_email: { kind: "WORKFORCE", email } } });
      const password = user
        ? await tx.userCredential.findFirst({ where: { userId: user.id, type: "PASSWORD", revokedAt: null } })
        : null;
      const lock = await lockState(tx, identifierHash, password?.createdAt ?? null);
      return {
        credentialId: password?.id ?? null,
        passwordHash: password?.passwordHash ?? null,
        locked: lock.locked,
      };
    });
    // A locked identifier is refused without checking the password.
    const checked = stored.locked
      ? false
      : await verifyPassword(stored.passwordHash ?? (await dummyPasswordHash()), body.password);

    const outcome = await this.db.identity(async (tx): Promise<Outcome<z.input<typeof AuthTokens>>> => {
      const user = await tx.user.findUnique({ where: { kind_email: { kind: "WORKFORCE", email } } });
      const password = user
        ? await tx.userCredential.findFirst({ where: { userId: user.id, type: "PASSWORD", revokedAt: null } })
        : null;
      const lock = await lockState(tx, identifierHash, password?.createdAt ?? null);
      const ledger = { userId: user?.id ?? null, identifierHash, app: body.clientApp };
      if (lock.locked) {
        await this.recordFailure(tx, ctx, ledger, "ACCOUNT_LOCKED");
        return fail(rateLimited(lock.retryAfterSeconds));
      }
      // The check counts only for the credential it was made against: a password
      // changed in between makes this attempt invalid.
      const valid = checked && password !== null && password.id === stored.credentialId;
      if (user === null || password === null || !valid) {
        await this.recordFailure(tx, ctx, ledger, "INVALID_CREDENTIALS");
        return fail(new ApiError("UNAUTHENTICATED", INVALID_CREDENTIALS));
      }
      if (user.status !== "ACTIVE") {
        await this.recordFailure(tx, ctx, ledger, "ACCOUNT_DISABLED");
        return fail(new ApiError("UNAUTHENTICATED", INVALID_CREDENTIALS));
      }
      const view = await signInView(tx, user.id);
      if (view.active.length === 0 && view.platformRoleKeys.length === 0) {
        await this.recordFailure(tx, ctx, ledger, "NO_ACTIVE_MEMBERSHIP");
        return fail(new ApiError("UNAUTHENTICATED", INVALID_CREDENTIALS));
      }
      const organizationId = this.chooseOrganization(view, body.organizationId);
      const factors = await this.confirmedFactors(tx, user.id);
      if (mfaRequired(view, body.clientApp) || factors.length > 0) {
        const details = await this.issueChallenge(tx, ctx, user.id, body.clientApp, factors, identifierHash);
        return fail(new ApiError("MFA_REQUIRED", undefined, details));
      }
      const deviceId = await this.sessions.upsertDevice(tx, user.id, body.clientApp, body.device);
      const created = await this.sessions.create(tx, ctx, {
        userId: user.id,
        organizationId,
        app: body.clientApp,
        deviceId,
        mfaVerified: false,
      });
      await this.recordSuccess(
        tx,
        ctx,
        { userId: user.id, identifierHash, app: body.clientApp },
        created.session,
        deviceId,
      );
      return {
        ok: true,
        value: await this.sessions.tokens(
          tx,
          ctx,
          created.session,
          created.refreshToken,
          this.sessions.amr(created.session),
        ),
      };
    });
    if (!outcome.ok) throw outcome.error;
    return { data: outcome.value };
  }

  // ---------------------------------------------------------------------------
  // POST /auth/mfa/verify
  // ---------------------------------------------------------------------------
  async verifyMfa(ctx: RequestContext, body: z.output<typeof MfaVerifyRequest>): Promise<OperationResult> {
    const outcome = await this.db.identity(async (tx): Promise<Outcome<z.input<typeof AuthTokens>>> => {
      const challenge = await this.lockChallenge(tx, body.challengeToken);
      if (challenge === undefined) return fail(expiredStep());
      const user = await tx.user.findUniqueOrThrow({ where: { id: challenge.userId } });
      const app = challenge.clientApp ?? "ADMIN_WEB";
      this.checkClient(app, body.device !== undefined);
      const identifierHash = this.identifierHash(user.email);
      const password = await tx.userCredential.findFirst({
        where: { userId: user.id, type: "PASSWORD", revokedAt: null },
      });
      const ledger = { userId: user.id, identifierHash, app };
      const lock = await lockState(tx, identifierHash, password?.createdAt ?? null);
      if (lock.locked) {
        await this.recordFailure(tx, ctx, ledger, "ACCOUNT_LOCKED");
        return fail(rateLimited(lock.retryAfterSeconds));
      }
      if (user.status !== "ACTIVE") {
        await tx.userToken.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
        await this.recordFailure(tx, ctx, ledger, "ACCOUNT_DISABLED");
        return fail(expiredStep());
      }
      const factors = await this.confirmedFactors(tx, user.id);
      const details = this.challengeDetails(body.challengeToken, challenge, factors);
      if (factors.length === 0)
        return fail(new ApiError("MFA_REQUIRED", "Set up an authenticator app to continue.", details));

      const verified = body.totpCode
        ? await this.checkTotp(tx, user.id, body.totpCode)
        : await this.checkPasskey(tx, user.id, challenge, body.webauthnResponse);
      if (verified === undefined) {
        const attempts = challenge.attemptCount + 1;
        await tx.userToken.update({
          where: { id: challenge.id },
          data: {
            attemptCount: attempts,
            ...(attempts >= MFA_CHALLENGE_ATTEMPTS ? { consumedAt: new Date() } : {}),
          },
        });
        await this.recordFailure(tx, ctx, ledger, "MFA_FAILED");
        if (attempts >= MFA_CHALLENGE_ATTEMPTS) return fail(expiredStep());
        return fail(new ApiError("MFA_REQUIRED", "The code is not correct. Try again.", details));
      }

      const view = await signInView(tx, user.id);
      if (view.active.length === 0 && view.platformRoleKeys.length === 0) {
        await tx.userToken.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
        await this.recordFailure(tx, ctx, ledger, "NO_ACTIVE_MEMBERSHIP");
        return fail(expiredStep());
      }
      const organizationId = this.chooseOrganization(view, body.organizationId);
      await tx.userToken.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      const deviceId = await this.sessions.upsertDevice(tx, user.id, app, body.device);
      const created = await this.sessions.create(tx, ctx, {
        userId: user.id,
        organizationId,
        app,
        deviceId,
        mfaVerified: true,
      });
      await this.recordSuccess(tx, ctx, ledger, created.session, deviceId);
      return {
        ok: true,
        value: await this.sessions.tokens(
          tx,
          ctx,
          created.session,
          created.refreshToken,
          this.sessions.amr(created.session, verified),
        ),
      };
    });
    if (!outcome.ok) throw outcome.error;
    return { data: outcome.value };
  }

  // ---------------------------------------------------------------------------
  // POST /auth/token/refresh
  // ---------------------------------------------------------------------------
  async refresh(ctx: RequestContext, body: z.output<typeof RefreshRequest>): Promise<OperationResult> {
    const fromCookie = body.refreshToken === undefined;
    const token = body.refreshToken ?? ctx.refreshCookie;
    if (fromCookie) {
      // CSRF defence for the cookie (spec §4.2; ADR-0018 K-11).
      if (ctx.origin === null || !this.config.ADMIN_WEB_ORIGINS.includes(ctx.origin))
        throw new ApiError("PERMISSION_DENIED", "This origin may not refresh a session.");
    }
    const parts = token ? this.refreshTokens.parse(token) : undefined;
    if (token === undefined || parts === undefined) throw new ApiError("SESSION_INVALID");
    const outcome = await this.db.identity(async (tx): Promise<Outcome<z.input<typeof AuthTokens>>> => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          userId: string;
          organizationId: string | null;
          clientApp: ClientApp;
          refreshTokenHash: string;
          refreshGeneration: number;
          mfaVerifiedAt: Date | null;
          idleExpiresAt: Date;
          absoluteExpiresAt: Date;
          revokedAt: Date | null;
          deviceId: string | null;
        }[]
      >`SELECT id, "userId", "organizationId", "clientApp"::text AS "clientApp", "refreshTokenHash",
               "refreshGeneration", "mfaVerifiedAt", "idleExpiresAt", "absoluteExpiresAt", "revokedAt", "deviceId"
          FROM "Session" WHERE id = ${parts.sessionId}::uuid FOR UPDATE`;
      const s = rows[0];
      const invalid = fail(new ApiError("SESSION_INVALID"));
      if (s === undefined || s.revokedAt !== null) return invalid;
      if (fromCookie !== (s.clientApp === "ADMIN_WEB")) return invalid;
      if (parts.generation < s.refreshGeneration) {
        // An older generation with a valid MAC was issued by us: the token was copied (ADR-0021).
        await this.revokeSessions(tx, ctx, { ids: [s.id] }, "REFRESH_TOKEN_REUSE", null);
        return invalid;
      }
      const now = new Date();
      if (parts.generation > s.refreshGeneration || sha256Hex(token) !== s.refreshTokenHash) return invalid;
      if (s.idleExpiresAt <= now || s.absoluteExpiresAt <= now) return invalid;
      const user = await tx.user.findUnique({ where: { id: s.userId }, select: { status: true } });
      if (user?.status !== "ACTIVE") return invalid;
      const view = await signInView(tx, s.userId);
      if (s.organizationId !== null && !view.active.some((m) => m.organizationId === s.organizationId))
        return invalid;
      if (s.organizationId === null && view.active.length === 0 && view.platformRoleKeys.length === 0)
        return invalid;

      const lifetimes = await sessionLifetimes(tx, s.organizationId, s.clientApp);
      const next = this.refreshTokens.issue(s.id, s.refreshGeneration + 1);
      const session = await tx.session.update({
        where: { id: s.id },
        data: {
          refreshGeneration: s.refreshGeneration + 1,
          refreshTokenHash: next.hash,
          lastUsedAt: now,
          idleExpiresAt: new Date(Math.min(now.getTime() + lifetimes.idleMs, s.absoluteExpiresAt.getTime())),
        },
        select: {
          id: true,
          userId: true,
          organizationId: true,
          clientApp: true,
          mfaVerifiedAt: true,
          idleExpiresAt: true,
          absoluteExpiresAt: true,
        },
      });
      if (s.deviceId !== null)
        await tx.device.update({ where: { id: s.deviceId }, data: { lastSeenAt: now } });
      return {
        ok: true,
        value: await this.sessions.tokens(tx, ctx, session, next.token, this.sessions.amr(session)),
      };
    });
    if (!outcome.ok) {
      if (fromCookie) this.sessions.clearRefreshCookie(ctx);
      throw outcome.error;
    }
    return { data: outcome.value };
  }

  // ---------------------------------------------------------------------------
  // Session-authenticated operations (run inside the request transaction)
  // ---------------------------------------------------------------------------
  async logout(ctx: RequestContext): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    await this.revokeSessions(tx, ctx, { ids: [auth.sessionId] }, "LOGOUT", auth.userId);
    await tx.loginEvent.create({
      data: {
        eventType: "LOGOUT",
        userId: auth.userId,
        organizationId: auth.organizationId,
        clientApp: auth.clientApp,
        sessionId: auth.sessionId,
        deviceId: auth.deviceId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      },
    });
    await this.audit.write(tx, ctx, {
      action: "LOGOUT",
      resourceType: "Session",
      resourceId: auth.sessionId,
    });
    if (auth.clientApp === "ADMIN_WEB") this.sessions.clearRefreshCookie(ctx);
    return {};
  }

  async sessionInfo(ctx: RequestContext): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const record = await this.sessionRecord(tx, requireAuth(ctx).sessionId);
    const data: z.input<typeof SessionInfo> = await this.sessions.info(tx, record);
    return { data };
  }

  async switchOrganization(
    ctx: RequestContext,
    body: z.output<typeof SwitchOrganizationRequest>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const view = await signInView(tx, auth.userId);
    if (!view.active.some((m) => m.organizationId === body.organizationId))
      throw notFound("ORGANIZATION_NOT_FOUND");
    if (mfaRequiredIn(view, body.organizationId, auth.clientApp) && auth.mfaVerifiedAt === null)
      throw new ApiError(
        "REAUTHENTICATION_REQUIRED",
        "This organization requires a second factor. Sign in again.",
      );
    const current = await this.sessionRecord(tx, auth.sessionId);
    const lifetimes = await sessionLifetimes(tx, body.organizationId, auth.clientApp);
    const now = Date.now();
    const created = await tx.session.findUniqueOrThrow({
      where: { id: auth.sessionId },
      select: { createdAt: true },
    });
    const absolute = Math.min(
      current.absoluteExpiresAt.getTime(),
      created.createdAt.getTime() + lifetimes.absoluteMs,
    );
    const session = await tx.session.update({
      where: { id: auth.sessionId },
      data: {
        organizationId: body.organizationId,
        absoluteExpiresAt: new Date(absolute),
        idleExpiresAt: new Date(Math.min(now + lifetimes.idleMs, absolute)),
      },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        clientApp: true,
        mfaVerifiedAt: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
      },
    });
    // The event belongs to the organization switched to.
    await inTenant(tx, body.organizationId, () =>
      this.audit.write(tx, ctx, {
        action: "ORGANIZATION_SWITCHED",
        organizationId: body.organizationId,
        resourceType: "Session",
        resourceId: auth.sessionId,
        metadata: { fromOrganizationId: auth.organizationId },
      }),
    );
    const access = await this.sessions.accessToken(session, auth.amr);
    const data: z.input<typeof AccessTokenResult> = {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      session: await this.sessions.info(tx, session, view),
    };
    return { data };
  }

  async listOwnSessions(
    ctx: RequestContext,
    query: { limit: number; cursor?: string },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const scope = "sessions";
    const after = this.cursors.decode(scope, query.cursor);
    const now = new Date();
    const rows = await tx.session.findMany({
      where: {
        userId: auth.userId,
        revokedAt: null,
        absoluteExpiresAt: { gt: now },
        idleExpiresAt: { gt: now },
        ...(after ? { id: { lt: after.id } } : {}),
      },
      orderBy: { id: "desc" },
      take: query.limit + 1,
      select: {
        id: true,
        clientApp: true,
        organizationId: true,
        createdAt: true,
        lastUsedAt: true,
        device: { select: { name: true, model: true } },
      },
    });
    const { items, page } = paginate(rows, query.limit, (last) =>
      this.cursors.encode(scope, { k: null, id: last.id }),
    );
    const data: z.input<typeof SessionListItem>[] = items.map((s) => ({
      id: s.id,
      clientApp: s.clientApp,
      ...(s.organizationId ? { organizationId: s.organizationId } : {}),
      ...(s.device
        ? {
            device: {
              ...(s.device.name ? { name: s.device.name } : {}),
              ...(s.device.model ? { model: s.device.model } : {}),
            },
          }
        : {}),
      createdAt: s.createdAt.toISOString(),
      ...(s.lastUsedAt ? { lastUsedAt: s.lastUsedAt.toISOString() } : {}),
      current: s.id === auth.sessionId,
    }));
    return { data, page };
  }

  async revokeOwnSession(ctx: RequestContext, id: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const session = await tx.session.findFirst({ where: { id, userId: auth.userId, revokedAt: null } });
    if (session === null) throw notFound("SESSION_NOT_FOUND");
    await this.revokeSessions(tx, ctx, { ids: [id] }, "LOGOUT", auth.userId);
    return {};
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /**
   * Revokes sessions and writes one SECURITY_SESSION_REVOKED event per
   * organization they were bound to (platform-level for unbound sessions).
   */
  async revokeSessions(
    tx: Tx,
    ctx: RequestContext,
    filter: { ids?: string[]; userId?: string; organizationId?: string; exceptId?: string },
    reason:
      | "LOGOUT"
      | "ADMIN_REVOKED"
      | "DEVICE_REVOKED"
      | "REFRESH_TOKEN_REUSE"
      | "CREDENTIAL_CHANGED"
      | "MEMBERSHIP_DISABLED"
      | "USER_DISABLED",
    revokedById: string | null,
  ): Promise<number> {
    const now = new Date();
    const where = {
      revokedAt: null,
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
      ...(filter.exceptId ? { NOT: { id: filter.exceptId } } : {}),
    };
    const sessions = await tx.session.findMany({
      where,
      select: { id: true, organizationId: true, userId: true },
    });
    if (sessions.length === 0) return 0;
    await tx.session.updateMany({
      where: { id: { in: sessions.map((s) => s.id) }, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason, revokedById },
    });
    const byOrganization = new Map<string | null, typeof sessions>();
    for (const s of sessions)
      byOrganization.set(s.organizationId, [...(byOrganization.get(s.organizationId) ?? []), s]);
    for (const [organizationId, group] of byOrganization) {
      const event = {
        action: "SECURITY_SESSION_REVOKED" as const,
        organizationId,
        actorUserId: revokedById,
        resourceType: group.length === 1 ? "Session" : "User",
        resourceId: group.length === 1 ? (group[0]?.id ?? null) : (group[0]?.userId ?? null),
        metadata: { reason, sessions: group.length },
      };
      // Each event is recorded in the organization the sessions were bound to.
      if (organizationId === null) await this.audit.write(tx, ctx, event);
      else await inTenant(tx, organizationId, () => this.audit.write(tx, ctx, event));
    }
    return sessions.length;
  }

  private async sessionRecord(tx: Tx, id: string): Promise<SessionRecord> {
    return tx.session.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        clientApp: true,
        mfaVerifiedAt: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
      },
    });
  }

  private checkClient(app: ClientApp, hasDevice: boolean): void {
    if (app === "IOS_PATIENT")
      throw new ApiError("VALIDATION_FAILED", undefined, {
        fieldErrors: [
          {
            path: "clientApp",
            code: "UNSUPPORTED_CLIENT",
            message: "Staff sign-in accepts IOS_PROVIDER and ADMIN_WEB.",
          },
        ],
      });
    if (app === "IOS_PROVIDER" && !hasDevice)
      throw new ApiError("VALIDATION_FAILED", undefined, {
        fieldErrors: [
          { path: "device", code: "REQUIRED", message: "The provider app must identify its install." },
        ],
      });
  }

  private chooseOrganization(view: SignInView, requested: string | undefined): string | null {
    if (requested !== undefined) {
      if (!view.active.some((m) => m.organizationId === requested))
        throw new ApiError("VALIDATION_FAILED", undefined, {
          fieldErrors: [
            {
              path: "organizationId",
              code: "NOT_A_MEMBERSHIP",
              message: "Choose one of your organizations.",
            },
          ],
        });
      return requested;
    }
    return view.active.length === 1 ? (view.active[0]?.organizationId ?? null) : null;
  }

  private async confirmedFactors(tx: Tx, userId: string) {
    return tx.userCredential.findMany({
      where: { userId, type: { in: ["TOTP", "WEBAUTHN"] }, revokedAt: null, confirmedAt: { not: null } },
      select: { id: true, type: true, webauthnCredentialId: true },
    });
  }

  private async issueChallenge(
    tx: Tx,
    ctx: RequestContext,
    userId: string,
    app: ClientApp,
    factors: { type: string; webauthnCredentialId: Uint8Array | null }[],
    identifierHash: string,
  ): Promise<z.input<typeof MfaChallengeDetails>> {
    const token = randomToken();
    const passkeys = factors.filter((f) => f.type === "WEBAUTHN" && f.webauthnCredentialId !== null);
    const options =
      passkeys.length > 0
        ? await generateAuthenticationOptions({
            rpID: this.config.WEBAUTHN_RP_ID,
            allowCredentials: passkeys.map((p) => ({
              id: Buffer.from(p.webauthnCredentialId ?? []).toString("base64url"),
            })),
            userVerification: "required",
          })
        : undefined;
    const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);
    // Earlier open challenges of this user end here.
    await tx.userToken.updateMany({
      where: { userId, purpose: "MFA_CHALLENGE", consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    await tx.userToken.create({
      data: {
        userId,
        purpose: "MFA_CHALLENGE",
        tokenHash: sha256Hex(token),
        clientApp: app,
        webauthnChallenge: options ? Buffer.from(options.challenge, "utf8") : null,
        expiresAt,
      },
    });
    await tx.loginEvent.create({
      data: {
        eventType: "MFA_CHALLENGE_ISSUED",
        userId,
        clientApp: app,
        identifierHash,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      },
    });
    return {
      challengeToken: token,
      expiresAt: expiresAt.toISOString(),
      factors: [...new Set(factors.map((f) => f.type as "TOTP" | "WEBAUTHN"))],
      enrollmentRequired: factors.length === 0,
      ...(options ? { webauthnOptions: options as unknown as Record<string, unknown> } : {}),
    };
  }

  private challengeDetails(
    token: string,
    challenge: ChallengeRow,
    factors: { type: string }[],
  ): z.input<typeof MfaChallengeDetails> {
    return {
      challengeToken: token,
      expiresAt: challenge.expiresAt.toISOString(),
      factors: [...new Set(factors.map((f) => f.type as "TOTP" | "WEBAUTHN"))],
      enrollmentRequired: factors.length === 0,
    };
  }

  /** The open sign-in challenge for a token, locked for this transaction. */
  async lockChallenge(tx: Tx, token: string): Promise<ChallengeRow | undefined> {
    const rows = await tx.$queryRaw<ChallengeRow[]>`
      SELECT id, "userId", "clientApp"::text AS "clientApp", "webauthnChallenge", "attemptCount", "expiresAt", "consumedAt"
        FROM "UserToken"
       WHERE "tokenHash" = ${sha256Hex(token)} AND purpose = 'MFA_CHALLENGE'
       FOR UPDATE`;
    const row = rows[0];
    if (row === undefined || row.consumedAt !== null || row.expiresAt <= new Date()) return undefined;
    if (row.attemptCount >= MFA_CHALLENGE_ATTEMPTS) return undefined;
    return row;
  }

  /** A TOTP code against the user's confirmed authenticators; each time step is accepted once. */
  async checkTotp(tx: Tx, userId: string, code: string): Promise<"otp" | undefined> {
    const credentials = await tx.userCredential.findMany({
      where: { userId, type: "TOTP", revokedAt: null, confirmedAt: { not: null } },
      select: { id: true, totpSecretCiphertext: true, lastUsedAt: true },
    });
    for (const c of credentials) {
      if (c.totpSecretCiphertext === null) continue;
      const secret = await this.sealer.open(Buffer.from(c.totpSecretCiphertext), `totp:${userId}`);
      const lastStep = c.lastUsedAt ? totpStep(c.lastUsedAt.getTime()) : undefined;
      const step = verifyTotp(secret, code, lastStep);
      if (step !== undefined) {
        await tx.userCredential.update({
          where: { id: c.id },
          data: { lastUsedAt: new Date(step * TOTP_STEP_SECONDS * 1000) },
        });
        return "otp";
      }
    }
    return undefined;
  }

  private async checkPasskey(
    tx: Tx,
    userId: string,
    challenge: ChallengeRow,
    response: Record<string, unknown> | undefined,
  ): Promise<"hwk" | undefined> {
    if (response === undefined || challenge.webauthnChallenge === null) return undefined;
    const id = typeof response.id === "string" ? response.id : "";
    const credential = await tx.userCredential.findFirst({
      where: {
        userId,
        type: "WEBAUTHN",
        revokedAt: null,
        confirmedAt: { not: null },
        webauthnCredentialId: Buffer.from(id, "base64url"),
      },
    });
    if (credential?.webauthnPublicKey == null) return undefined;
    try {
      const result = await verifyAuthenticationResponse({
        response: response as unknown as AuthenticationResponseJSON,
        expectedChallenge: Buffer.from(challenge.webauthnChallenge).toString("utf8"),
        expectedOrigin: this.config.WEBAUTHN_ORIGINS,
        expectedRPID: this.config.WEBAUTHN_RP_ID,
        credential: {
          id,
          publicKey: new Uint8Array(credential.webauthnPublicKey),
          counter: Number(credential.webauthnSignCount ?? 0n),
        },
        requireUserVerification: true,
      });
      if (!result.verified) return undefined;
      await tx.userCredential.update({
        where: { id: credential.id },
        data: { webauthnSignCount: BigInt(result.authenticationInfo.newCounter), lastUsedAt: new Date() },
      });
      return "hwk";
    } catch {
      return undefined;
    }
  }

  async recordFailure(
    tx: Tx,
    ctx: RequestContext,
    ledger: { userId: string | null; identifierHash: string; app: ClientApp | null },
    reason: LoginFailureReason,
  ): Promise<void> {
    await tx.loginEvent.create({
      data: {
        eventType: "LOGIN_FAILURE",
        failureReason: reason,
        userId: ledger.userId,
        clientApp: ledger.app,
        identifierHash: ledger.identifierHash,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      },
    });
    // An attempt for an unknown identifier stays in the ledger only (spec §4.2).
    if (ledger.userId !== null)
      await this.audit.write(tx, ctx, {
        action: "LOGIN_FAILURE",
        outcome: "FAILURE",
        organizationId: null,
        actorUserId: ledger.userId,
        resourceType: "User",
        resourceId: ledger.userId,
        metadata: { reason, clientApp: ledger.app },
      });
  }

  private async recordSuccess(
    tx: Tx,
    ctx: RequestContext,
    ledger: { userId: string; identifierHash: string; app: ClientApp },
    session: SessionRecord,
    deviceId: string | null,
  ): Promise<void> {
    await tx.loginEvent.create({
      data: {
        eventType: "LOGIN_SUCCESS",
        userId: ledger.userId,
        organizationId: session.organizationId,
        clientApp: ledger.app,
        identifierHash: ledger.identifierHash,
        sessionId: session.id,
        deviceId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      },
    });
    await inTenant(tx, session.organizationId, () =>
      tx.auditEvent.createMany({
        // No RETURNING: a platform-level event is not readable by the application role.
        data: [
          {
            organizationId: session.organizationId,
            actorType: "USER",
            actorUserId: ledger.userId,
            action: "LOGIN_SUCCESS",
            resourceType: "Session",
            resourceId: session.id,
            requestId: ctx.requestId,
            sessionId: session.id,
            deviceId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            metadata: { clientApp: ledger.app, mfa: session.mfaVerifiedAt !== null },
          },
        ],
      }),
    );
  }
}

function expiredStep(): ApiError {
  return new ApiError("UNAUTHENTICATED", "This sign-in step has expired. Sign in again.");
}
