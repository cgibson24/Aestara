// Explicit tenant filtering, in addition to Row-Level Security (spec §4.6
// "load resource WITH organizationId = org"; CLAUDE.md "enforce tenancy
// server-side"). Every Prisma query on a tenant table inside a tenant
// transaction gets `organizationId = <tenant>`, and every create gets the
// tenant's ID or fails. RLS stays the backstop that holds even if this layer
// were bypassed; together they are defence in depth, and the explicit filter
// lets PostgreSQL use the tenant-leading indexes directly.
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@aestara/database";

export const tenantStore = new AsyncLocalStorage<{ readonly organizationId: string } | undefined>();

/** Runs `fn` with the tenant the query filter applies (or none). */
export function withTenantFilter<T>(organizationId: string | null, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run(organizationId === null ? undefined : { organizationId }, fn);
}

/** Tables owned by an organization (src/ownership.ts tenant classes). Session, UserToken and LoginEvent are identity data. */
const TENANT_MODELS = new Set([
  "Practice",
  "Location",
  "Membership",
  "UserRole",
  "OrganizationSetting",
  "ProviderProfile",
  "StaffProfile",
  "Patient",
  "PatientContact",
  "AuditEvent",
  "IdempotencyKey",
]);

const FILTERED = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

type Args = { where?: Record<string, unknown>; data?: unknown; create?: Record<string, unknown> };

function withCondition(where: Record<string, unknown> | undefined, condition: Record<string, unknown>) {
  const existing = where?.AND;
  const and = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
  return { ...(where ?? {}), AND: [...and, condition] };
}

function checkCreate(data: unknown, organizationId: string, model: string): void {
  for (const row of Array.isArray(data) ? data : [data]) {
    const value = (row as { organizationId?: unknown } | null)?.organizationId;
    // Audit events may be platform-level (null) and are refused by RLS otherwise.
    if (model === "AuditEvent" && value === null) continue;
    if (value !== organizationId) throw new Error(`Tenant mismatch on create in ${model}`);
  }
}

export const tenantFilter = Prisma.defineExtension({
  name: "tenant-filter",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const tenant = tenantStore.getStore();
        if (tenant === undefined) return query(args);
        const a = args as Args;
        if (model === "Organization") {
          if (FILTERED.has(operation)) a.where = withCondition(a.where, { id: tenant.organizationId });
          return query(a);
        }
        if (!TENANT_MODELS.has(model)) return query(args);
        if (FILTERED.has(operation))
          a.where = withCondition(a.where, { organizationId: tenant.organizationId });
        if (operation === "create" || operation === "createMany" || operation === "createManyAndReturn")
          checkCreate(a.data, tenant.organizationId, model);
        if (operation === "upsert") checkCreate(a.create, tenant.organizationId, model);
        return query(a);
      },
    },
  },
});
