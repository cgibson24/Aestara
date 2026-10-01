// Users (memberships), role assignments, profiles, admin session revocation
// and MFA reset (spec §6.3, §4.5 rules 1–4; ADR-0018 K-05, K-07, K-12;
// ADR-0021). A "user" in this API is a person's membership in the caller's
// organization; the person's account (User) is platform-level.
import type {
  MfaResetRequest,
  ProviderProfile,
  ProviderProfilePut,
  RoleAssignment,
  RoleAssignmentCreate,
  StaffProfile,
  StaffProfilePut,
  StaffUser,
  UserCreate,
  UserUpdate,
} from "@aestara/api-contracts";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { AuthService } from "../auth/auth.service.ts";
import { Catalog } from "../auth/catalog.ts";
import { CredentialsService } from "../auth/credentials.service.ts";
import { signInView } from "../auth/sign-in.ts";
import { checkVersion, defined, iso, lockRow } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireTx } from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { ApiError, notFound } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import { covers, requireManageUser, requireNotSelf, type ScopedTarget } from "../common/scope.ts";
import type { Tx } from "../db/database.ts";
import { EmailService, mfaResetEmail } from "../email/email.ts";

type MembershipRow = {
  id: string;
  organizationId: string;
  userId: string;
  status: "INVITED" | "ACTIVE" | "DISABLED";
  invitedAt: Date | null;
  activatedAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  version: number;
};

type GrantRow = {
  id: string;
  userId: string;
  roleId: string;
  scope: "PLATFORM" | "ORGANIZATION" | "PRACTICE" | "LOCATION";
  practiceId: string | null;
  locationId: string | null;
  assignedAt: Date;
  assignedById: string | null;
};

