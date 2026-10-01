// Loads and checks the session behind an access token on every request, so a
// revoked session, a disabled membership or a suspended organization takes
// effect immediately (spec §4.2 "Revocation"; roadmap M1.3). Grants are read
// in the request transaction and never cached (spec §4.6).
import type { ClientApp, RoleAssignmentScope } from "@aestara/shared-types";
import { Injectable } from "@nestjs/common";
import type { AuthContext, Grant } from "../common/context.ts";
import { ApiError } from "../common/errors.ts";
import type { Tx } from "../db/database.ts";
import { Catalog } from "./catalog.ts";
import type { AccessClaims } from "./tokens.ts";

interface SessionRow {
  id: string;
  userId: string;
  organizationId: string | null;
  deviceId: string | null;
  clientApp: ClientApp;
  mfaVerifiedAt: Date | null;
  createdAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  userStatus: string;
  membershipStatus: string | null;
  organizationStatus: string | null;
}

interface GrantRow {
  id: string;
  roleId: string;
  scope: RoleAssignmentScope;
  practiceId: string | null;
  locationId: string | null;
}

export type EvaluationScope = AuthContext["scope"];

@Injectable()
export class SessionLoader {
  constructor(private readonly catalog: Catalog) {}

  async load(tx: Tx, claims: AccessClaims, scope: EvaluationScope, now = new Date()): Promise<AuthContext> {
    const rows = await tx.$queryRaw<SessionRow[]>`
      SELECT s.id, s."userId", s."organizationId", s."deviceId", s."clientApp"::text AS "clientApp",
             s."mfaVerifiedAt", s."createdAt", s."idleExpiresAt", s."absoluteExpiresAt", s."revokedAt",
             u.status::text AS "userStatus",
             m.status::text AS "membershipStatus",
             o.status::text AS "organizationStatus"
        FROM "Session" s
        JOIN "User" u ON u.id = s."userId"
        LEFT JOIN "Membership" m ON m."organizationId" = s."organizationId" AND m."userId" = s."userId"
        LEFT JOIN "Organization" o ON o.id = s."organizationId"
       WHERE s.id = ${claims.sid}::uuid`;
    const s = rows[0];
    const invalid = new ApiError("SESSION_INVALID");
    if (s === undefined || s.userId !== claims.sub || s.revokedAt !== null) throw invalid;
    if (s.idleExpiresAt <= now || s.absoluteExpiresAt <= now) throw invalid;
    if (s.userStatus !== "ACTIVE") throw invalid;
    if ((s.organizationId ?? undefined) !== claims.org) throw invalid;
    if (s.organizationId !== null && (s.membershipStatus !== "ACTIVE" || s.organizationStatus !== "ACTIVE"))
      throw invalid;

    let grantRows: GrantRow[] = [];
    if (scope === "organization" && s.organizationId !== null) {
      grantRows = await tx.$queryRaw<GrantRow[]>`
        SELECT id, "roleId", scope::text AS scope, "practiceId", "locationId" FROM "UserRole"
         WHERE "userId" = ${s.userId}::uuid AND "organizationId" = ${s.organizationId}::uuid AND "revokedAt" IS NULL`;
    } else if (scope === "platform") {
      grantRows = await tx.$queryRaw<GrantRow[]>`
        SELECT id, "roleId", scope::text AS scope, "practiceId", "locationId" FROM "UserRole"
         WHERE "userId" = ${s.userId}::uuid AND scope = 'PLATFORM' AND "revokedAt" IS NULL`;
    }
    const grants: Grant[] = grantRows.flatMap((g) => {
      const role = this.catalog.role(g.roleId);
      return role === undefined ? [] : [{ ...g, roleKey: role.key, permissions: role.permissions }];
    });
    return {
      userId: s.userId,
      sessionId: s.id,
      clientApp: s.clientApp,
      deviceId: s.deviceId,
      organizationId: s.organizationId,
      scope,
      grants,
      permissions: new Set(grants.flatMap((g) => [...g.permissions])),
      mfaVerifiedAt: s.mfaVerifiedAt,
      sessionCreatedAt: s.createdAt,
      amr: claims.amr,
    };
  }
}
