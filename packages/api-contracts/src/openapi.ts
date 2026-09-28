// Builds the OpenAPI 3.1 document from the Zod schemas (spec §6.8). Layer 0
// registers only the shared components; each layer adds its paths here.
import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import pkg from "../package.json" with { type: "json" };
import { ErrorCode, ErrorDetails, ErrorEnvelope, errorCodesByStatus, FieldError } from "./errors.ts";
import { Header } from "./headers.ts";
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, PageInfo } from "./pagination.ts";
import { Currency, DateOnly, Money, RequestId, Timestamp, Uuid } from "./primitives.ts";

const ref = (kind: "schemas" | "headers", name: string) => ({ $ref: `#/components/${kind}/${name}` });

/** Shared schemas, registered under the component name in their `.meta({ id })`. */
export const sharedSchemas = {
  Uuid,
  RequestId,
  Timestamp,
  DateOnly,
  Currency,
  Money,
  ErrorCode,
  FieldError,
  ErrorDetails,
  ErrorEnvelope,
  PageInfo,
} as const;

export function buildRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();

  for (const [name, schema] of Object.entries(sharedSchemas)) registry.register(name, schema);

  registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Access token from /auth. Tenant context comes from the token only (spec §6.1.3).",
  });

  registry.registerComponent("parameters", "Limit", {
    name: "limit",
    in: "query",
    required: false,
    description: `Page size, 1–${PAGE_LIMIT_MAX}.`,
    schema: { type: "integer", minimum: 1, maximum: PAGE_LIMIT_MAX, default: PAGE_LIMIT_DEFAULT },
  });
  registry.registerComponent("parameters", "Cursor", {
    name: "cursor",
    in: "query",
    required: false,
    description: "Opaque, signed, expiring cursor from page.nextCursor.",
    schema: { type: "string", minLength: 1 },
  });
  registry.registerComponent("parameters", "IdempotencyKey", {
    name: Header.idempotencyKey,
    in: "header",
    required: true,
    description: "Client-generated UUID. Retained per actor for 7 days (spec §6.1.8).",
    schema: ref("schemas", "Uuid"),
  });
  registry.registerComponent("parameters", "IfMatch", {
    name: Header.ifMatch,
    in: "header",
    required: true,
    description: 'The resource ETag, e.g. "v7" (spec §6.1.7).',
    schema: { type: "string", pattern: '^"v[0-9]+"$' },
  });
  registry.registerComponent("parameters", "ClientRequestId", {
    name: Header.clientRequestId,
    in: "header",
    required: false,
    description: "Optional client correlation ID. Logged, never trusted.",
    schema: { type: "string", maxLength: 128 },
  });

  registry.registerComponent("headers", Header.requestId, {
    description: "Server-generated request identifier (UUIDv7).",
    schema: ref("schemas", "RequestId"),
  });
  registry.registerComponent("headers", Header.etag, {
    description: 'Resource version, e.g. "v7".',
    schema: { type: "string", pattern: '^"v[0-9]+"$' },
  });
  registry.registerComponent("headers", Header.retryAfter, {
    description: "Seconds to wait before retrying.",
    schema: { type: "integer", minimum: 0 },
  });

  for (const [status, codes] of errorCodesByStatus()) {
    registry.registerComponent("responses", `Error${status}`, {
      description: `Error envelope. Codes: ${codes.join(", ")}.`,
      headers: {
        [Header.requestId]: ref("headers", Header.requestId),
        ...(status === 429 || status === 503 || status === 409
          ? { [Header.retryAfter]: ref("headers", Header.retryAfter) }
          : {}),
      },
      content: { "application/json": { schema: ref("schemas", "ErrorEnvelope") } },
    });
  }

  return registry;
}

export function generateOpenApiDocument() {
  return new OpenApiGeneratorV31(buildRegistry().definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Aestara API",
      version: pkg.version,
      description:
        "Staff/admin API (/api/v1) and patient portal API (/api/v1/portal). Conventions: " +
        "docs/API_CONTRACTS.md and docs/TECHNICAL_SPECIFICATION.md §6. Within v1 only additive changes are allowed.",
    },
    servers: [{ url: "/api/v1", description: "Version 1" }],
    security: [{ bearerAuth: [] }],
  });
}

/** The document as committed: stable key order from the registry, 2-space JSON, trailing newline. */
export function renderOpenApiDocument(): string {
  return `${JSON.stringify(generateOpenApiDocument(), null, 2)}\n`;
}
