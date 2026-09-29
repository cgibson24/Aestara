// Row-Level Security performance gate (spec §3.5; ADR-0004; ADR-0018 K-16).
//
// Builds a throwaway database from the migrations, loads synthetic data (no PHI)
// and times the database work of the three core requests, with and without RLS:
//   login           user lookup, credential, memberships, ledger, session, audit
//   patient search  session, membership, grants, trigram name search (25 rows)
//   patient open    session, membership, grants, patient, contacts, PATIENT_VIEWED
// Three modes, each on its own connection:
//   baseline  a role with the application role's privileges plus BYPASSRLS (not a
//             superuser, which would also skip permission checks), running the same
//             statements with the same explicit organizationId filters the
//             tenant-scoped repositories add anyway, in a transaction
//   rls       the application role; the tenant is set by a separate set_config
//             statement; memberships come from the sign-in lookup function
//   tuned     as rls, but the tenant is set in the same round trip as BEGIN, and
//             patient search runs through a tenant-bound SECURITY DEFINER function
//             (created in the benchmark database only), because LIKE and lower()
//             are not leakproof: under RLS the planner may not use them in index
//             conditions ahead of the policy, so a plain search scans the whole
//             organization
// Rounds rotate the order of the modes so drift affects all of them equally.
//
// Gate, per request: added p95 ≤ 10% and ≤ 5 ms. The database work is only part
// of an endpoint's latency, so passing here is stricter than the endpoint gate;
// M1.8 repeats the measurement end to end through the api.
//
// Usage: ADMIN_DATABASE_URL=postgresql://superuser:pw@host:5432/postgres node scripts/bench-rls.ts [--out file.json] [--report-only]
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ORGANIZATIONS = 20;
const STAFF_PER_ORGANIZATION = 25;
const PATIENTS_PER_ORGANIZATION = 5_000;
const AUDIT_EVENTS_PER_ORGANIZATION = 10_000;
const WARMUP = 300;
const ROUNDS = 20;
const PER_ROUND = 300;
const MAX_ADDED_RATIO = 0.1;
const MAX_ADDED_MS = 5;

const adminUrl = process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error("Set ADMIN_DATABASE_URL to a superuser connection");
const here = dirname(fileURLToPath(import.meta.url));
const outIndex = process.argv.indexOf("--out");
const outFile = outIndex > 0 ? process.argv[outIndex + 1] : undefined;

const dbName = `aestara_bench_${Date.now()}`;
const dbUrl = `${adminUrl.slice(0, adminUrl.lastIndexOf("/"))}/${dbName}`;

