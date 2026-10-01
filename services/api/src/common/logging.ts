// Structured, PHI-safe logging (spec §7.2; Bible §21.2 "no sensitive data in
// logs"). Request logs carry the route template (never the URL, so no IDs or
// query strings), the status, the duration, the request ID and the operation.
// No header, body, cookie, token, email or name is ever logged. Errors are
// logged by name and code; their messages can echo input, so they are dropped.
import type { LoggerService } from "@nestjs/common";
import pino, { type DestinationStream, type Logger } from "pino";
import type { Config } from "../config.ts";

export function createLogger(
  config: Pick<Config, "LOG_LEVEL" | "NODE_ENV">,
  destination?: DestinationStream,
  service = "api",
): Logger {
  const options = {
    level: config.LOG_LEVEL,
    base: { service },
    messageKey: "msg",
    timestamp: pino.stdTimeFunctions.isoTime,
    // Defence in depth: these keys are never passed, but are censored if they are.
    redact: {
      paths: [
        "req.headers",
        "headers",
        "authorization",
        "cookie",
        "body",
        "password",
        "token",
        "*.password",
        "*.token",
        "*.email",
        "*.phone",
        "*.firstName",
        "*.lastName",
        "*.dateOfBirth",
      ],
      censor: "[redacted]",
    },
    serializers: { err: safeError },
  } satisfies pino.LoggerOptions;
  return destination ? pino(options, destination) : pino(options);
}

/** An error without its message or stack text: name, code and the code locations only. */
export function safeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    const record = (typeof error === "object" && error !== null ? error : {}) as Record<string, unknown>;
    return {
      type: typeof error,
      constructor: record.constructor?.name,
      keys: Object.keys(record).slice(0, 10),
      code: typeof record.code === "string" ? record.code : undefined,
      name: typeof record.name === "string" ? record.name : undefined,
    };
  }
  const frames = (error.stack ?? "")
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, 8);
  return { name: error.name, code: (error as { code?: unknown }).code, frames };
}

/** NestJS framework messages go to the same structured logger. */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: unknown, context?: string): void {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, _trace?: string, context?: string): void {
    // The trace can contain request data; Nest's own messages are fixed strings.
    this.logger.error({ context }, message instanceof Error ? message.name : String(message));
  }
  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message));
  }
}
