// HTTP headers with platform-wide meaning (spec §6.1.3–§6.1.8, §6.1.10).
// Tenant context comes from the access token only: there is deliberately no
// organization header.

export const Header = {
  /** Server-generated UUIDv7 on every response. */
  requestId: "X-Request-Id",
  /** Optional client correlation ID; logged, never trusted. */
  clientRequestId: "X-Client-Request-Id",
  /** UUID; required on uploads, signatures, AI jobs, exports, sends and offline-capable creates. */
  idempotencyKey: "Idempotency-Key",
  /** `"v{version}"` on concurrently editable resources. */
  etag: "ETag",
  /** Required on PATCH and state-changing actions of versioned resources. */
  ifMatch: "If-Match",
  retryAfter: "Retry-After",
  deprecation: "Deprecation",
  sunset: "Sunset",
} as const;

export type HeaderName = (typeof Header)[keyof typeof Header];

/** Idempotency keys are retained per actor for this long (spec §6.1.8). */
export const IDEMPOTENCY_RETENTION_DAYS = 7;

/** ETag value for a resource version, e.g. `"v7"`. */
export function etagFor(version: number): string {
  if (!Number.isInteger(version) || version < 0)
    throw new RangeError("version must be a non-negative integer");
  return `"v${version}"`;
}
