// Local development seed (roadmap M1.1): one synthetic organization with a
// practice, a location and an invited ORGANIZATION_ADMIN. The permission
// catalog and system roles come from the migrations, not from here.
//
// Synthetic data only, never PHI. Refuses to run against anything but a local
// database. It connects as the local superuser from docker compose, sets the new
// organization as the tenant of its one transaction, and writes the audit events
// an administrator's actions would (actor SYSTEM, metadata.source "dev-seed").
//
// The printed invitation token is for local sign-in once staff invitations exist
// (M1.3, M1.6). The seed gives it 7 days; the product's invitation lifetime is
// decided in M1.6.
//
// Usage: DATABASE_URL=postgresql://aestara:aestara_local_only@localhost:5432/aestara node scripts/seed-dev.ts
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { catalogId } from "../src/catalog.ts";
import { createPrismaClient } from "../src/client.ts";
import { uuidv7 } from "../src/ids.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);
const SLUG = "synthetic-demo";
const ADMIN_EMAIL = "admin@synthetic-demo.test";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL (see the usage line at the top of this file)");
if (process.env.NODE_ENV === "production" || !LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error("The development seed runs only against a local database");
}

const prisma = createPrismaClient(url);
try {
  const organizationId = uuidv7();
  const token = randomBytes(32).toString("base64url");
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    // The local superuser sees every organization, so this finds an earlier seed.
    if (await tx.organization.findUnique({ where: { slug: SLUG } })) return false;

    const requestId = randomUUID();
    const organization = await tx.organization.create({
      data: { id: organizationId, name: "Synthetic Demo Organization", slug: SLUG },
    });
    // The Bible §6.2 standard photography protocols (ADR-0023 K2-11), as the bootstrap seeds them.
    await tx.$queryRaw`SELECT app_seed_standard_protocols(${organizationId}::uuid)`;
    const practice = await tx.practice.create({
      data: { organizationId, name: "Synthetic Demo Practice", timezone: "America/New_York" },
    });
    await tx.location.create({
      data: {
        organizationId,
        practiceId: practice.id,
        name: "Main Street",
        timezone: "America/New_York",
        city: "Springfield",
        region: "IL",
        countryCode: "US",
      },
    });
    const admin = await tx.user.create({
      data: { kind: "WORKFORCE", email: ADMIN_EMAIL, displayName: "Demo Admin" },
    });
    await tx.membership.create({ data: { organizationId, userId: admin.id, invitedAt: new Date() } });
    const grant = await tx.userRole.create({
      data: {
        userId: admin.id,
        organizationId,
        roleId: catalogId("role", "ORGANIZATION_ADMIN"),
        scope: "ORGANIZATION",
      },
    });
    await tx.userToken.create({
      data: {
        userId: admin.id,
        purpose: "INVITATION",
        tokenHash: createHash("sha256").update(token).digest("hex"),
        organizationId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const audit = (
      action: "CONFIGURATION_CHANGED" | "USER_CREATED" | "ROLE_ASSIGNED",
      resourceType: string,
      id: string,
    ) => ({
      organizationId,
      actorType: "SYSTEM" as const,
      action,
      resourceType,
      resourceId: id,
      requestId,
      metadata: { source: "dev-seed" },
    });
    await tx.auditEvent.createMany({
      data: [
        audit("CONFIGURATION_CHANGED", "Organization", organization.id),
        audit("USER_CREATED", "User", admin.id),
        audit("ROLE_ASSIGNED", "UserRole", grant.id),
      ],
    });
    return true;
  });

  if (created) {
    console.log(`Seeded "${SLUG}" with an invited ORGANIZATION_ADMIN <${ADMIN_EMAIL}>.`);
    console.log(`Local invitation token (valid 7 days, shown once): ${token}`);
  } else {
    console.log(`"${SLUG}" already exists; nothing to do.`);
  }
} finally {
  await prisma.$disconnect();
}
