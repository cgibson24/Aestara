// Builds one migrated template database for the run, the way a deployed
// environment does it: migrations applied by a non-superuser migration user,
// and the api connecting as login users of aestara_app and aestara_platform.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TestProject } from "vitest/node";

const databasePackage = join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/database");

export const LOGINS = {
  migrator: "aestara_api_test_migrator",
  app: "aestara_api_test_app",
  platform: "aestara_api_test_platform",
} as const;

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
  if (!adminUrl) return undefined;
  const suffix = `${Date.now()}_${process.pid}`;
  const template = `aestara_api_template_${suffix}`;
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
  await admin.query(`CREATE DATABASE ${template} OWNER ${LOGINS.migrator}`);

  const url = new URL(adminUrl);
  const migratorUrl = new URL(adminUrl);
  migratorUrl.username = LOGINS.migrator;
  migratorUrl.password = password;
  migratorUrl.pathname = `/${template}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: databasePackage,
    env: { ...process.env, DATABASE_URL: migratorUrl.toString() },
    stdio: "pipe",
  });

  // Login users for the api, members of the runtime roles only.
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

  project.provide("database", {
    adminUrl,
    template,
    host: url.host,
    password,
  });

  return async () => {
    const cleanup = new pg.Client({ connectionString: adminUrl });
    await cleanup.connect();
    const { rows } = await cleanup.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE $1",
      [`aestara_api_%${suffix}%`],
    );
    for (const { datname } of rows) await cleanup.query(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`);
    await cleanup.end();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    database: { adminUrl: string; template: string; host: string; password: string };
  }
}
