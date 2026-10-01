// Creates sessions and the token responses shared by sign-in, MFA verification,
// refresh and organization switch (spec §4.2; ADR-0021).

import type { AuthTokens, DeviceInfo, SessionInfo } from "@aestara/api-contracts";
import { uuidv7 } from "@aestara/database";
import type { ClientApp } from "@aestara/shared-types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { sha256Hex } from "../common/crypto.ts";
import { REFRESH_COOKIE } from "../common/http.ts";
import { CONFIG, type Config } from "../config.ts";
import type { Tx } from "../db/database.ts";
import { inTenant } from "../db/tenant.ts";
import { sessionLifetimes } from "../settings/settings-store.ts";
import { Catalog } from "./catalog.ts";
import { permissionsOf, type SignInView, signInView } from "./sign-in.ts";
import { AccessTokens, RefreshTokens } from "./tokens.ts";

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string | null;
  readonly clientApp: ClientApp;
  readonly mfaVerifiedAt: Date | null;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

const iso = (d: Date) => d.toISOString();

@Injectable()
export class SessionFactory {
  constructor(
    private readonly catalog: Catalog,
    private readonly access: AccessTokens,
    private readonly refresh: RefreshTokens,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** Registers (or reuses) the app install; only a hash of its installation ID is stored. */
  async upsertDevice(
    tx: Tx,
    userId: string,
    app: ClientApp,
    device: z.output<typeof DeviceInfo> | undefined,
  ): Promise<string | null> {
    if (device === undefined) return null;
    const installationIdHash = sha256Hex(device.installationId);
    const fields = {
      clientApp: app,
      name: device.name ?? null,
      model: device.model ?? null,
      osVersion: device.osVersion ?? null,
      appVersion: device.appVersion ?? null,
      lastSeenAt: new Date(),
    };
    const row = await tx.device.upsert({
      where: { userId_installationIdHash: { userId, installationIdHash } },
      // A fresh sign-in with password and MFA re-admits a device whose earlier sessions were revoked.
      update: { ...fields, revokedAt: null, revokedById: null },
      create: { userId, installationIdHash, ...fields },
      select: { id: true },
    });
    return row.id;
  }

  async create(
    tx: Tx,
    ctx: RequestContext,
    input: {
      userId: string;
      organizationId: string | null;
      app: ClientApp;
      deviceId: string | null;
      mfaVerified: boolean;
    },
  ): Promise<{ session: SessionRecord; refreshToken: string }> {
    const now = new Date();
    const lifetimes = await sessionLifetimes(tx, input.organizationId, input.app);
    const id = uuidv7();
    const { token, hash } = this.refresh.issue(id, 0);
    const absoluteExpiresAt = new Date(now.getTime() + lifetimes.absoluteMs);
    const idleExpiresAt = new Date(Math.min(now.getTime() + lifetimes.idleMs, absoluteExpiresAt.getTime()));
    const session = await tx.session.create({
      data: {
        id,
        userId: input.userId,
        organizationId: input.organizationId,
        deviceId: input.deviceId,
        clientApp: input.app,
        refreshTokenHash: hash,
        refreshGeneration: 0,
        mfaVerifiedAt: input.mfaVerified ? now : null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        createdAt: now,
        lastUsedAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
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
    await tx.user.update({ where: { id: input.userId }, data: { lastLoginAt: now } });
    return { session, refreshToken: token };
  }

  amr(session: SessionRecord, factor?: "otp" | "hwk"): string[] {
    return session.mfaVerifiedAt !== null ? ["pwd", "mfa", ...(factor ? [factor] : [])] : ["pwd"];
  }

  async accessToken(session: SessionRecord, amr: readonly string[]) {
    return this.access.issue({
      sub: session.userId,
      sid: session.id,
      org: session.organizationId,
      app: session.clientApp,
      amr,
    });
  }

  /** Tokens plus session info. The admin web gets its refresh token only as a cookie. */
  async tokens(
    tx: Tx,
    ctx: RequestContext,
    session: SessionRecord,
    refreshToken: string,
    amr: readonly string[],
  ): Promise<z.input<typeof AuthTokens>> {
    const access = await this.accessToken(session, amr);
    const info = await this.info(tx, session);
    if (session.clientApp === "ADMIN_WEB") {
      this.setRefreshCookie(ctx, refreshToken, session.absoluteExpiresAt);
      return { accessToken: access.token, accessTokenExpiresAt: iso(access.expiresAt), session: info };
    }
    return {
      accessToken: access.token,
      accessTokenExpiresAt: iso(access.expiresAt),
      refreshToken,
      session: info,
    };
  }

  setRefreshCookie(ctx: RequestContext, token: string, expiresAt: Date): void {
    const attributes = [
      `${REFRESH_COOKIE}=${token}`,
      "Path=/api/v1/auth/token/refresh",
      "HttpOnly",
      "SameSite=Strict",
      `Expires=${expiresAt.toUTCString()}`,
      ...(this.config.cookieSecure ? ["Secure"] : []),
    ];
    ctx.setCookies.push(attributes.join("; "));
  }

  clearRefreshCookie(ctx: RequestContext): void {
    ctx.setCookies.push(
      [
        `${REFRESH_COOKIE}=`,
        "Path=/api/v1/auth/token/refresh",
        "HttpOnly",
        "SameSite=Strict",
        "Max-Age=0",
        ...(this.config.cookieSecure ? ["Secure"] : []),
      ].join("; "),
    );
  }

  /** The session description returned to clients (UI hints only; the server enforces). */
  async info(tx: Tx, session: SessionRecord, view?: SignInView): Promise<z.input<typeof SessionInfo>> {
    const v = view ?? (await signInView(tx, session.userId));
    const user = await tx.user.findUniqueOrThrow({
      where: { id: session.userId },
      select: { id: true, email: true, displayName: true },
    });
    const factors = await tx.userCredential.findMany({
      where: { userId: session.userId, type: { in: ["TOTP", "WEBAUTHN"] }, revokedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, label: true, confirmedAt: true, createdAt: true, lastUsedAt: true },
    });
    const current = v.active.find((m) => m.organizationId === session.organizationId);
    let organization: { id: string; name: string; slug: string } | undefined;
    if (current?.organizationId) {
      // The organization row is tenant data: read it in that organization's context.
      const id = current.organizationId;
      organization =
        (await inTenant(tx, id, () =>
          tx.organization.findUnique({ where: { id }, select: { id: true, name: true, slug: true } }),
        )) ?? undefined;
    }
    return {
      sessionId: session.id,
      clientApp: session.clientApp,
      user: {
        id: user.id,
        email: user.email,
        ...(user.displayName ? { displayName: user.displayName } : {}),
      },
      ...(organization !== undefined ? { organization } : {}),
      memberships: v.memberships.map((m) => ({
        organizationId: m.organizationId ?? "",
        organizationName: m.organizationName ?? "",
        status: (m.membershipStatus ?? "DISABLED") as "INVITED" | "ACTIVE" | "DISABLED",
      })),
      permissions: current ? permissionsOf(this.catalog, current.roleKeys) : [],
      platformPermissions: permissionsOf(this.catalog, v.platformRoleKeys),
      factors: factors.map((f) => ({
        id: f.id,
        type: f.type as "TOTP" | "WEBAUTHN",
        ...(f.label ? { label: f.label } : {}),
        confirmed: f.confirmedAt !== null,
        createdAt: iso(f.createdAt),
        ...(f.lastUsedAt ? { lastUsedAt: iso(f.lastUsedAt) } : {}),
      })),
      ...(session.mfaVerifiedAt ? { mfaVerifiedAt: iso(session.mfaVerifiedAt) } : {}),
      idleExpiresAt: iso(session.idleExpiresAt),
      absoluteExpiresAt: iso(session.absoluteExpiresAt),
    };
  }
}
