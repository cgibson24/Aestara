// Organizations, practices and locations (spec §6.3; §4.5 rule 2; ADR-0018
// K-05, K-06; ADR-0021 "Platform reach"). Platform-scope requests run on the
// platform role, which reaches organization metadata only; everything else runs
// in the caller's tenant.
import type {
  AdminBootstrapResult,
  FirstAdmin,
  Location,
  LocationCreate,
  LocationUpdate,
  Organization,
  OrganizationCreate,
  OrganizationUpdate,
  Practice,
  PracticeCreate,
  PracticeUpdate,
} from "@aestara/api-contracts";
import { catalogId } from "@aestara/database";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { CredentialsService } from "../auth/credentials.service.ts";
import { checkVersion, defined, iso, lockRow, present } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireTx } from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { ApiError, notFound } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import { requireOrganizationGrant, requireScopedPermission } from "../common/scope.ts";
import type { Tx } from "../db/database.ts";
import { EmailService } from "../email/email.ts";

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};
type PracticeRow = {
  id: string;
  name: string;
  timezone: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};
type LocationRow = PracticeRow & {
  practiceId: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
};

const ORGANIZATION_ADMIN = catalogId("role", "ORGANIZATION_ADMIN");

export function organizationDto(o: OrganizationRow): z.input<typeof Organization> {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status as "ACTIVE",
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
    version: o.version,
  };
}

function practiceDto(p: PracticeRow): z.input<typeof Practice> {
  return {
    id: p.id,
    name: p.name,
    timezone: p.timezone,
    status: p.status as "ACTIVE",
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
    version: p.version,
  };
}

function locationDto(l: LocationRow): z.input<typeof Location> {
  return {
    id: l.id,
    practiceId: l.practiceId,
    name: l.name,
    timezone: l.timezone,
    ...defined({
      addressLine1: l.addressLine1,
      addressLine2: l.addressLine2,
      city: l.city,
      region: l.region,
      postalCode: l.postalCode,
      countryCode: l.countryCode,
    }),
    status: l.status as "ACTIVE",
    createdAt: iso(l.createdAt),
    updatedAt: iso(l.updatedAt),
    version: l.version,
  };
}

