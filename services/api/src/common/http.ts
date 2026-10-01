// HTTP plumbing shared by every route: request IDs, security headers, request
// logging and the error envelope (spec §6.1.4, §6.1.5, §6.1.10).

import { Header } from "@aestara/api-contracts";
import { uuidv7 } from "@aestara/database";
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type Logger } from "pino";
import type { Config } from "../config.ts";
import { ApiError, type ErrorCodeName, mapDatabaseError } from "./errors.ts";
import { safeError } from "./logging.ts";

export const REFRESH_COOKIE = "aestara_rt";

function firstHeader(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined ? null : first;
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export function registerHttpHooks(app: FastifyInstance, config: Config, logger: Logger): void {
  app.decorateRequest("ctx", null as never);

  app.addHook("onRequest", async (req, reply) => {
    const requestId = uuidv7();
    req.ctx = {
      requestId,
      ipAddress: req.ip ?? null,
      userAgent: firstHeader(req, "user-agent")?.slice(0, 512) ?? null,
      origin: firstHeader(req, "origin"),
      startedAt: performance.now(),
      params: {},
      query: {},
      body: undefined,
      refreshCookie: cookieValue(firstHeader(req, "cookie"), REFRESH_COOKIE),
      setCookies: [],
      afterCommit: [],
    };
    reply.header(Header.requestId, requestId);
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (config.NODE_ENV === "production")
      reply.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  });

  app.addHook("onResponse", async (req, reply) => {
    const ctx = req.ctx;
    logger.info(
      {
        requestId: ctx?.requestId,
        method: req.method,
        // The route template only: never the URL, which can hold identifiers.
        route: req.routeOptions?.url ?? "unmatched",
        operationId: ctx?.operation?.operationId,
        status: reply.statusCode,
        ms: ctx ? Math.round(performance.now() - ctx.startedAt) : undefined,
        clientRequestId: firstHeader(req, "x-client-request-id")?.slice(0, 128),
      },
      "request",
    );
  });
}

/** Fastify's own errors (parsing, content type, size) mapped to catalog codes. */
function frameworkError(exception: unknown): ApiError | undefined {
  const code = (exception as { code?: string } | null)?.code ?? "";
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE") return new ApiError("PAYLOAD_TOO_LARGE");
  if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") return new ApiError("UNSUPPORTED_MEDIA_TYPE");
  if (code.startsWith("FST_ERR_CTP_") || exception instanceof SyntaxError)
    return new ApiError("MALFORMED_REQUEST");
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status === 404) return new ApiError("ROUTE_NOT_FOUND" as ErrorCodeName, "No such endpoint.");
    if (status === 400) return new ApiError("MALFORMED_REQUEST");
    if (status === 413) return new ApiError("PAYLOAD_TOO_LARGE");
    if (status === 415) return new ApiError("UNSUPPORTED_MEDIA_TYPE");
  }
  return undefined;
}

/** Writes the error envelope for any failure; unknown failures become 500 with no detail. */
export function sendErrorEnvelope(
  exception: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
  logger: Logger,
): void {
  const requestId = req.ctx?.requestId ?? uuidv7();
  let error =
    exception instanceof ApiError ? exception : (mapDatabaseError(exception) ?? frameworkError(exception));
  if (error === undefined) {
    logger.error({ requestId, err: safeError(exception) }, "unhandled error");
    error = new ApiError("INTERNAL_ERROR");
  }
  for (const [name, value] of Object.entries(error.headers ?? {})) reply.header(name, value);
  reply.header(Header.requestId, requestId);
  reply.status(error.status).send({
    error: {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  });
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    sendErrorEnvelope(
      exception,
      http.getRequest<FastifyRequest>(),
      http.getResponse<FastifyReply>(),
      this.logger,
    );
  }
}
