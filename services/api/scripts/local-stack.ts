// A complete local stack (Layers 1 and 2): a fresh database migrated by a
// non-superuser (as in a deployed environment), the synthetic development seed
// (one organization, an invited administrator), its own resources on the local
// AWS emulator (moto, ADR-0023 K2-08), the api and the worker from dist/
// connecting as login users of aestara_app, aestara_platform and
// aestara_worker, and image-processing through uv. The database is dropped
// when the stack stops. Synthetic data only; local databases and a local
// emulator only. Needs a prior `pnpm build`, a running emulator (`pnpm
// services:up`, or `moto_server -p 4566` from pip) and uv.
//
// Used by the admin portal's Playwright suite (apps/admin-web/e2e), and from
// the command line:
//
//   ADMIN_DATABASE_URL=… node scripts/local-stack.ts --dev
//     Local development: the api on port 3000 with email to Mailpit, and the
//     administrator's invitation link printed for the portal on port 5174.
//   TEST_ADMIN_DATABASE_URL=… node scripts/local-stack.ts --ios <out.json> <user>…
//     The iOS UI tests: also prepares one clinician per named user through the
//     api (the administrator invites them with the SURGEON_PHYSICIAN role and
//     each sets up an authenticator) and writes their sign-in details.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { awsEnv, provisionLocalAws } from "../src/aws/local-resources.ts";
import { Authenticator } from "./totp.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOGINS = {
  migrator: "aestara_e2e_migrator",
  app: "aestara_e2e_app",
  platform: "aestara_e2e_platform",
  worker: "aestara_e2e_worker",
};

export interface Stack {
  readonly apiUrl: string;
  readonly adminEmail: string;
  readonly invitationToken: string;
  /** Runs SQL as the local superuser on the stack's database (test fixtures only). */
  sql(text: string, values?: unknown[]): Promise<void>;
  stop(): Promise<void>;
}

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

