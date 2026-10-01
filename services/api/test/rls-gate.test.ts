// The end-to-end Row-Level Security gate (ADR-0004, ADR-0020; roadmap M1.8):
// login, patient search and patient open, through the whole api, with the
// application role versus an identical role that bypasses RLS. Each request's
// added p95 must stay within 10% and 5 ms. Runs only with RLS_GATE=1 (CI's api
// job); the table goes to the job summary.
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/passwords.ts";
import { loadConfig } from "../src/config.ts";
import { configAsEnv, databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { DEVICE, PASSWORD } from "./support/fixtures.ts";
import { LOGINS } from "./support/global-setup.ts";

const ORGANIZATIONS = 20;
const PATIENTS_PER_ORGANIZATION = 5_000;
const STAFF_PER_ORGANIZATION = 10;
const AUDIT_EVENTS_PER_ORGANIZATION = 10_000;
const ROUNDS = Number(process.env.RLS_GATE_ROUNDS ?? 1000);
const LIMIT_RATIO = 0.1;
const LIMIT_MS = 5;
const BASELINE_LOGIN = "aestara_api_bench_baseline";

type Inject = (o: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
}) => Promise<{ statusCode: number; json(): unknown }>;

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

describe.runIf(databaseAvailable() && process.env.RLS_GATE === "1")("RLS gate, end to end (ADR-0004)", () => {
  let api: TestApi;
  let baseline: Inject;
  let closeBaseline: () => Promise<void>;
  const staff: { email: string; organizationId: string; token?: string; patients: string[] }[] = [];

  beforeAll(async () => {
    api = await startApi({ DATABASE_POOL_SIZE: "10" });
    const db = api.db;
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${BASELINE_LOGIN}') THEN
        CREATE ROLE ${BASELINE_LOGIN} LOGIN BYPASSRLS;
      END IF;
    END $$`);
    const password = new URL(api.databaseUrl(LOGINS.app)).password;
    await db.query(`ALTER ROLE ${BASELINE_LOGIN} PASSWORD '${password}'`);
    await db.query(`GRANT aestara_app TO ${BASELINE_LOGIN}`);

    // Synthetic data at the M1.1 benchmark's scale: 20 organizations, 100,000 patients, 200,000 audit events.
    const hash = await hashPassword(PASSWORD);
    await db.query(
      `INSERT INTO "Organization" (id, name, slug, "updatedAt")
       SELECT gen_random_uuid(), 'Bench ' || g, 'bench-' || g, now() FROM generate_series(1, ${ORGANIZATIONS}) g`,
    );
    await db.query(`
      INSERT INTO "Patient" (id, "organizationId", "firstName", "lastName", "dateOfBirth", "updatedAt")
      SELECT gen_random_uuid(), o.id,
             (ARRAY['Ana','Ben','Cora','Dev','Eli','Fay','Gus','Hana','Ivo','Jun'])[1 + g % 10],
             (ARRAY['Alder','Barton','Corwin','Dunfield','Elwood','Garmond','Holt','Kellen','Marsh','Torwick'])[1 + (g / 10) % 10] || (g % 997),
             date '1950-01-01' + (g % 20000), now()
        FROM "Organization" o CROSS JOIN generate_series(1, ${PATIENTS_PER_ORGANIZATION}) g
       WHERE o.slug LIKE 'bench-%'`);
    await db.query(`
      INSERT INTO "AuditEvent" (id, "organizationId", "actorType", action, "resourceType", "requestId")
      SELECT gen_random_uuid(), o.id, 'SYSTEM', 'CONFIGURATION_CHANGED', 'Organization', 'bench'
        FROM "Organization" o CROSS JOIN generate_series(1, ${AUDIT_EVENTS_PER_ORGANIZATION}) g
       WHERE o.slug LIKE 'bench-%'`);
    const users = await db.query<{ id: string; email: string; org: string }>(`
      WITH u AS (
        INSERT INTO "User" (id, kind, email, "displayName", status, "updatedAt")
        SELECT gen_random_uuid(), 'WORKFORCE', 'bench-' || o.slug || '-' || g || '@example.test', 'Bench', 'ACTIVE', now()
          FROM "Organization" o CROSS JOIN generate_series(1, ${STAFF_PER_ORGANIZATION}) g WHERE o.slug LIKE 'bench-%'
        RETURNING id, email)
      SELECT u.id, u.email, o.id AS org FROM u JOIN "Organization" o ON u.email LIKE 'bench-' || o.slug || '-%'`);
    for (const u of users.rows) {
      await db.query(
        `INSERT INTO "UserCredential" (id, "userId", type, "passwordHash", "confirmedAt", "createdAt")
         VALUES (gen_random_uuid(), $1, 'PASSWORD', $2, now(), now())`,
        [u.id, hash],
      );
      await db.query(
        `INSERT INTO "Membership" (id, "organizationId", "userId", status, "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now())`,
        [u.org, u.id],
      );
      await db.query(
        `INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope)
         SELECT gen_random_uuid(), $1, $2, id, 'ORGANIZATION' FROM "Role" WHERE key = 'FRONT_DESK'`,
        [u.id, u.org],
      );
      staff.push({ email: u.email, organizationId: u.org, patients: [] });
    }
    await db.query("ANALYZE");
    for (const s of staff) {
      const own = await db.query<{ id: string }>(
        `SELECT id FROM "Patient" WHERE "organizationId" = $1 ORDER BY random() LIMIT 25`,
        [s.organizationId],
      );
      s.patients = own.rows.map((r) => r.id);
    }

    const { app } = await createApp(
      loadConfig({ ...configAsEnv(api), DATABASE_URL: api.databaseUrl(BASELINE_LOGIN) }),
    );
    const fastify = app.getHttpAdapter().getInstance();
    baseline = (o) => fastify.inject(o as never) as never;
    closeBaseline = () => app.close();

    // One session per staff member, valid on both instances (same database and keys).
    for (const s of staff) {
      const res = await api.request({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: s.email, password: PASSWORD, clientApp: "IOS_PROVIDER", device: DEVICE },
      });
      s.token = res.json().data.accessToken;
    }
  }, 600_000);

  afterAll(async () => {
    await closeBaseline?.();
    await api?.close();
  });

  it("adds at most 10% and 5 ms p95 to login, patient search and patient open", async () => {
    const rls: Inject = (o) => api.request(o as never) as never;
    const terms = ["al", "bart", "cor", "dunf", "elw", "garm", "holt", "kel", "mars", "torw"];
    let i = 0;
    const pick = <T>(list: T[]) => list[(i * 7919) % list.length] as T;
    const workloads: Record<string, (call: Inject) => Promise<number>> = {
      login: async (call) => {
        const s = pick(staff);
        return (
          await call({
            method: "POST",
            url: "/api/v1/auth/login",
            payload: { email: s.email, password: PASSWORD, clientApp: "IOS_PROVIDER", device: DEVICE },
          })
        ).statusCode;
      },
      "patient search": async (call) =>
        (
          await call({
            method: "POST",
            url: "/api/v1/patients/search",
            headers: { authorization: `Bearer ${pick(staff).token}` },
            payload: { name: pick(terms) },
          })
        ).statusCode,
      "patient open": async (call) => {
        // A patient of the caller's own organization.
        const s = pick(staff);
        const id = s.patients[i % s.patients.length];
        return (
          await call({
            method: "GET",
            url: `/api/v1/patients/${id}`,
            headers: { authorization: `Bearer ${s.token}` },
          })
        ).statusCode;
      },
    };
    const rows: string[] = [];
    let failed = false;
    for (const [name, run] of Object.entries(workloads)) {
      const times = { rls: [] as number[], baseline: [] as number[] };
      const rounds = name === "login" ? Math.min(ROUNDS, 200) : ROUNDS;
      for (let w = 0; w < 20; w++) {
        await run(rls);
        await run(baseline);
      }
      for (i = 0; i < rounds; i++) {
        // Alternate the order so drift affects both modes alike.
        for (const mode of i % 2 === 0 ? (["rls", "baseline"] as const) : (["baseline", "rls"] as const)) {
          const started = performance.now();
          const status = await run(mode === "rls" ? rls : baseline);
          times[mode].push(performance.now() - started);
          expect([200], `${name} ${mode}`).toContain(status);
        }
      }
      const base = percentile(times.baseline, 95);
      const withRls = percentile(times.rls, 95);
      const medians = `${percentile(times.baseline, 50).toFixed(2)} / ${percentile(times.rls, 50).toFixed(2)}`;
      const added = withRls - base;
      const ok = added <= LIMIT_MS && added <= base * LIMIT_RATIO;
      failed ||= !ok;
      rows.push(
        `| ${name} | ${medians} | ${base.toFixed(2)} | ${withRls.toFixed(2)} | ${added.toFixed(2)} | ${((added / base) * 100).toFixed(1)}% | ${ok ? "pass" : "FAIL"} |`,
      );
    }
    const table = [
      "### RLS gate, end to end (ADR-0004: ≤ 10% and ≤ 5 ms added p95)",
      "",
      `${ORGANIZATIONS} organizations, ${ORGANIZATIONS * PATIENTS_PER_ORGANIZATION} patients, ${ORGANIZATIONS * AUDIT_EVENTS_PER_ORGANIZATION} audit events; ${ROUNDS} rounds (login ${Math.min(ROUNDS, 200)}).`,
      "",
      "| Request | Median, baseline / RLS (ms) | Baseline p95 (ms) | RLS p95 (ms) | Added p95 (ms) | Added | Result |",
      "|---|---|---|---|---|---|---|",
      ...rows,
      "",
    ].join("\n");
    console.log(table);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
    expect(failed, table).toBe(false);
  }, 900_000);
});
