// Errors the API returns on purpose. Anything else becomes 500 INTERNAL_ERROR
// with no detail (spec §6.1.5); the cause is logged by request ID only.
import { type FixedErrorCode, httpStatusFor } from "@aestara/api-contracts";

export type ErrorCodeName = FixedErrorCode | `${string}_NOT_FOUND`;

const DEFAULT_MESSAGES: Partial<Record<FixedErrorCode, string>> = {
  VALIDATION_FAILED: "The request is not valid.",
  MALFORMED_REQUEST: "The request body could not be read.",
  UNAUTHENTICATED: "Sign in to continue.",
  SESSION_INVALID: "Your session has ended. Sign in again.",
  MFA_REQUIRED: "Enter the code from your authenticator to continue.",
  PERMISSION_DENIED: "You do not have permission to do this.",
  REAUTHENTICATION_REQUIRED: "Confirm it is you to continue.",
  SEPARATION_OF_DUTIES: "This change is not allowed for your own account or outside your scope.",
  INVALID_STATE_TRANSITION: "This action is not allowed in the record's current state.",
  IMMUTABLE_RECORD: "This record can no longer be changed.",
  DUPLICATE_PATIENT_SUSPECTED: "This patient may already exist.",
  IDEMPOTENCY_IN_PROGRESS: "The same request is still being processed.",
  IDEMPOTENCY_KEY_REUSED: "This Idempotency-Key was used for a different request.",
  CONFLICT: "This conflicts with an existing record.",
  VERSION_CONFLICT: "The record was changed by someone else. Reload and try again.",
  PRECONDITION_REQUIRED: "The If-Match header is required.",
  RATE_LIMITED: "Too many attempts. Try again later.",
  INTERNAL_ERROR: "Something went wrong.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable.",
};

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCodeName,
    message?: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(
      message ?? DEFAULT_MESSAGES[code as FixedErrorCode] ?? "The requested resource could not be accessed.",
    );
    const status = httpStatusFor(code);
    if (status === undefined) throw new Error(`Unknown error code ${code}`);
    this.status = status;
  }
}

/** The one 404 body for absent, other-tenant and out-of-scope resources (spec §6.1.10). */
export function notFound(code: `${string}_NOT_FOUND`): ApiError {
  const resource = code
    .replace(/_NOT_FOUND$/, "")
    .toLowerCase()
    .replaceAll("_", " ");
  return new ApiError(code, `The requested ${resource} could not be accessed.`);
}

export function versionConflict(currentVersion: number): ApiError {
  return new ApiError("VERSION_CONFLICT", undefined, { currentVersion });
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return new ApiError("RATE_LIMITED", undefined, undefined, { "Retry-After": String(seconds) });
}

/** PostgreSQL / Prisma failures that map to a fixed code. */
export function mapDatabaseError(error: unknown): ApiError | undefined {
  const text = error instanceof Error ? error.message : "";
  const code = (error as { code?: string } | null)?.code;
  const meta = (
    error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } }
  )?.meta;
  const sqlState = meta?.driverAdapterError?.cause?.originalCode ?? meta?.code;
  if (code === "P2002" || sqlState === "23505") return new ApiError("CONFLICT");
  if (sqlState === "AE001" || text.includes("IMMUTABLE_RECORD")) return new ApiError("IMMUTABLE_RECORD");
  if (sqlState === "AE002" || text.includes("SEPARATION_OF_DUTIES"))
    return new ApiError("SEPARATION_OF_DUTIES");
  // Prisma could not start the interactive transaction in time, or it expired:
  // the database is saturated, so the client may retry shortly.
  if (code === "P2028")
    return new ApiError("SERVICE_UNAVAILABLE", undefined, undefined, { "Retry-After": "2" });
  if (sqlState === "55P03")
    return new ApiError("IDEMPOTENCY_IN_PROGRESS", undefined, undefined, { "Retry-After": "1" });
  return undefined;
}
