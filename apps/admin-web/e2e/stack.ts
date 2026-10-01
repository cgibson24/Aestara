// The end-to-end stack: a fresh database migrated by a non-superuser, the
// synthetic development seed (one organization, an invited administrator),
// the real api from services/api/dist, and the built portal served by
// `vite preview`, which proxies /api to the api as one site would.
//
// Needs TEST_ADMIN_DATABASE_URL (a local PostgreSQL superuser) and a prior
// `pnpm build`. Writes the invitation token to e2e/.stack.json for the tests.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
export const STACK_FILE = join(here, ".stack.json");
export const API_PORT = 3100;
export const WEB_PORT = 5174;

const LOGINS = { migrator: "aestara_e2e_migrator", app: "aestara_e2e_app", platform: "aestara_e2e_platform" };

async function waitFor(url: string, child: ChildProcess, name: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${name} did not start`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
  if (!adminUrl) throw new Error("Set TEST_ADMIN_DATABASE_URL to a local PostgreSQL superuser URL");
  const database = `aestara_e2e_${Date.now()}`;
  const password = randomBytes(12).toString("hex");

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query("SET client_min_messages = warning");
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${LOGINS.migrator}') THEN
      CREATE ROLE ${LOGINS.migrator} LOGIN CREATEROLE;
    END IF;
  END $$`);
  await admin.query(`ALTER ROLE ${LOGINS.migrator} PASSWORD '${password}'`);
  for (const role of ["aestara_app", "aestara_platform", "aestara_signin"])
    await admin.query(`DO $$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
        EXECUTE format('GRANT %I TO ${LOGINS.migrator} WITH ADMIN OPTION', '${role}');
      END IF;
    END $$`);
  await admin.query(`CREATE DATABASE ${database} OWNER ${LOGINS.migrator}`);

  const at = (user: string, pass: string, db = database) => {
    const u = new URL(adminUrl);
    u.username = user;
    u.password = pass;
    u.pathname = `/${db}`;
    return u.toString();
  };
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: join(repo, "packages/database"),
    env: { ...process.env, DATABASE_URL: at(LOGINS.migrator, password) },
    stdio: "pipe",
  });
  for (const [login, role] of [
    [LOGINS.app, "aestara_app"],
    [LOGINS.platform, "aestara_platform"],
  ] as const) {
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${login}') THEN
        CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$`);
    await admin.query(`ALTER ROLE ${login} PASSWORD '${password}'`);
    await admin.query(`GRANT ${role} TO ${login}`);
  }
  await admin.end();

  // The development seed, as the local superuser: prints the invitation token.
  const seedUrl = new URL(adminUrl);
  seedUrl.pathname = `/${database}`;
  const seeded = execFileSync("node", ["scripts/seed-dev.ts"], {
    cwd: join(repo, "packages/database"),
    env: { ...process.env, DATABASE_URL: seedUrl.toString() },
    encoding: "utf8",
  });
  const invitationToken = /invitation token[^:]*: (\S+)/.exec(seeded)?.[1];
  if (!invitationToken) throw new Error("The seed did not print an invitation token");
  writeFileSync(STACK_FILE, JSON.stringify({ invitationToken, email: "admin@synthetic-demo.test" }));

  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const origin = `http://localhost:${WEB_PORT}`;
  const api = spawn("node", ["dist/main.js"], {
    cwd: join(repo, "services/api"),
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(API_PORT),
      DATABASE_URL: at(LOGINS.app, password),
      PLATFORM_DATABASE_URL: at(LOGINS.platform, password),
      API_SECRET_KEY: randomBytes(32).toString("base64"),
      JWT_PRIVATE_KEY_PEM: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      SECRET_SEAL_KEY: randomBytes(32).toString("base64"),
      ADMIN_WEB_ORIGINS: origin,
      ADMIN_WEB_URL: origin,
      WEBAUTHN_ORIGINS: origin,
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  // npx starts vite as a child: each server gets its own process group, stopped as a whole.
  const web = spawn("npx", ["vite", "preview", "--host", "localhost"], {
    cwd: join(here, ".."),
    env: { ...process.env, AESTARA_API_URL: `http://127.0.0.1:${API_PORT}` },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  const stop = () => {
    for (const child of [web, api])
      if (child.pid !== undefined && child.exitCode === null)
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // already gone
        }
  };
  const dropDatabase = async () => {
    const cleanup = new pg.Client({ connectionString: adminUrl });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await cleanup.end();
  };
  try {
    await waitFor(`http://127.0.0.1:${API_PORT}/api/v1/health/live`, api, "api");
    await waitFor(`${origin}/`, web, "vite preview");
  } catch (error) {
    stop();
    await dropDatabase();
    throw error;
  }

  return async () => {
    stop();
    await dropDatabase();
  };
}
