// Compares the live database with src/ownership.ts and the security rules of
// ADR-0018 K-06, K-16 and K-18. Run after the migrations, against a database
// built from them. Reads the system catalogs only.
//
// Usage: DATABASE_URL=… node scripts/check-rls.ts
import pg from "pg";
import { TABLE_OWNERSHIP, TENANT_CLASSES } from "../src/ownership.ts";

const APP_ROLES = ["aestara_app", "aestara_platform", "aestara_signin"];
/** Tables the application may delete from (ADR-0018 K-18: never clinical or audit rows). */
const APP_DELETABLE = new Set(["UserToken", "PatientContact", "IdempotencyKey"]);
/** The single pre-tenant path (K-16). */
const SECURITY_DEFINER_FUNCTIONS = ["auth_sign_in_memberships"];

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
  if (JSON.stringify(names) !== JSON.stringify(SECURITY_DEFINER_FUNCTIONS)) {
    fail(
      `SECURITY DEFINER functions must be exactly ${SECURITY_DEFINER_FUNCTIONS.join(", ")}; found ${names.join(", ")}`,
    );
  }
  for (const d of definers.rows) {
    if (d.owner !== "aestara_signin") fail(`${d.proname} must be owned by aestara_signin, not ${d.owner}`);
    if (JSON.stringify(d.executors) !== JSON.stringify(["aestara_app"])) {
      fail(`${d.proname} must be executable by aestara_app only; found ${d.executors.join(", ")}`);
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