@Injectable()
export class OrganizationsService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly credentials: CredentialsService,
    private readonly email: EmailService,
    private readonly cursors: CursorCodec,
    private readonly idempotency: Idempotency,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("createOrganization", async (ctx, id) => {
      const tx = requireTx(ctx);
      const organization = await tx.organization.findUniqueOrThrow({ where: { id } });
      return {
        data: { organization: organizationDto(organization), firstAdmin: await this.firstAdmin(tx, id) },
        version: organization.version,
        resource: { type: "Organization", id },
      };
    });
    this.idempotency.register("bootstrapOrganizationAdmin", async (ctx, userId) => {
      const tx = requireTx(ctx);
      const organizationId = ctx.params.id ?? "";
      return {
        data: await this.bootstrapResult(tx, organizationId, userId),
        resource: { type: "User", id: userId },
      };
    });
  }

  // ---- Organizations ---------------------------------------------------------

  async list(ctx: RequestContext, query: { limit: number; cursor?: string }): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const after = this.cursors.decode("organizations", query.cursor);
    const rows = await tx.organization.findMany({
      where: after ? { id: { gt: after.id } } : {},
      orderBy: { id: "asc" },
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows, query.limit, (o) =>
      this.cursors.encode("organizations", { k: null, id: o.id }),
    );
    return { data: items.map(organizationDto), page };
  }

  async create(ctx: RequestContext, body: z.output<typeof OrganizationCreate>): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    if (await tx.organization.findUnique({ where: { slug: body.slug }, select: { id: true } }))
      throw new ApiError("CONFLICT", "This slug is already in use.");
    const organization = await tx.organization.create({ data: { name: body.name, slug: body.slug } });
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      organizationId: organization.id,
      resourceType: "Organization",
      resourceId: organization.id,
      metadata: { change: "ORGANIZATION_CREATED" },
    });
    const firstAdmin = await this.inviteFirstAdmin(tx, ctx, organization, body.firstAdmin, auth.userId);
    return {
      data: { organization: organizationDto(organization), firstAdmin },
      version: organization.version,
      resource: { type: "Organization", id: organization.id },
    };
  }

  async get(ctx: RequestContext, id: string): Promise<OperationResult> {
    const organization = await requireTx(ctx).organization.findUnique({ where: { id } });
    if (organization === null) throw notFound("ORGANIZATION_NOT_FOUND");
    return { data: organizationDto(organization), version: organization.version };
  }

  async update(
    ctx: RequestContext,
    id: string,
    body: z.output<typeof OrganizationUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    await lockRow(tx, "Organization", id);
    const current = await tx.organization.findUnique({ where: { id } });
    if (current === null) throw notFound("ORGANIZATION_NOT_FOUND");
    if (body.status !== undefined && auth.scope !== "platform")
      throw new ApiError(
        "PERMISSION_DENIED",
        "Only platform operations can change an organization's status.",
      );
    checkVersion(ctx, current.version);
    const updated = await tx.organization.update({
      where: { id },
      data: { ...present({ name: body.name, status: body.status }), version: { increment: 1 } },
    });
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      organizationId: id,
      resourceType: "Organization",
      resourceId: id,
      metadata: { fields: Object.keys(defined(body)) },
    });
    return { data: organizationDto(updated), version: updated.version };
  }

  async bootstrapAdmin(
    ctx: RequestContext,
    organizationId: string,
    body: z.output<typeof FirstAdmin>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const organization = await tx.organization.findUnique({ where: { id: organizationId } });
    if (organization === null) throw notFound("ORGANIZATION_NOT_FOUND");
    const activeAdmins = await tx.userRole.count({
      where: {
        organizationId,
        roleId: ORGANIZATION_ADMIN,
        revokedAt: null,
        membership: { status: "ACTIVE" },
      },
    });
    if (activeAdmins > 0)
      throw new ApiError(
        "SEPARATION_OF_DUTIES",
        "The organization already has an active administrator; it manages its own users.",
      );
    const result = await this.inviteFirstAdmin(tx, ctx, organization, body, auth.userId);
    return { data: result, resource: { type: "User", id: result.userId } };
  }

  /**
   * Bootstrap of an organization's first ORGANIZATION_ADMIN (spec §4.5 rule 2):
   * the platform actor never targets itself, and the role carries no clinical
   * permission (the database refuses a clinical grant from the platform role).
   */
  private async inviteFirstAdmin(
    tx: Tx,
    ctx: RequestContext,
    organization: { id: string; name: string },
    admin: z.output<typeof FirstAdmin>,
    actorId: string,
  ): Promise<z.input<typeof AdminBootstrapResult>> {
    const email = admin.email.trim().toLowerCase();
    let user = await tx.user.findUnique({ where: { kind_email: { kind: "WORKFORCE", email } } });
    if (user?.id === actorId)
      throw new ApiError(
        "SEPARATION_OF_DUTIES",
        "A platform operator cannot make itself an organization administrator.",
      );
    if (user?.status === "DISABLED" || user?.status === "LOCKED")
      throw new ApiError("CONFLICT", "This account is disabled.");
    const createdUser = user === null;
    user ??= await tx.user.create({ data: { kind: "WORKFORCE", email, displayName: admin.displayName } });

    let membership = await tx.membership.findUnique({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    });
    if (membership?.status === "DISABLED")
      throw new ApiError("CONFLICT", "This person's membership is disabled.");
    membership ??= await tx.membership.create({
      data: { organizationId: organization.id, userId: user.id, status: "INVITED", invitedAt: new Date() },
    });
    const existingGrant = await tx.userRole.findFirst({
      where: {
        userId: user.id,
        organizationId: organization.id,
        roleId: ORGANIZATION_ADMIN,
        scope: "ORGANIZATION",
        revokedAt: null,
      },
    });
    const grant =
      existingGrant ??
      (await tx.userRole.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          roleId: ORGANIZATION_ADMIN,
          scope: "ORGANIZATION",
          assignedById: actorId,
        },
      }));
    let invitationExpiresAt = new Date();
    if (membership.status === "INVITED") {
      const invitation = await this.credentials.createInvitation(tx, {
        userId: user.id,
        email: user.email,
        organizationId: organization.id,
        organizationName: organization.name,
        createdById: actorId,
      });
      invitationExpiresAt = invitation.expiresAt;
      ctx.afterCommit.push(() => this.email.send(invitation.email));
    }
    await this.audit.writeMany(tx, ctx, [
      {
        action: "USER_CREATED",
        organizationId: organization.id,
        resourceType: "User",
        resourceId: user.id,
        metadata: { accountCreated: createdUser, bootstrap: true },
      },
      ...(existingGrant
        ? []
        : [
            {
              action: "ROLE_ASSIGNED" as const,
              organizationId: organization.id,
              resourceType: "UserRole",
              resourceId: grant.id,
              metadata: { roleKey: "ORGANIZATION_ADMIN", scope: "ORGANIZATION", targetUserId: user.id },
            },
          ]),
    ]);
    return {
      userId: user.id,
      membershipStatus: membership.status,
      invitationExpiresAt: iso(invitationExpiresAt),
    };
  }

  private async firstAdmin(tx: Tx, organizationId: string): Promise<z.input<typeof AdminBootstrapResult>> {
    const grant = await tx.userRole.findFirst({
      where: { organizationId, roleId: ORGANIZATION_ADMIN },
      orderBy: { assignedAt: "asc" },
    });
    if (grant === null) throw new Error("Organization without its first administrator");
    return this.bootstrapResult(tx, organizationId, grant.userId);
  }

  private async bootstrapResult(
    tx: Tx,
    organizationId: string,
    userId: string,
  ): Promise<z.input<typeof AdminBootstrapResult>> {
    const membership = await tx.membership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId, userId } },
    });
    const invitation = await tx.userToken.findFirst({
      where: { userId, organizationId, purpose: "INVITATION" },
      orderBy: { createdAt: "desc" },
      select: { expiresAt: true },
    });
    return {
      userId,
      membershipStatus: membership.status,
      invitationExpiresAt: iso(invitation?.expiresAt ?? membership.createdAt),
    };
  }

  // ---- Practices -------------------------------------------------------------

  async listPractices(
    ctx: RequestContext,
    query: { limit: number; cursor?: string },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const after = this.cursors.decode("practices", query.cursor);
    const rows = await tx.practice.findMany({
      where: after
        ? { OR: [{ name: { gt: after.k ?? "" } }, { name: after.k ?? "", id: { gt: after.id } }] }
        : {},
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows, query.limit, (p) =>
      this.cursors.encode("practices", { k: p.name, id: p.id }),
    );
    return { data: items.map(practiceDto), page };
  }

  async createPractice(ctx: RequestContext, body: z.output<typeof PracticeCreate>): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    requireOrganizationGrant(auth, "practice.manage");
    const organizationId = auth.organizationId ?? "";
    if (await tx.practice.findFirst({ where: { name: body.name }, select: { id: true } }))
      throw new ApiError("CONFLICT", "A practice with this name already exists.");
    const practice = await tx.practice.create({
      data: { organizationId, name: body.name, timezone: body.timezone },
    });
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      resourceType: "Practice",
      resourceId: practice.id,
      metadata: { change: "PRACTICE_CREATED" },
    });
    return { data: practiceDto(practice), version: practice.version };
  }

  async getPractice(ctx: RequestContext, id: string): Promise<OperationResult> {
    const practice = await requireTx(ctx).practice.findUnique({ where: { id } });
    if (practice === null) throw notFound("PRACTICE_NOT_FOUND");
    return { data: practiceDto(practice), version: practice.version };
  }

  async updatePractice(
    ctx: RequestContext,
    id: string,
    body: z.output<typeof PracticeUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "Practice", id);
    const current = await tx.practice.findUnique({ where: { id } });
    if (current === null) throw notFound("PRACTICE_NOT_FOUND");
    requireScopedPermission(requireAuth(ctx), "practice.manage", {
      scope: "PRACTICE",
      practiceId: id,
      locationId: null,
    });
    checkVersion(ctx, current.version);
    if (body.name !== undefined && body.name !== current.name) {
      if (await tx.practice.findFirst({ where: { name: body.name, NOT: { id } }, select: { id: true } }))
        throw new ApiError("CONFLICT", "A practice with this name already exists.");
    }
    const updated = await tx.practice.update({
      where: { id },
      data: { ...present(body), version: { increment: 1 } },
    });
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      resourceType: "Practice",
      resourceId: id,
      metadata: { fields: Object.keys(defined(body)) },
    });
    return { data: practiceDto(updated), version: updated.version };
  }

  // ---- Locations -------------------------------------------------------------

  async listLocations(
    ctx: RequestContext,
    query: { limit: number; cursor?: string; practiceId?: string },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const after = this.cursors.decode("locations", query.cursor);
    const rows = await tx.location.findMany({
      where: {
        ...(query.practiceId ? { practiceId: query.practiceId } : {}),
        ...(after
          ? { OR: [{ name: { gt: after.k ?? "" } }, { name: after.k ?? "", id: { gt: after.id } }] }
          : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows, query.limit, (l) =>
      this.cursors.encode("locations", { k: l.name, id: l.id }),
    );
    return { data: items.map(locationDto), page };
  }

  async createLocation(ctx: RequestContext, body: z.output<typeof LocationCreate>): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const practice = await tx.practice.findUnique({ where: { id: body.practiceId } });
    if (practice === null) throw notFound("PRACTICE_NOT_FOUND");
    requireScopedPermission(auth, "practice.manage", {
      scope: "PRACTICE",
      practiceId: practice.id,
      locationId: null,
    });
    const location = await tx.location.create({
      data: {
        organizationId: practice.organizationId,
        practiceId: practice.id,
        name: body.name,
        timezone: body.timezone,
        addressLine1: body.addressLine1 ?? null,
        addressLine2: body.addressLine2 ?? null,
        city: body.city ?? null,
        region: body.region ?? null,
        postalCode: body.postalCode ?? null,
        countryCode: body.countryCode ?? null,
      },
    });
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      resourceType: "Location",
      resourceId: location.id,
      metadata: { change: "LOCATION_CREATED", practiceId: practice.id },
    });
    return { data: locationDto(location), version: location.version };
  }

  async getLocation(ctx: RequestContext, id: string): Promise<OperationResult> {
    const location = await requireTx(ctx).location.findUnique({ where: { id } });
    if (location === null) throw notFound("LOCATION_NOT_FOUND");
    return { data: locationDto(location), version: location.version };
  }

  async updateLocation(
    ctx: RequestContext,
    id: string,
    body: z.output<typeof LocationUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "Location", id);
    const current = await tx.location.findUnique({ where: { id } });
    if (current === null) throw notFound("LOCATION_NOT_FOUND");
    requireScopedPermission(requireAuth(ctx), "practice.manage", {
      scope: "LOCATION",
      practiceId: current.practiceId,
      locationId: id,
    });
    checkVersion(ctx, current.version);
    const updated = await tx.location.update({
      where: { id },
      data: { ...present(body), version: { increment: 1 } },
    });
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      resourceType: "Location",
      resourceId: id,
      metadata: { fields: Object.keys(body) },
    });
    return { data: locationDto(updated), version: updated.version };
  }
}
