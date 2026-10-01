// Runtime configuration, read once from the environment and validated
// (spec §7.1: secrets come from Secrets Manager in AWS, injected as environment
// variables by the task definition; never from files in the image).
import { z } from "zod";

const csv = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  );

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length >= 32, "Must be at least 32 bytes, base64-encoded.");

/** Object storage and messaging, shared by the api and the worker (spec §2.1, §6.1.9, §7.4; ADR-0023). */
const StorageEnv = {
  AWS_REGION: z.string().default("us-east-1"),
  /** The local AWS emulator (moto, ADR-0023 K2-08). Never set in a deployed environment. */
  AWS_ENDPOINT_URL: z.url().optional(),
  /** Path-style S3 URLs, which the emulator needs. */
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Every object class except exports and integration payloads (K2-09). */
  MEDIA_BUCKET: z.string().min(3).default("aestara-local-clinical-media"),
  /** The customer-managed KMS key that encrypts media; recorded on each StorageObject. */
  MEDIA_KMS_KEY_ID: z.string().optional(),
  /** Devices upload and download through URLs signed by this role (K2-09); unset locally. */
  S3_PRESIGN_ROLE_ARN: z.string().optional(),
  /** The audit WORM copy (Object Lock bucket, K2-07). */
  AUDIT_ARCHIVE_BUCKET: z.string().min(3).default("aestara-local-audit-archive"),
  EVENT_BUS_NAME: z.string().min(1).default("aestara-local"),
  /** GuardDuty Malware Protection for S3 in AWS; the EICAR-only local scanner elsewhere (K2-04). */
  MALWARE_SCANNER: z.enum(["guardduty", "local"]).default("local"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "silent"]).default("info"),
} as const;

/** Staging and production run NODE_ENV=production: no emulator, no local scanner, a media key (K2-04, K2-08). */
function productionStorageRules(
  env: {
    NODE_ENV: string;
    AWS_ENDPOINT_URL?: string | undefined;
    MALWARE_SCANNER: string;
    MEDIA_KMS_KEY_ID?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (env.NODE_ENV !== "production") return;
  if (env.AWS_ENDPOINT_URL !== undefined)
    ctx.addIssue({ code: "custom", path: ["AWS_ENDPOINT_URL"], message: "Not allowed in production." });
  if (env.MALWARE_SCANNER !== "guardduty")
    ctx.addIssue({
      code: "custom",
      path: ["MALWARE_SCANNER"],
      message: 'Must be "guardduty" in production.',
    });
  if (env.MEDIA_KMS_KEY_ID === undefined)
    ctx.addIssue({ code: "custom", path: ["MEDIA_KMS_KEY_ID"], message: "Required in production." });
}

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Login user that is a member of aestara_app. Never the migration user or a superuser. */
    DATABASE_URL: z.string().min(1),
    /** Login user that is a member of aestara_platform. */
    PLATFORM_DATABASE_URL: z.string().min(1),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(10),
    /** Root secret for the HMAC keys (refresh tokens, cursors, identifier hashes). */
    API_SECRET_KEY: base64Key,
    JWT_SIGNER: z.enum(["local", "kms"]).default("local"),
    JWT_PRIVATE_KEY_PEM: z.string().optional(),
    JWT_KMS_KEY_ID: z.string().optional(),
    JWT_KEY_ID: z.string().min(1).default("local-1"),
    SECRET_SEALER: z.enum(["local", "kms"]).default("local"),
    SECRET_SEAL_KEY: base64Key.optional(),
    SECRET_KMS_KEY_ID: z.string().optional(),
    WEBAUTHN_RP_ID: z.string().default("localhost"),
    WEBAUTHN_RP_NAME: z.string().default("Aestara"),
    WEBAUTHN_ORIGINS: csv,
    /** Allowed Origin values for the admin web (CORS and the cookie refresh check). */
    ADMIN_WEB_ORIGINS: csv,
    /** Base URL of the admin web, for links in emails. */
    ADMIN_WEB_URL: z.url().default("http://localhost:5174"),
    EMAIL_TRANSPORT: z.enum(["memory", "mailpit", "ses"]).default("memory"),
    EMAIL_FROM: z.email().default("no-reply@aestara.local"),
    MAILPIT_URL: z.url().default("http://localhost:8025"),
    /** Behind a load balancer, the client address comes from X-Forwarded-For. */
    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    ...StorageEnv,
  })
  .superRefine((env, ctx) => {
    if (env.JWT_SIGNER === "local" && !env.JWT_PRIVATE_KEY_PEM)
      ctx.addIssue({
        code: "custom",
        path: ["JWT_PRIVATE_KEY_PEM"],
        message: "Required for the local signer.",
      });
    if (env.JWT_SIGNER === "kms" && !env.JWT_KMS_KEY_ID)
      ctx.addIssue({ code: "custom", path: ["JWT_KMS_KEY_ID"], message: "Required for the KMS signer." });
    if (env.SECRET_SEALER === "local" && !env.SECRET_SEAL_KEY)
      ctx.addIssue({ code: "custom", path: ["SECRET_SEAL_KEY"], message: "Required for the local sealer." });
    if (env.SECRET_SEALER === "kms" && !env.SECRET_KMS_KEY_ID)
      ctx.addIssue({ code: "custom", path: ["SECRET_KMS_KEY_ID"], message: "Required for the KMS sealer." });
    if (env.NODE_ENV === "production") {
      // Production keys live in KMS, mail goes through SES (spec §7.1).
      for (const [key, want] of [
        ["JWT_SIGNER", "kms"],
        ["SECRET_SEALER", "kms"],
        ["EMAIL_TRANSPORT", "ses"],
      ] as const)
        if (env[key] !== want)
          ctx.addIssue({ code: "custom", path: [key], message: `Must be "${want}" in production.` });
      if (env.ADMIN_WEB_ORIGINS.length === 0)
        ctx.addIssue({ code: "custom", path: ["ADMIN_WEB_ORIGINS"], message: "Required in production." });
      productionStorageRules(env, ctx);
    }
  });