/** image-processing writes its heartbeat once its consumer loop runs. */
async function waitForFile(path: string, child: ChildProcess, name: string): Promise<void> {
  // The first run may install the locked environment.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited with ${child.exitCode}`);
    if (existsSync(path)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${name} did not start`);
}

async function emulatorRunning(endpoint: string): Promise<boolean> {
  try {
    return (await fetch(`${endpoint}/moto-api/`)).ok;
  } catch {
    return false;
  }
}

export async function startStack(options: {
  apiPort: number;
  origins: string[];
  env?: Record<string, string>;
}): Promise<Stack> {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? process.env.ADMIN_DATABASE_URL;
  if (!adminUrl) throw new Error("Set ADMIN_DATABASE_URL to a local PostgreSQL superuser URL");
  if (!LOCAL_HOSTS.has(new URL(adminUrl).hostname))
    throw new Error("The test stack runs only on a local database");
  const awsEndpoint =
    process.env.TEST_AWS_ENDPOINT_URL ?? process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
  if (!LOCAL_HOSTS.has(new URL(awsEndpoint).hostname))
    throw new Error("The test stack runs only on a local AWS emulator");
  if (!(await emulatorRunning(awsEndpoint)))
    throw new Error(
      `No AWS emulator at ${awsEndpoint}: run \`pnpm services:up\`, or \`pip install "moto[server]"\` and \`moto_server -p 4566\``,
    );
  try {
    execFileSync("uv", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("image-processing needs uv (https://docs.astral.sh/uv/): `pip install uv`");
  }
  const stamp = Date.now();
  const database = `aestara_e2e_${stamp}`;
  const password = randomBytes(12).toString("hex");
  const aws = await provisionLocalAws(awsEndpoint, `e2e-${stamp}`);

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query("SET client_min_messages = warning");
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${LOGINS.migrator}') THEN
      CREATE ROLE ${LOGINS.migrator} LOGIN CREATEROLE;
    END IF;
  END $$`);
  await admin.query(`ALTER ROLE ${LOGINS.migrator} PASSWORD '${password}'`);
  for (const role of [
    "aestara_app",
    "aestara_platform",
    "aestara_signin",
    "aestara_worker",
    "aestara_protocol_seed",
  ])
    await admin.query(`DO $$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
        EXECUTE format('GRANT %I TO ${LOGINS.migrator} WITH ADMIN OPTION', '${role}');
      END IF;
    END $$`);
  await admin.query(`CREATE DATABASE ${database} OWNER ${LOGINS.migrator}`);

  const at = (user: string, pass: string) => {
    const u = new URL(adminUrl);
    u.username = user;
    u.password = pass;
    u.pathname = `/${database}`;
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
    [LOGINS.worker, "aestara_worker"],
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
  const superuserUrl = new URL(adminUrl);
  superuserUrl.pathname = `/${database}`;
  const seeded = execFileSync("node", ["scripts/seed-dev.ts"], {
    cwd: join(repo, "packages/database"),
    env: { ...process.env, DATABASE_URL: superuserUrl.toString() },
    encoding: "utf8",
  });
  const invitationToken = /invitation token[^:]*: (\S+)/.exec(seeded)?.[1];
  if (!invitationToken) throw new Error("The seed did not print an invitation token");

  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const api = spawn("node", ["dist/main.js"], {
    cwd: join(repo, "services/api"),
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(options.apiPort),
      DATABASE_URL: at(LOGINS.app, password),
      PLATFORM_DATABASE_URL: at(LOGINS.platform, password),
      API_SECRET_KEY: randomBytes(32).toString("base64"),
      JWT_PRIVATE_KEY_PEM: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      SECRET_SEAL_KEY: randomBytes(32).toString("base64"),
      ADMIN_WEB_ORIGINS: options.origins.join(","),
      ADMIN_WEB_URL: options.origins[0] ?? "http://localhost:5174",
      WEBAUTHN_ORIGINS: options.origins.join(","),
      // Request lines carry the route template, status and duration only (spec §7.2).
      LOG_LEVEL: process.env.STACK_LOG_LEVEL ?? "warn",
      ...awsEnv(aws),
      ...options.env,
    },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  // The worker: outbox relay, the local scanner, scan results, derivative jobs (ADR-0024).
  const worker = spawn("node", ["dist/worker.js"], {
    cwd: join(repo, "services/api"),
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: at(LOGINS.app, password),
      WORKER_DATABASE_URL: at(LOGINS.worker, password),
      LOG_LEVEL: process.env.STACK_LOG_LEVEL ?? "warn",
      ...awsEnv(aws),
    },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  // image-processing (ADR-0023 K2-01), from its locked environment.
  const heartbeat = join(mkdtempSync(join(tmpdir(), "aestara-ip-")), "heartbeat");
  const imageProcessing = spawn(
    "uv",
    [
      "run",
      "--frozen",
      "--no-dev",
      "--project",
      join(repo, "services/image-processing"),
      "python",
      "-m",
      "aestara_image_processing",
    ],
    {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        APP_ENV: "development",
        AWS_ENDPOINT_URL: aws.endpoint,
        IMAGE_JOBS_QUEUE_URL: aws.queues.imageJobs,
        IMAGE_RESULTS_QUEUE_URL: aws.queues.imageResults,
        HEARTBEAT_FILE: heartbeat,
        LOG_LEVEL: process.env.STACK_LOG_LEVEL === "info" ? "info" : "warning",
      },
      stdio: ["ignore", "inherit", "inherit"],
      detached: true,
    },
  );
  const children = [api, worker, imageProcessing];

  const dropDatabase = async () => {
    const cleanup = new pg.Client({ connectionString: adminUrl });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await cleanup.end();
  };
  const stopProcesses = () => {
    for (const child of children)
      if (child.pid !== undefined && child.exitCode === null)
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // already gone
        }
  };
  const apiUrl = `http://127.0.0.1:${options.apiPort}/api/v1`;
  try {
    await waitFor(`${apiUrl}/health/live`, api, "api");
    await waitForFile(heartbeat, imageProcessing, "image-processing");
    if (worker.exitCode !== null) throw new Error(`the worker exited with ${worker.exitCode}`);
  } catch (error) {
    stopProcesses();
    await dropDatabase();
    throw error;
  }

  return {
    apiUrl,
    adminEmail: "admin@synthetic-demo.test",
    invitationToken,
    async sql(text, values) {
      const client = new pg.Client({ connectionString: superuserUrl.toString() });
      await client.connect();
      try {
        await client.query(text, values);
      } finally {
        await client.end();
      }
    },
    async stop() {
      stopProcesses();
      await dropDatabase();
    },
  };
}

// ---- Preparing users through the api (--ios) --------------------------------

async function call<T>(
  stack: Stack,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${stack.apiUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

interface Signed {
  accessToken: string;
  authenticator: Authenticator;
  secret: string;
}

/** Accepts the invitation, signs in, and sets up an authenticator with the sign-in challenge. */
async function activate(stack: Stack, email: string, token: string, password: string): Promise<Signed> {
  const accepted = await call(stack, "POST", "/auth/invitations/accept", { token, password });
  if (accepted.status !== 204) throw new Error(`Invitation for ${email}: ${JSON.stringify(accepted.body)}`);
  const login = await call<{ error: { code: string; details: { challengeToken: string } } }>(
    stack,
    "POST",
    "/auth/login",
    { email, password, clientApp: "ADMIN_WEB" },
  );
  if (login.body.error?.code !== "MFA_REQUIRED")
    throw new Error(`Sign-in for ${email}: ${JSON.stringify(login.body)}`);
  const challengeToken = login.body.error.details.challengeToken;
  const enrollment = await call<{ data: { id: string; totp: { secret: string } } }>(
    stack,
    "POST",
    "/auth/mfa/enrollments",
    { type: "TOTP", challengeToken },
    { "Idempotency-Key": randomUUID() },
  );
  if (enrollment.status !== 201)
    throw new Error(`Enrollment for ${email}: ${JSON.stringify(enrollment.body)}`);
  const secret = enrollment.body.data.totp.secret;
  const authenticator = new Authenticator(secret);
  const confirmed = await call(stack, "POST", `/auth/mfa/enrollments/${enrollment.body.data.id}/confirm`, {
    totpCode: await authenticator.next(),
    challengeToken,
  });
  if (confirmed.status !== 204)
    throw new Error(`Confirmation for ${email}: ${JSON.stringify(confirmed.body)}`);
  const verified = await call<{ data: { accessToken: string } }>(stack, "POST", "/auth/mfa/verify", {
    challengeToken,
    totpCode: await authenticator.next(),
  });
  if (verified.status !== 200) throw new Error(`Verification for ${email}: ${JSON.stringify(verified.body)}`);
  return { accessToken: verified.body.data.accessToken, authenticator, secret };
}

async function prepareClinicians(stack: Stack, names: string[]) {
  const adminPassword = `harbour lantern ${randomBytes(9).toString("hex")}`;
  const admin = await activate(stack, stack.adminEmail, stack.invitationToken, adminPassword);
  const auth = { authorization: `Bearer ${admin.accessToken}` };
  const roles = await call<{ data: { id: string; key: string }[] }>(stack, "GET", "/roles", undefined, auth);
  const surgeon = roles.body.data.find((r) => r.key === "SURGEON_PHYSICIAN");
  if (!surgeon) throw new Error("No SURGEON_PHYSICIAN role");

  const users: Record<string, { email: string; password: string; totpSecret: string; lastStep: number }> = {};
  for (const name of names) {
    const email = `${name}@synthetic-demo.test`;
    const created = await call<{ data: { id: string } }>(
      stack,
      "POST",
      "/users",
      { email, displayName: `Dr ${name}`, roleAssignments: [{ roleId: surgeon.id, scope: "ORGANIZATION" }] },
      { ...auth, "Idempotency-Key": randomUUID() },
    );
    if (created.status !== 201) throw new Error(`Invite ${email}: ${JSON.stringify(created.body)}`);
    // The api emailed a secret link. Tokens are immutable, so the test supersedes
    // that one (as a re-invitation does) and issues one whose secret it knows.
    const token = randomBytes(32).toString("base64url");
    await stack.sql(
      `WITH emailed AS (
         UPDATE "UserToken" SET "consumedAt" = now()
         WHERE "userId" = $2 AND purpose = 'INVITATION' AND "consumedAt" IS NULL
         RETURNING "organizationId", "createdById", "expiresAt"
       )
       INSERT INTO "UserToken" (id, "userId", purpose, "tokenHash", "organizationId", "createdById", "expiresAt")
       SELECT $3, $2, 'INVITATION', $1, "organizationId", "createdById", "expiresAt" FROM emailed`,
      [createHash("sha256").update(token).digest("hex"), created.body.data.id, randomUUID()],
    );
    const password = `meadow violet ${randomBytes(9).toString("hex")}`;
    const signed = await activate(stack, email, token, password);
    users[name] = { email, password, totpSecret: signed.secret, lastStep: signed.authenticator.lastUsedStep };
  }
  return users;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, out, ...names] = process.argv.slice(2);
  const ios = mode === "--ios" && out !== undefined && names.length > 0;
  if (mode !== "--dev" && !ios)
    throw new Error("Usage: node scripts/local-stack.ts --dev | --ios <out.json> <user> [user…]");
  const portal = "http://localhost:5174";
  const stack = await startStack({
    apiPort: 3000,
    origins: [portal],
    ...(mode === "--dev" ? { env: { EMAIL_TRANSPORT: "mailpit", LOG_LEVEL: "info" } } : {}),
  });
  const shutdown = () => void stack.stop().finally(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  try {
    if (ios && out) {
      writeFileSync(out, JSON.stringify(await prepareClinicians(stack, names), null, 2));
      console.log(`local stack ready on ${stack.apiUrl}; users in ${out}`);
    } else {
      console.log(`api: ${stack.apiUrl} · email: http://localhost:8025 (Mailpit)`);
      console.log(`Accept the administrator invitation (${stack.adminEmail}), then sign in:`);
      console.log(`  ${portal}/accept-invitation#token=${stack.invitationToken}`);
      console.log("Stop with Ctrl+C; the database is dropped.");
    }
  } catch (error) {
    await stack.stop();
    throw error;
  }
}