/** Roles that an organization never assigns: platform operations and the patient-app role. */
const UNASSIGNABLE_IN_ORGANIZATION = new Set(["SUPER_ADMIN", "PATIENT"]);
/** Roles only an organization-wide administrator may grant (spec §4.5 note 3). */
const ORGANIZATION_LEVEL_ROLES = new Set(["ORGANIZATION_ADMIN", "SUPER_ADMIN"]);

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    private readonly catalog: Catalog,
    private readonly audit: AuditWriter,
    private readonly auth: AuthService,
    private readonly credentials: CredentialsService,
    private readonly email: EmailService,
    private readonly cursors: CursorCodec,
    private readonly idempotency: Idempotency,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("createUser", async (ctx, userId) => {
      const tx = requireTx(ctx);
      const membership = await this.membership(tx, userId);
      const [user] = await this.staffUsers(tx, [membership]);
      return { data: user, version: membership.version, resource: { type: "User", id: userId } };
    });
  }

  // ---- DTOs ------------------------------------------------------------------

  private grantDto(g: GrantRow): z.input<typeof RoleAssignment> {
    return {
      id: g.id,
      roleId: g.roleId,
      roleKey: this.catalog.role(g.roleId)?.key ?? "UNKNOWN",
      scope: g.scope,
      ...defined({ practiceId: g.practiceId, locationId: g.locationId, assignedById: g.assignedById }),
      assignedAt: iso(g.assignedAt),
    };
  }

  private async staffUsers(tx: Tx, memberships: MembershipRow[]): Promise<z.input<typeof StaffUser>[]> {
    const userIds = memberships.map((m) => m.userId);
    if (userIds.length === 0) return [];
    const [users, grants, providers, staff, factors] = await Promise.all([
      tx.user.findMany({ where: { id: { in: userIds } } }),
      tx.userRole.findMany({
        where: { userId: { in: userIds }, revokedAt: null },
        orderBy: { assignedAt: "asc" },
      }),
      tx.providerProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true } }),
      tx.staffProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true } }),
      tx.userCredential.findMany({
        where: {
          userId: { in: userIds },
          type: { in: ["TOTP", "WEBAUTHN"] },
          revokedAt: null,
          confirmedAt: { not: null },
        },
        select: { userId: true },
      }),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    const withProvider = new Set(providers.map((p) => p.userId));
    const withStaff = new Set(staff.map((p) => p.userId));
    const withFactor = new Set(factors.map((f) => f.userId));
    return memberships.map((m) => {
      const u = byId.get(m.userId);
      if (u === undefined) throw new Error("Membership without its user");
      return {
        id: u.id,
        email: u.email,
        ...defined({ displayName: u.displayName, phone: u.phone }),
        status: m.status,
        ...defined({
          invitedAt: m.invitedAt && iso(m.invitedAt),
          activatedAt: m.activatedAt && iso(m.activatedAt),
          disabledAt: m.disabledAt && iso(m.disabledAt),
          lastLoginAt: u.lastLoginAt && iso(u.lastLoginAt),
        }),
        mfaEnrolled: withFactor.has(u.id),
        roleAssignments: grants.filter((g) => g.userId === u.id).map((g) => this.grantDto(g)),
        hasProviderProfile: withProvider.has(u.id),
        hasStaffProfile: withStaff.has(u.id),
        createdAt: iso(m.createdAt),
        version: m.version,
      };
    });
  }

  private async membership(tx: Tx, userId: string): Promise<MembershipRow> {
    const m = await tx.membership.findFirst({ where: { userId } });
    if (m === null) throw notFound("USER_NOT_FOUND");
    return m;
  }

  private async activeGrants(tx: Tx, userId: string): Promise<GrantRow[]> {
    return tx.userRole.findMany({ where: { userId, revokedAt: null } });
  }

  private async one(tx: Tx, userId: string): Promise<OperationResult> {
    const membership = await this.membership(tx, userId);
    const [user] = await this.staffUsers(tx, [membership]);
    return { data: user, version: membership.version };
  }

  // ---- Users -----------------------------------------------------------------

  async list(
    ctx: RequestContext,
    query: { limit: number; cursor?: string; status?: string; practiceId?: string; roleId?: string },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const after = this.cursors.decode("users", query.cursor);
    const grantFilter =
      query.practiceId || query.roleId
        ? {
            roleAssignments: {
              some: {
                revokedAt: null,
                ...(query.practiceId ? { practiceId: query.practiceId } : {}),
                ...(query.roleId ? { roleId: query.roleId } : {}),
              },
            },
          }
        : {};
    const rows = await tx.membership.findMany({
      where: {
        ...(query.status ? { status: query.status as MembershipRow["status"] } : {}),
        ...grantFilter,
        ...(after ? { id: { gt: after.id } } : {}),
      },
      orderBy: { id: "asc" },
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows, query.limit, (m) =>
      this.cursors.encode("users", { k: null, id: m.id }),
    );
    return { data: await this.staffUsers(tx, items), page };
  }

  async get(ctx: RequestContext, userId: string): Promise<OperationResult> {
    return this.one(requireTx(ctx), userId);
  }

  async create(ctx: RequestContext, body: z.output<typeof UserCreate>): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const organizationId = auth.organizationId ?? "";
    const email = body.email.trim().toLowerCase();
    let user = await tx.user.findUnique({ where: { kind_email: { kind: "WORKFORCE", email } } });
    if (user !== null) requireNotSelf(auth, user.id);
    if (user?.status === "DISABLED" || user?.status === "LOCKED")
      throw new ApiError("CONFLICT", "This account is disabled.");
    const createdAccount = user === null;
    user ??= await tx.user.create({ data: { kind: "WORKFORCE", email, displayName: body.displayName } });
    if (await tx.membership.findFirst({ where: { userId: user.id }, select: { id: true } }))
      throw new ApiError("CONFLICT", "This person is already a member of the organization.");
    const membership = await tx.membership.create({
      data: { organizationId, userId: user.id, status: "INVITED", invitedAt: new Date() },
    });
    await this.audit.write(tx, ctx, {
      action: "USER_CREATED",
      resourceType: "User",
      resourceId: user.id,
      metadata: { accountCreated: createdAccount },
    });
    for (const assignment of body.roleAssignments) await this.assign(tx, ctx, user.id, assignment, []);
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });
    const invitation = await this.credentials.createInvitation(tx, {
      userId: user.id,
      email: user.email,
      organizationId,
      organizationName: organization.name,
      createdById: auth.userId,
    });
    ctx.afterCommit.push(() => this.email.send(invitation.email));
    const [dto] = await this.staffUsers(tx, [membership]);
    return { data: dto, version: membership.version, resource: { type: "User", id: user.id } };
  }

  async update(
    ctx: RequestContext,
    userId: string,
    body: z.output<typeof UserUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const membership = await this.membership(tx, userId);
    if (userId !== auth.userId) requireManageUser(auth, "user.update", await this.activeGrants(tx, userId));
    await lockRow(tx, "Membership", membership.id);
    const locked = await tx.membership.findUniqueOrThrow({ where: { id: membership.id } });
    checkVersion(ctx, locked.version);
    // The account is shared by every organization the person works for (ADR-0021).
    const view = await signInView(tx, userId);
    if (
      view.memberships.some(
        (m) => m.organizationId !== membership.organizationId && m.membershipStatus !== "DISABLED",
      )
    )
      throw new ApiError(
        "PERMISSION_DENIED",
        "This person also belongs to another organization, so only they can change their account details.",
      );
    await tx.user.update({
      where: { id: userId },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        version: { increment: 1 },
      },
    });
    await tx.membership.update({ where: { id: membership.id }, data: { version: { increment: 1 } } });
    await this.audit.write(tx, ctx, {
      action: "USER_UPDATED",
      resourceType: "User",
      resourceId: userId,
      metadata: { fields: Object.keys(body) },
    });
    return this.one(tx, userId);
  }

  async disable(ctx: RequestContext, userId: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const membership = await this.membership(tx, userId);
    requireNotSelf(auth, userId);
    requireManageUser(auth, "user.disable", await this.activeGrants(tx, userId));
    await lockRow(tx, "Membership", membership.id);
    const current = await tx.membership.findUniqueOrThrow({ where: { id: membership.id } });
    if (current.status === "DISABLED")
      throw new ApiError("INVALID_STATE_TRANSITION", "This user is already disabled.");
    await tx.membership.update({
      where: { id: membership.id },
      data: {
        status: "DISABLED",
        disabledAt: new Date(),
        disabledById: auth.userId,
        version: { increment: 1 },
      },
    });
    await tx.userToken.updateMany({
      where: { userId, organizationId: membership.organizationId, purpose: "INVITATION", consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.audit.write(tx, ctx, { action: "USER_DISABLED", resourceType: "User", resourceId: userId });
    // Disabling a membership ends only this organization's sessions (spec §4.2).
    await this.auth.revokeSessions(
      tx,
      ctx,
      { userId, organizationId: membership.organizationId },
      "MEMBERSHIP_DISABLED",
      auth.userId,
    );
    return this.one(tx, userId);
  }

  // ---- Role assignments --------------------------------------------------------

  /** Validates and creates one assignment (spec §4.5 rules 1–3, note 3). */
  private async assign(
    tx: Tx,
    ctx: RequestContext,
    userId: string,
    input: z.output<typeof RoleAssignmentCreate>,
    existing: readonly ScopedTarget[],
  ): Promise<GrantRow> {
    const auth = requireAuth(ctx);
    requireNotSelf(auth, userId);
    const role = this.catalog.role(input.roleId);
    const invalid = (path: string, message: string) =>
      new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code: "INVALID", message }] });
    if (role === undefined || UNASSIGNABLE_IN_ORGANIZATION.has(role.key))
      throw invalid("roleId", "This role cannot be assigned in an organization.");
    if (input.practiceId !== undefined) {
      const practice = await tx.practice.findUnique({
        where: { id: input.practiceId },
        select: { id: true },
      });
      if (practice === null) throw invalid("practiceId", "Unknown practice.");
    }
    if (input.locationId !== undefined) {
      const location = await tx.location.findFirst({
        where: { id: input.locationId, practiceId: input.practiceId ?? "" },
        select: { id: true },
      });
      if (location === null) throw invalid("locationId", "Unknown location in this practice.");
    }
    const target: ScopedTarget = {
      scope: input.scope,
      practiceId: input.practiceId ?? null,
      locationId: input.locationId ?? null,
    };
    const applicable = auth.grants.filter((g) => g.permissions.has("role.assign"));
    const organizationWide = applicable.some((g) => g.scope === "ORGANIZATION");
    if (
      !applicable.some((g) => covers(g, target)) ||
      (!organizationWide && ORGANIZATION_LEVEL_ROLES.has(role.key))
    )
      throw new ApiError("SEPARATION_OF_DUTIES", "You can grant roles only within your own scope.");
    requireManageUser(auth, "role.assign", existing);
    const duplicate = await tx.userRole.findFirst({
      where: {
        userId,
        roleId: role.id,
        scope: input.scope,
        practiceId: target.practiceId,
        locationId: target.locationId,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (duplicate) throw new ApiError("CONFLICT", "This user already has this role at this scope.");
    const grant = await tx.userRole.create({
      data: {
        userId,
        organizationId: auth.organizationId,
        roleId: role.id,
        scope: input.scope,
        practiceId: target.practiceId,
        locationId: target.locationId,
        assignedById: auth.userId,
      },
    });
    await this.audit.write(tx, ctx, {
      action: "ROLE_ASSIGNED",
      resourceType: "UserRole",
      resourceId: grant.id,
      metadata: {
        targetUserId: userId,
        roleKey: role.key,
        scope: input.scope,
        practiceId: target.practiceId,
        locationId: target.locationId,
      },
    });
    return grant;
  }

  async createAssignment(
    ctx: RequestContext,
    userId: string,
    body: z.output<typeof RoleAssignmentCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const membership = await this.membership(tx, userId);
    if (membership.status === "DISABLED")
      throw new ApiError("INVALID_STATE_TRANSITION", "Enable the user before assigning roles.");
    const grant = await this.assign(tx, ctx, userId, body, await this.activeGrants(tx, userId));
    return { data: this.grantDto(grant) };
  }

  async revokeAssignment(
    ctx: RequestContext,
    userId: string,
    assignmentId: string,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const grant = await tx.userRole.findFirst({ where: { id: assignmentId, userId, revokedAt: null } });
    if (grant === null) throw notFound("ROLE_ASSIGNMENT_NOT_FOUND");
    requireNotSelf(auth, userId);
    const role = this.catalog.role(grant.roleId);
    const applicable = auth.grants.filter((g) => g.permissions.has("role.assign"));
    const organizationWide = applicable.some((g) => g.scope === "ORGANIZATION");
    if (
      !applicable.some((g) => covers(g, grant)) ||
      (!organizationWide && ORGANIZATION_LEVEL_ROLES.has(role?.key ?? ""))
    )
      throw new ApiError("SEPARATION_OF_DUTIES", "You can revoke roles only within your own scope.");
    requireManageUser(auth, "role.assign", await this.activeGrants(tx, userId));
    await tx.userRole.update({
      where: { id: grant.id },
      data: { revokedAt: new Date(), revokedById: auth.userId },
    });
    await this.audit.write(tx, ctx, {
      action: "ROLE_REVOKED",
      resourceType: "UserRole",
      resourceId: grant.id,
      metadata: { targetUserId: userId, roleKey: role?.key ?? null, scope: grant.scope },
    });
    return {};
  }

  // ---- Profiles ----------------------------------------------------------------

  async getProviderProfile(ctx: RequestContext, userId: string): Promise<OperationResult> {
    const profile = await requireTx(ctx).providerProfile.findFirst({ where: { userId } });
    if (profile === null) throw notFound("PROVIDER_PROFILE_NOT_FOUND");
    return { data: providerDto(profile), version: profile.version };
  }

  async putProviderProfile(
    ctx: RequestContext,
    userId: string,
    body: z.output<typeof ProviderProfilePut>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const membership = await this.membership(tx, userId);
    if (userId !== auth.userId) requireManageUser(auth, "user.update", await this.activeGrants(tx, userId));
    const existing = await tx.providerProfile.findFirst({ where: { userId }, select: { id: true } });
    const fields = {
      displayName: body.displayName,
      credentials: body.credentials ?? null,
      specialty: body.specialty ?? null,
      npi: body.npi ?? null,
      bio: body.bio ?? null,
      isBookable: body.isBookable,
    };
    let profile: Parameters<typeof providerDto>[0] & { id: string };
    if (existing === null) {
      if (ctx.ifMatch !== undefined && ctx.ifMatch !== 0) throw notFound("PROVIDER_PROFILE_NOT_FOUND");
      profile = await tx.providerProfile.create({
        data: { organizationId: membership.organizationId, userId, ...fields },
      });
    } else {
      await lockRow(tx, "ProviderProfile", existing.id);
      const current = await tx.providerProfile.findUniqueOrThrow({ where: { id: existing.id } });
      checkVersion(ctx, current.version);
      profile = await tx.providerProfile.update({
        where: { id: existing.id },
        data: { ...fields, version: { increment: 1 } },
      });
    }
    await this.audit.write(tx, ctx, {
      action: "USER_UPDATED",
      resourceType: "ProviderProfile",
      resourceId: profile.id,
      metadata: { targetUserId: userId, created: existing === null },
    });
    return { data: providerDto(profile), version: profile.version };
  }

  async getStaffProfile(ctx: RequestContext, userId: string): Promise<OperationResult> {
    const profile = await requireTx(ctx).staffProfile.findFirst({ where: { userId } });
    if (profile === null) throw notFound("STAFF_PROFILE_NOT_FOUND");
    return { data: staffDto(profile), version: profile.version };
  }

  async putStaffProfile(
    ctx: RequestContext,
    userId: string,
    body: z.output<typeof StaffProfilePut>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const membership = await this.membership(tx, userId);
    if (userId !== auth.userId) requireManageUser(auth, "user.update", await this.activeGrants(tx, userId));
    const existing = await tx.staffProfile.findFirst({ where: { userId }, select: { id: true } });
    const fields = {
      displayName: body.displayName,
      jobTitle: body.jobTitle ?? null,
      department: body.department ?? null,
    };
    let profile: Parameters<typeof staffDto>[0] & { id: string };
    if (existing === null) {
      if (ctx.ifMatch !== undefined && ctx.ifMatch !== 0) throw notFound("STAFF_PROFILE_NOT_FOUND");
      profile = await tx.staffProfile.create({
        data: { organizationId: membership.organizationId, userId, ...fields },
      });
    } else {
      await lockRow(tx, "StaffProfile", existing.id);
      const current = await tx.staffProfile.findUniqueOrThrow({ where: { id: existing.id } });
      checkVersion(ctx, current.version);
      profile = await tx.staffProfile.update({
        where: { id: existing.id },
        data: { ...fields, version: { increment: 1 } },
      });
    }
    await this.audit.write(tx, ctx, {
      action: "USER_UPDATED",
      resourceType: "StaffProfile",
      resourceId: profile.id,
      metadata: { targetUserId: userId, created: existing === null },
    });
    return { data: staffDto(profile), version: profile.version };
  }

  // ---- Security administration ---------------------------------------------------

  async revokeSessions(ctx: RequestContext, userId: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    if (auth.scope === "platform") {
      // Platform security revokes all of the user's sessions (spec §4.2).
      const user = await tx.user.findFirst({
        where: { id: userId, kind: "WORKFORCE" },
        select: { id: true },
      });
      if (user === null) throw notFound("USER_NOT_FOUND");
      const count = await this.auth.revokeSessions(tx, ctx, { userId }, "ADMIN_REVOKED", auth.userId);
      return { data: { revokedSessions: count } };
    }
    const membership = await this.membership(tx, userId);
    if (userId !== auth.userId)
      requireManageUser(auth, "security.manage", await this.activeGrants(tx, userId));
    // An organization revokes only the sessions bound to it (ADR-0018 K-12).
    const count = await this.auth.revokeSessions(
      tx,
      ctx,
      { userId, organizationId: membership.organizationId },
      "ADMIN_REVOKED",
      auth.userId,
    );
    return { data: { revokedSessions: count } };
  }

  async resetMfa(
    ctx: RequestContext,
    userId: string,
    body: z.output<typeof MfaResetRequest>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    requireNotSelf(auth, userId);
    let organizationId: string | null = null;
    const user = await tx.user.findFirst({
      where: { id: userId, kind: "WORKFORCE" },
      select: { id: true, email: true },
    });
    if (user === null) throw notFound("USER_NOT_FOUND");
    if (auth.scope !== "platform") {
      const membership = await this.membership(tx, userId);
      organizationId = membership.organizationId;
      requireManageUser(auth, "security.manage", await this.activeGrants(tx, userId));
      // An organization resets only a person whose sole membership is its own (spec §6.3).
      const view = await signInView(tx, userId);
      if (
        view.memberships.some((m) => m.organizationId !== organizationId && m.membershipStatus !== "DISABLED")
      )
        throw new ApiError(
          "PERMISSION_DENIED",
          "This person also belongs to another organization. Platform security must reset their factors.",
        );
    }
    const removed = await tx.userCredential.updateMany({
      where: { userId, type: { in: ["TOTP", "WEBAUTHN"] }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.write(tx, ctx, {
      action: "SECURITY_CREDENTIAL_CHANGED",
      organizationId,
      resourceType: "User",
      resourceId: userId,
      metadata: {
        change: "MFA_RESET",
        identityVerificationMethod: body.identityVerificationMethod,
        removedFactors: removed.count,
      },
    });
    const revoked = await this.auth.revokeSessions(tx, ctx, { userId }, "CREDENTIAL_CHANGED", auth.userId);
    ctx.afterCommit.push(() => this.email.send(mfaResetEmail(user.email)));
    return { data: { removedFactors: removed.count, revokedSessions: revoked } };
  }
}

function providerDto(p: {
  userId: string;
  displayName: string;
  credentials: string | null;
  specialty: string | null;
  npi: string | null;
  bio: string | null;
  isBookable: boolean;
  updatedAt: Date;
  version: number;
}): z.input<typeof ProviderProfile> {
  return {
    userId: p.userId,
    displayName: p.displayName,
    ...defined({ credentials: p.credentials, specialty: p.specialty, npi: p.npi, bio: p.bio }),
    isBookable: p.isBookable,
    updatedAt: iso(p.updatedAt),
    version: p.version,
  };
}

function staffDto(p: {
  userId: string;
  displayName: string;
  jobTitle: string | null;
  department: string | null;
  updatedAt: Date;
  version: number;
}): z.input<typeof StaffProfile> {
  return {
    userId: p.userId,
    displayName: p.displayName,
    ...defined({ jobTitle: p.jobTitle, department: p.department }),
    updatedAt: iso(p.updatedAt),
    version: p.version,
  };
}
