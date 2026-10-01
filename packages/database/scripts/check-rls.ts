// Compares the live database with src/ownership.ts and the security rules of
// ADR-0018 K-06, K-16 and K-18. Run after the migrations, against a database
// built from them. Reads the system catalogs only.
//
// Usage: DATABASE_URL=… node scripts/check-rls.ts
import pg from "pg";
import { TABLE_OWNERSHIP, TENANT_CLASSES } from "../src/ownership.ts";

const APP_ROLES = [
  "aestara_app",
  "aestara_platform",
  "aestara_signin",
  "aestara_worker",
  "aestara_protocol_seed",
];
/**
 * Tables the application may delete from (ADR-0018 K-18: never clinical or audit
 * rows). A draft protocol's views and a photo's tags are replaced as sets.
 */
const APP_DELETABLE = new Set([
  "UserToken",
  "PatientContact",
  "IdempotencyKey",
  "PhotographyProtocolView",
  "PhotoTag",
]);
/**
 * The SECURITY DEFINER functions, their owners and who may call them: the
 * pre-tenant sign-in lookup (K-16) and the standard-protocol seed that the
 * platform's organization bootstrap calls (ADR-0023 K2-11).
 */
const SECURITY_DEFINER_FUNCTIONS: Record<string, { owner: string; executors: string[] }> = {
  app_seed_standard_protocols: { owner: "aestara_protocol_seed", executors: ["aestara_platform"] },
  auth_sign_in_memberships: { owner: "aestara_signin", executors: ["aestara_app"] },
};
/** What the worker role may reach across tenants (ADR-0023 K2-07); anything else fails. */
const WORKER_REACH: Record<string, string[]> = {
  OutboxEvent: ["SELECT", "UPDATE"],
  AuditEvent: ["SELECT"],
  Organization: ["SELECT"],
  StorageObject: ["SELECT"],
  AIJob: ["SELECT"],
};
/** The protocol seed role touches the two protocol tables only. */
const PROTOCOL_SEED_REACH = new Set(["PhotographyProtocol", "PhotographyProtocolView"]);

const failures: string[] = [];
const fail = (message: string) => failures.push(message);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const tables = await client.query<{
    name: string;
    rls: boolean;
    forced: boolean;
    policies: number;
  }>(`
    SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`);

  const live = new Map(tables.rows.map((t) => [t.name, t]));
  for (const name of live.keys()) {
    if (!TABLE_OWNERSHIP.some((t) => t.table === name)) fail(`table ${name} has no ownership classification`);
  }
  for (const entry of TABLE_OWNERSHIP) {
    const table = live.get(entry.table);
    if (!table) {
      fail(`classified table ${entry.table} does not exist`);
      continue;
    }
    if (TENANT_CLASSES.includes(entry.class)) {
      if (!table.rls || !table.forced || table.policies === 0) {
        fail(`${entry.table} (${entry.class}) must have forced Row-Level Security with a policy`);
      }
    } else if (entry.class === "identity" && table.rls) {
      fail(`${entry.table} is a platform-level identity table and must not use Row-Level Security`);
    } else if (entry.class === "catalog" && table.forced) {
      fail(`${entry.table} is catalog data; forcing Row-Level Security would block catalog migrations`);
    }
  }

  const roles = await client.query<{ rolname: string; bad: boolean }>(
    `SELECT rolname, (rolsuper OR rolbypassrls OR rolcanlogin) AS bad FROM pg_roles WHERE rolname = ANY($1)`,
    [APP_ROLES],
  );
  for (const role of APP_ROLES) {
    const row = roles.rows.find((r) => r.rolname === role);
    if (!row) fail(`role ${role} is missing`);
    else if (row.bad) fail(`role ${role} must be NOLOGIN, NOSUPERUSER and NOBYPASSRLS`);
  }

  const grants = await client.query<{ grantee: string; table_name: string; privilege_type: string }>(`
    SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
    UNION
    SELECT grantee, table_name, privilege_type FROM information_schema.column_privileges
    WHERE table_schema = 'public'`);
  for (const g of grants.rows) {
    if (g.grantee === "PUBLIC") fail(`${g.table_name}: ${g.privilege_type} is granted to PUBLIC`);
    if (g.table_name === "_prisma_migrations" && APP_ROLES.includes(g.grantee)) {
      fail(`${g.grantee} must not reach _prisma_migrations`);
    }
    const entry = TABLE_OWNERSHIP.find((t) => t.table === g.table_name);
    if (g.grantee === "aestara_platform" && entry?.platform === "none") {
      fail(`aestara_platform holds ${g.privilege_type} on ${g.table_name} (ADR-0018 K-06)`);
    }
    if (g.grantee === "aestara_app" && g.privilege_type === "DELETE" && !APP_DELETABLE.has(g.table_name)) {
      fail(`aestara_app may not delete from ${g.table_name}`);
    }
    if (g.grantee === "aestara_worker" && !(WORKER_REACH[g.table_name] ?? []).includes(g.privilege_type)) {
      fail(`aestara_worker holds ${g.privilege_type} on ${g.table_name} (ADR-0023 K2-07)`);
    }
    if (g.grantee === "aestara_protocol_seed" && !PROTOCOL_SEED_REACH.has(g.table_name)) {
      fail(`aestara_protocol_seed holds ${g.privilege_type} on ${g.table_name}`);
    }
    if (
      ["AuditEvent", "LoginEvent"].includes(g.table_name) &&
      APP_ROLES.includes(g.grantee) &&
      !["SELECT", "INSERT"].includes(g.privilege_type)
    ) {
      fail(`${g.grantee} holds ${g.privilege_type} on ledger ${g.table_name} (ADR-0018 K-18)`);
    }
  }

  const definers = await client.query<{ proname: string; owner: string; executors: string[] }>(`
    SELECT p.proname, pg_get_userbyid(p.proowner) AS owner,
           ARRAY(SELECT (CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END)::text
                 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner ORDER BY 1) AS executors
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef`);
  const names = definers.rows.map((d) => d.proname).sort();
  const expected = Object.keys(SECURITY_DEFINER_FUNCTIONS).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    fail(`SECURITY DEFINER functions must be exactly ${expected.join(", ")}; found ${names.join(", ")}`);
  }
  for (const d of definers.rows) {
    const want = SECURITY_DEFINER_FUNCTIONS[d.proname];
    if (want === undefined) continue;
    if (d.owner !== want.owner) fail(`${d.proname} must be owned by ${want.owner}, not ${d.owner}`);
    if (JSON.stringify(d.executors) !== JSON.stringify(want.executors)) {
      fail(
        `${d.proname} must be executable by ${want.executors.join(", ")} only; found ${d.executors.join(", ")}`,
      );
    }
  }
} finally {
  await client.end();
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL  ${f}`);
  process.exit(1);
}
console.log(
  `PASS  ${TABLE_OWNERSHIP.length} tables match their ownership classification; roles, grants and RLS as specified`,
);