/** Deterministic PRNG (mulberry32) so both modes see the same request sequence. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOAD_SQL = `
INSERT INTO "Organization" (id, name, slug, "updatedAt")
SELECT md5('org' || g)::uuid, 'Synthetic Organization ' || g, 'synthetic-' || g, now()
FROM generate_series(1, ${ORGANIZATIONS}) g;

INSERT INTO "Practice" (id, "organizationId", name, timezone, "updatedAt")
SELECT md5('practice' || o.id || p)::uuid, o.id, 'Practice ' || p, 'America/New_York', now()
FROM "Organization" o, generate_series(1, 2) p;

INSERT INTO "Location" (id, "organizationId", "practiceId", name, timezone, "updatedAt")
SELECT md5('location' || pr.id)::uuid, pr."organizationId", pr.id, 'Main location', 'America/New_York', now()
FROM "Practice" pr;

INSERT INTO "User" (id, kind, email, status, "updatedAt")
SELECT md5('user' || o.id || n)::uuid, 'WORKFORCE', format('staff-%s-%s@synthetic.test', o.slug, n), 'ACTIVE', now()
FROM "Organization" o, generate_series(1, ${STAFF_PER_ORGANIZATION}) n;

INSERT INTO "UserCredential" (id, "userId", type, "passwordHash")
SELECT gen_random_uuid(), u.id, 'PASSWORD', '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic' FROM "User" u;

INSERT INTO "Membership" (id, "organizationId", "userId", status, "updatedAt")
SELECT gen_random_uuid(), o.id, md5('user' || o.id || n)::uuid, 'ACTIVE', now()
FROM "Organization" o, generate_series(1, ${STAFF_PER_ORGANIZATION}) n;

INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope, "practiceId")
SELECT gen_random_uuid(), md5('user' || o.id || n)::uuid, o.id,
       (SELECT id FROM "Role" WHERE "organizationId" IS NULL AND key =
          CASE WHEN n = 1 THEN 'ORGANIZATION_ADMIN' WHEN n % 3 = 0 THEN 'FRONT_DESK'
               WHEN n % 3 = 1 THEN 'SURGEON_PHYSICIAN' ELSE 'NURSE_INJECTOR_AESTHETICIAN' END),
       CASE WHEN n % 3 = 0 THEN 'PRACTICE'::"RoleAssignmentScope" ELSE 'ORGANIZATION'::"RoleAssignmentScope" END,
       CASE WHEN n % 3 = 0 THEN md5('practice' || o.id || 1)::uuid END
FROM "Organization" o, generate_series(1, ${STAFF_PER_ORGANIZATION}) n;

INSERT INTO "OrganizationSetting" (id, "organizationId", key, value, "updatedAt")
SELECT gen_random_uuid(), o.id, 'security.mfaPolicy', '"synthetic"', now() FROM "Organization" o;

INSERT INTO "Session" (id, "userId", "organizationId", "clientApp", "refreshTokenHash", "idleExpiresAt", "absoluteExpiresAt")
SELECT md5('session' || m."userId")::uuid, m."userId", m."organizationId", 'IOS_PROVIDER', md5(random()::text),
       now() + interval '8 hours', now() + interval '7 days'
FROM "Membership" m;

INSERT INTO "Patient" (id, "organizationId", "primaryPracticeId", "firstName", "lastName", "dateOfBirth", mrn, "updatedAt")
SELECT md5('patient' || o.id || n)::uuid, o.id, md5('practice' || o.id || (1 + n % 2))::uuid,
       (ARRAY['Avery','Blake','Casey','Drew','Emery','Finley','Gray','Harper','Indigo','Jordan',
              'Kai','Logan','Morgan','Noel','Oakley','Parker','Quinn','Reese','Sage','Taylor'])[1 + n % 20],
       (ARRAY['Al','Bar','Cor','Dun','El','Far','Gar','Hol','Ing','Jen','Kel','Lor','Mar','Nor','Or',
              'Pem','Quin','Ros','Sel','Tor'])[1 + (n / 20) % 20]
         || (ARRAY['ton','well','by','ford','man','son','ley','wood','field','more'])[1 + (n / 400) % 10],
       date '1950-01-01' + (n * 7919) % 20000, 'MRN-' || n, now()
FROM "Organization" o, generate_series(1, ${PATIENTS_PER_ORGANIZATION}) n;

INSERT INTO "PatientContact" (id, "organizationId", "patientId", kind, "fullName", "updatedAt")
SELECT gen_random_uuid(), p."organizationId", p.id, 'EMERGENCY_CONTACT', 'Synthetic contact', now() FROM "Patient" p;

INSERT INTO "AuditEvent" (id, "organizationId", "actorType", "actorServiceId", action, "resourceType", "requestId", "occurredAt")
SELECT gen_random_uuid(), o.id, 'SERVICE', 'synthetic', 'PATIENT_VIEWED', 'Patient', 'req-' || n, now() - n * interval '1 minute'
FROM "Organization" o, generate_series(1, ${AUDIT_EVENTS_PER_ORGANIZATION}) n;

ANALYZE;
`;

interface Fixture {
  organizations: string[];
  staff: Map<string, { userId: string; email: string; sessionId: string }[]>;
  patients: Map<string, string[]>;
  searchTerms: string[];
}

async function loadFixture(client: pg.Client): Promise<Fixture> {
  const orgs = (await client.query<{ id: string }>(`SELECT id FROM "Organization" ORDER BY slug`)).rows.map(
    (r) => r.id,
  );
  const staff = new Map<string, { userId: string; email: string; sessionId: string }[]>();
  for (const row of (
    await client.query<{ org: string; user_id: string; email: string; session_id: string }>(
      `SELECT m."organizationId" AS org, u.id AS user_id, u.email, s.id AS session_id
       FROM "Membership" m JOIN "User" u ON u.id = m."userId" JOIN "Session" s ON s."userId" = u.id`,
    )
  ).rows) {
    const list = staff.get(row.org) ?? [];
    list.push({ userId: row.user_id, email: row.email, sessionId: row.session_id });
    staff.set(row.org, list);
  }
  const patients = new Map<string, string[]>();
  for (const row of (
    await client.query<{ org: string; id: string }>(`SELECT "organizationId" AS org, id FROM "Patient"`)
  ).rows) {
    const list = patients.get(row.org) ?? [];
    list.push(row.id);
    patients.set(row.org, list);
  }
  const searchTerms = ["arton", "kelwo", "sel", "orby", "quinfi", "man", "holt", "pemm", "rosley", "dunf"];
  return { organizations: orgs, staff, patients, searchTerms };
}

type Mode = "baseline" | "rls" | "tuned";
const MODES: readonly Mode[] = ["baseline", "rls", "tuned"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Workload = (client: pg.Client, mode: Mode, pick: () => number) => Promise<void>;

function choose<T>(list: readonly T[], pick: () => number): T {
  return list[Math.floor(pick() * list.length)] as T;
}

const BASELINE_MEMBERSHIPS = `
  SELECT o.id, o.name, o.status::text, m.status::text,
         (SELECT s.value FROM "OrganizationSetting" s WHERE s."organizationId" = o.id AND s.key = 'security.mfaPolicy'),
         ARRAY(SELECT DISTINCT r.key FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
               WHERE ur."organizationId" = o.id AND ur."userId" = $1 AND ur."revokedAt" IS NULL ORDER BY r.key)
  FROM "Membership" m JOIN "Organization" o ON o.id = m."organizationId" WHERE m."userId" = $1`;

async function begin(client: pg.Client, mode: Mode, org: string): Promise<void> {
  if (mode === "tuned") {
    // One round trip; the identifier is validated, so inlining it is safe.
    if (!UUID.test(org)) throw new Error("invalid organization id");
    await client.query(`BEGIN; SELECT set_config('app.organization_id', '${org}', true)`);
    return;
  }
  await client.query("BEGIN");
  if (mode === "rls") await client.query("SELECT set_config('app.organization_id', $1, true)", [org]);
}

async function guard(
  client: pg.Client,
  org: string,
  user: { userId: string; sessionId: string },
): Promise<void> {
  await client.query(
    `SELECT id, "userId", "organizationId", "revokedAt", "idleExpiresAt", "absoluteExpiresAt" FROM "Session" WHERE id = $1`,
    [user.sessionId],
  );
  await client.query(`SELECT status FROM "Membership" WHERE "organizationId" = $1 AND "userId" = $2`, [
    org,
    user.userId,
  ]);
  await client.query(
    `SELECT DISTINCT p.key FROM "UserRole" ur JOIN "RolePermission" rp ON rp."roleId" = ur."roleId"
     JOIN "Permission" p ON p.id = rp."permissionId"
     WHERE ur."organizationId" = $1 AND ur."userId" = $2 AND ur."revokedAt" IS NULL`,
    [org, user.userId],
  );
}

function workloads(f: Fixture): Record<string, Workload> {
  return {
    login: async (client, mode, pick) => {
      const org = choose(f.organizations, pick);
      const user = choose(f.staff.get(org) ?? [], pick);
      await client.query("BEGIN");
      await client.query(`SELECT id, status FROM "User" WHERE kind = 'WORKFORCE' AND email = $1`, [
        user.email,
      ]);
      await client.query(
        `SELECT "passwordHash" FROM "UserCredential" WHERE "userId" = $1 AND type = 'PASSWORD' AND "revokedAt" IS NULL`,
        [user.userId],
      );
      await client.query(
        mode === "baseline" ? BASELINE_MEMBERSHIPS : "SELECT * FROM auth_sign_in_memberships($1)",
        [user.userId],
      );
      if (mode !== "baseline")
        await client.query("SELECT set_config('app.organization_id', $1, true)", [org]);
      await client.query(
        `INSERT INTO "LoginEvent" (id, "eventType", "userId", "organizationId", "clientApp", "requestId")
         VALUES ($1, 'LOGIN_SUCCESS', $2, $3, 'IOS_PROVIDER', $4)`,
        [randomUUID(), user.userId, org, randomUUID()],
      );
      await client.query(
        `INSERT INTO "Session" (id, "userId", "organizationId", "clientApp", "refreshTokenHash", "idleExpiresAt", "absoluteExpiresAt")
         VALUES ($1, $2, $3, 'IOS_PROVIDER', $4, now() + interval '8 hours', now() + interval '7 days')`,
        [randomUUID(), user.userId, org, randomUUID()],
      );
      await client.query(
        `INSERT INTO "AuditEvent" (id, "organizationId", "actorType", "actorUserId", action, "resourceType", "resourceId", "requestId")
         VALUES ($1, $2, 'USER', $3, 'LOGIN_SUCCESS', 'Session', $1, $4)`,
        [randomUUID(), org, user.userId, randomUUID()],
      );
      await client.query(`UPDATE "User" SET "lastLoginAt" = now() WHERE id = $1`, [user.userId]);
      await client.query("COMMIT");
    },
    "patient search": async (client, mode, pick) => {
      const org = choose(f.organizations, pick);
      const user = choose(f.staff.get(org) ?? [], pick);
      await begin(client, mode, org);
      await guard(client, org, user);
      const term = choose(f.searchTerms, pick);
      if (mode === "tuned") {
        await client.query("SELECT * FROM bench_patient_search($1, 25)", [term]);
      } else {
        await client.query(
          `SELECT id, "firstName", "lastName", "dateOfBirth", mrn, status FROM "Patient"
           WHERE "organizationId" = $1 AND lower("lastName") LIKE '%' || $2 || '%'
           ORDER BY "lastName", "firstName", id LIMIT 25`,
          [org, term],
        );
      }
      await client.query("COMMIT");
    },
    "patient open": async (client, mode, pick) => {
      const org = choose(f.organizations, pick);
      const user = choose(f.staff.get(org) ?? [], pick);
      const patient = choose(f.patients.get(org) ?? [], pick);
      await begin(client, mode, org);
      await guard(client, org, user);
      await client.query(`SELECT * FROM "Patient" WHERE "organizationId" = $1 AND id = $2`, [org, patient]);
      await client.query(`SELECT * FROM "PatientContact" WHERE "organizationId" = $1 AND "patientId" = $2`, [
        org,
        patient,
      ]);
      await client.query(
        `INSERT INTO "AuditEvent" (id, "organizationId", "actorType", "actorUserId", action, "resourceType", "resourceId", "patientId", "requestId")
         VALUES ($1, $2, 'USER', $3, 'PATIENT_VIEWED', 'Patient', $4, $4, $5)`,
        [randomUUID(), org, user.userId, patient, randomUUID()],
      );
      await client.query("COMMIT");
    },
  };
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.NaN;
}

// Benchmark database only: the tenant-bound search function the "tuned" mode
// measures. It is not part of the migrations.
const BENCH_SEARCH_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aestara_bench_baseline') THEN
    CREATE ROLE aestara_bench_baseline NOLOGIN BYPASSRLS;
  END IF;
END $$;
GRANT aestara_app TO aestara_bench_baseline;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aestara_bench_search') THEN
    CREATE ROLE aestara_bench_search NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT SELECT ON "Patient" TO aestara_bench_search;
CREATE POLICY bench_search ON "Patient" FOR SELECT TO aestara_bench_search USING (true);
CREATE FUNCTION bench_patient_search(p_term text, p_limit int)
RETURNS TABLE (id uuid, first_name text, last_name text, date_of_birth date, mrn text, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET plan_cache_mode = force_custom_plan AS $f$
BEGIN
  RETURN QUERY
  SELECT p.id, p."firstName", p."lastName", p."dateOfBirth"::date, p.mrn, p.status::text FROM "Patient" p
  WHERE p."organizationId" = app_current_organization_id() AND lower(p."lastName") LIKE '%' || p_term || '%'
  ORDER BY p."lastName", p."firstName", p.id LIMIT p_limit;
END $f$;
GRANT CREATE ON SCHEMA public TO aestara_bench_search;
ALTER FUNCTION bench_patient_search(text, int) OWNER TO aestara_bench_search;
REVOKE CREATE ON SCHEMA public FROM aestara_bench_search;
REVOKE ALL ON FUNCTION bench_patient_search(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bench_patient_search(text, int) TO aestara_app;
`;

interface Row {
  request: string;
  mode: Exclude<Mode, "baseline">;
  baselineP50: number;
  p50: number;
  baselineP95: number;
  p95: number;
  addedMs: number;
  addedRatio: number;
  pass: boolean;
}

async function run(): Promise<number> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: join(here, ".."),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "ignore",
    });
    const setup = new pg.Client({ connectionString: dbUrl });
    await setup.connect();
    const loadStart = performance.now();
    await setup.query(LOAD_SQL);
    await setup.query(BENCH_SEARCH_SQL);
    const fixture = await loadFixture(setup);
    const version = (await setup.query<{ v: string }>("SELECT current_setting('server_version') AS v"))
      .rows[0]?.v;
    await setup.end();
    console.log(
      `Loaded ${ORGANIZATIONS} organizations, ${ORGANIZATIONS * PATIENTS_PER_ORGANIZATION} patients, ` +
        `${ORGANIZATIONS * AUDIT_EVENTS_PER_ORGANIZATION} audit events in ${((performance.now() - loadStart) / 1000).toFixed(1)} s ` +
        `(PostgreSQL ${version})`,
    );

    // One connection per mode; the RLS modes act as the application role.
    const clients = Object.fromEntries(
      MODES.map((m) => [m, new pg.Client({ connectionString: dbUrl })]),
    ) as Record<Mode, pg.Client>;
    for (const mode of MODES) {
      await clients[mode].connect();
      await clients[mode].query(
        mode === "baseline" ? "SET ROLE aestara_bench_baseline" : "SET ROLE aestara_app",
      );
    }

    const results: Record<string, Record<Mode, number[]>> = {};
    for (const [name, workload] of Object.entries(workloads(fixture))) {
      const samples: Record<Mode, number[]> = { baseline: [], rls: [], tuned: [] };
      for (const mode of MODES) {
        const pick = prng(7);
        for (let i = 0; i < WARMUP; i++) await workload(clients[mode], mode, pick);
      }
      for (let round = 0; round < ROUNDS; round++) {
        const order = MODES.map((_, i) => MODES[(i + round) % MODES.length] as Mode);
        for (const mode of order) {
          const pick = prng(1000 + round);
          for (let i = 0; i < PER_ROUND; i++) {
            const start = performance.now();
            await workload(clients[mode], mode, pick);
            samples[mode].push(performance.now() - start);
          }
        }
      }
      results[name] = samples;
    }
    for (const mode of MODES) await clients[mode].end();

    const rows: Row[] = [];
    for (const [request, samples] of Object.entries(results)) {
      const base = [...samples.baseline].sort((a, b) => a - b);
      for (const mode of ["rls", "tuned"] as const) {
        const sorted = [...samples[mode]].sort((a, b) => a - b);
        const baselineP95 = percentile(base, 95);
        const p95 = percentile(sorted, 95);
        const addedMs = p95 - baselineP95;
        const addedRatio = addedMs / baselineP95;
        rows.push({
          request,
          mode,
          baselineP50: percentile(base, 50),
          p50: percentile(sorted, 50),
          baselineP95,
          p95,
          addedMs,
          addedRatio,
          pass: addedMs <= MAX_ADDED_MS && addedRatio <= MAX_ADDED_RATIO,
        });
      }
    }
    const ms = (v: number) => v.toFixed(3);
    console.log(`\n${ROUNDS * PER_ROUND} samples per request and mode (after ${WARMUP} warm-up)\n`);
    console.log("| Request | Mode | p50 baseline | p50 | p95 baseline | p95 | Added p95 | Gate |");
    console.log("|---|---|---|---|---|---|---|---|");
    for (const r of rows) {
      console.log(
        `| ${r.request} | ${r.mode} | ${ms(r.baselineP50)} ms | ${ms(r.p50)} ms | ${ms(r.baselineP95)} ms | ${ms(r.p95)} ms | ` +
          `${ms(r.addedMs)} ms (${(r.addedRatio * 100).toFixed(1)}%) | ${r.pass ? "PASS" : "FAIL"} |`,
      );
    }
    if (outFile) {
      writeFileSync(
        outFile,
        `${JSON.stringify({ postgres: version, samples: ROUNDS * PER_ROUND, rows }, null, 2)}\n`,
      );
    }
    // The gate applies to the design as specified ("rls"); "tuned" shows what the
    // proposed changes achieve. --report-only prints without gating.
    const passed = rows.filter((r) => r.mode === "rls").every((r) => r.pass);
    console.log(`\nGate on the design as specified (rls): ${passed ? "PASS" : "FAIL"}`);
    return passed || process.argv.includes("--report-only") ? 0 : 1;
  } finally {
    const cleanup = new pg.Client({ connectionString: adminUrl });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await cleanup.query("DROP ROLE IF EXISTS aestara_bench_search");
    await cleanup.query("DROP ROLE IF EXISTS aestara_bench_baseline");
    await cleanup.end();
  }
}

process.exit(await run());