export type Config = z.infer<typeof EnvSchema> & {
  /** Secure cookies everywhere except plain-HTTP local development and tests. */
  readonly cookieSecure: boolean;
  /** Responses are checked against the contracts outside production. */
  readonly validateResponses: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Name the variables only; values may be secrets.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return {
    ...parsed.data,
    cookieSecure: parsed.data.NODE_ENV === "production" || !parsed.data.ADMIN_WEB_URL.startsWith("http://"),
    validateResponses: parsed.data.NODE_ENV !== "production",
  };
}

export const CONFIG = Symbol("CONFIG");

// ---- The worker (ADR-0023 K2-06, K2-07) ------------------------------------------

const WorkerEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Login user that is a member of aestara_app: per-tenant work, under Row-Level Security. */
    DATABASE_URL: z.string().min(1),
    /** Login user that is a member of aestara_worker: the cross-tenant duties only. */
    WORKER_DATABASE_URL: z.string().min(1),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(5),
    ...StorageEnv,
    WORKER_EVENTS_QUEUE_URL: z.url(),
    IMAGE_JOBS_QUEUE_URL: z.url(),
    IMAGE_RESULTS_QUEUE_URL: z.url(),
    SCAN_RESULTS_QUEUE_URL: z.url(),
    /** S3 object-created notifications, read by the local scanner only. */
    SCAN_REQUESTS_QUEUE_URL: z.url().optional(),
    /** How often the relay looks for committed outbox rows. */
    RELAY_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(1000),
  })
  .superRefine((env, ctx) => {
    productionStorageRules(env, ctx);
    if (env.MALWARE_SCANNER === "local" && env.SCAN_REQUESTS_QUEUE_URL === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["SCAN_REQUESTS_QUEUE_URL"],
        message: "The local scanner reads it.",
      });
  });

export type WorkerConfig = z.infer<typeof WorkerEnvSchema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = WorkerEnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid worker configuration: ${problems}`);
  }
  return parsed.data;
}
