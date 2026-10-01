// Starts the real application against a fresh clone of the migrated template
// database, connected as the runtime login users (never a superuser). Fixtures
// are inserted through a separate superuser connection, as data that already
// exists; every behaviour under test goes through HTTP.
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import pg from "pg";
import { inject } from "vitest";
import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { EmailService } from "../../src/email/email.ts";
import { LOGINS } from "./global-setup.ts";

export const ADMIN_ORIGIN = "https://admin.aestara.test";

export function databaseAvailable(): boolean {
  return Boolean(process.env.TEST_ADMIN_DATABASE_URL);
}

export interface TestApi {
  readonly app: NestFastifyApplication;
  readonly fastify: FastifyInstance;
  /** Superuser connection to this test's database, for fixtures and assertions. */
  readonly db: pg.Client;
  readonly email: EmailService;
  readonly sealKey: Buffer;
  request(options: InjectOptions): Promise<LightMyRequestResponse>;
  /** A connection as one of the api's runtime login users. */
  connectAs(role: "app" | "platform"): Promise<pg.Client>;
  close(): Promise<void>;
}

export async function startApi(
  env: Record<string, string> = {},
  options: { logDestination?: { write(line: string): void } } = {},
): Promise<TestApi> {
  const database = inject("database");
  const name = `${database.template}_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${database.template}`);
  await admin.end();

  const url = (login: string) => `postgresql://${login}:${database.password}@${database.host}/${name}`;
  const adminUrl = new URL(database.adminUrl);
  adminUrl.pathname = `/${name}`;
  const db = new pg.Client({ connectionString: adminUrl.toString() });
  await db.connect();

  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const sealKey = randomBytes(32);
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: url(LOGINS.app),
    PLATFORM_DATABASE_URL: url(LOGINS.platform),
    DATABASE_POOL_SIZE: "8",
    API_SECRET_KEY: randomBytes(32).toString("base64"),
    JWT_SIGNER: "local",
    JWT_PRIVATE_KEY_PEM: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    JWT_KEY_ID: `test-${randomUUID().slice(0, 8)}`,
    SECRET_SEALER: "local",
    SECRET_SEAL_KEY: sealKey.toString("base64"),
    WEBAUTHN_RP_ID: "admin.aestara.test",
    WEBAUTHN_ORIGINS: ADMIN_ORIGIN,
    ADMIN_WEB_ORIGINS: ADMIN_ORIGIN,
    ADMIN_WEB_URL: ADMIN_ORIGIN,
    EMAIL_TRANSPORT: "memory",
    LOG_LEVEL: "silent",
    ...env,
  });
  const { app } = await createApp(
    config,
    options.logDestination ? { logDestination: options.logDestination } : {},
  );
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  return {
    app,
    fastify,
    db,
    email: app.get(EmailService),
    sealKey,
    request: (options) => fastify.inject(options),
    connectAs: async (role) => {
      const client = new pg.Client({ connectionString: url(LOGINS[role]) });
      await client.connect();
      return client;
    },
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}
