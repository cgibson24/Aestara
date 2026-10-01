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
    AWS_REGION: z.string().default("us-east-1"),
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
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "silent"]).default("info"),
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
