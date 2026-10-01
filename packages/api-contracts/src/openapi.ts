// Builds the OpenAPI 3.1 document from the Zod schemas (spec §6.8): the shared
// components, then one path per entry of the endpoint registry (endpoints.ts).
import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import pkg from "../package.json" with { type: "json" };
import { MfaChallengeDetails } from "./auth.ts";
import { ENDPOINTS, type EndpointDefinition, errorStatuses } from "./endpoints.ts";
import { ErrorCode, ErrorDetails, ErrorEnvelope, errorCodesByStatus, FieldError } from "./errors.ts";
import { Header } from "./headers.ts";
import {
  collectionEnvelope,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  PageInfo,
  resourceEnvelope,
} from "./pagination.ts";
import { Currency, DateOnly, Money, RequestId, Timestamp, Uuid } from "./primitives.ts";

const ref = (kind: "schemas" | "headers" | "parameters" | "responses", name: string) => ({
  $ref: `#/components/${kind}/${name}`,
});

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
  registry.registerComponent("parameters", "IfMatchWhenExists", {
    name: Header.ifMatch,
    in: "header",
    required: false,
    description: "Required once the resource exists; omit it to create (spec §6.1.7).",
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

  // error.details of 401 MFA_REQUIRED, which clients read to continue sign-in.
  registry.register("MfaChallengeDetails", MfaChallengeDetails);

  for (const e of ENDPOINTS) registerEndpoint(registry, e);

  return registry;
}

function successResponse(e: EndpointDefinition) {
  const { shape, schema, etag } = e.response;
  const headers = {
    [Header.requestId]: ref("headers", Header.requestId),
    ...(etag ? { [Header.etag]: ref("headers", Header.etag) } : {}),
  };
  if (shape === "none" || schema === undefined) return { description: "No content.", headers };
  const body =
    shape === "collection"
      ? collectionEnvelope(schema)
      : shape === "resource"
        ? resourceEnvelope(schema)
        : schema;
  return { description: "Success.", headers, content: { "application/json": { schema: body } } };
}

function registerEndpoint(registry: OpenAPIRegistry, e: EndpointDefinition): void {
  const parameters = [
    ref("parameters", "ClientRequestId"),
    ...(e.idempotency === "required" ? [ref("parameters", "IdempotencyKey")] : []),
    ...(e.ifMatch === "required" ? [ref("parameters", "IfMatch")] : []),
    ...(e.ifMatch === "when-exists" ? [ref("parameters", "IfMatchWhenExists")] : []),
  ];
  const auth = e.auth;
  const notes = [
    auth.kind === "permission"
      ? `Permission: \`${auth.permission}\` (${auth.scopes.join(" or ")} scope).`
      : auth.kind === "token"
        ? `Authorized by the ${auth.token} token.`
        : auth.kind === "session"
          ? "Any signed-in session; acts on the caller's own account."
          : "Public.",
    e.stepUp ? "Needs a recent MFA (step-up)." : "",
    e.audit ? `Audit: ${e.audit.join(", ")}.` : "",
    e.patientData ? "Denials are audited as ACCESS_DENIED." : "",
  ].filter((n) => n !== "");
  registry.registerPath({
    method: e.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete",
    path: e.path,
    operationId: e.operationId,
    tags: [e.tag],
    summary: e.summary,
    description: notes.join(" "),
    ...(auth.kind === "public" || (auth.kind === "token" && auth.token !== "challenge-or-session")
      ? { security: [] }
      : {}),
    parameters,
    request: {
      ...(e.params ? { params: e.params } : {}),
      ...(e.query ? { query: e.query } : {}),
      ...(e.body ? { body: { required: true, content: { "application/json": { schema: e.body } } } } : {}),
    },
    responses: {
      [String(e.response.status)]: successResponse(e),
      ...Object.fromEntries(
        errorStatuses(e).map((status) => [String(status), ref("responses", `Error${status}`)]),
      ),
    },
  });
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
