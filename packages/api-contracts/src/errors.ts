// The error envelope (spec §6.1.5, Bible §20.4) and the error code catalog
// (spec §6.2). Messages never carry stack traces, SQL, storage keys or hints
// that a resource exists in another tenant.

import { RequestId } from "./primitives.ts";
import { z } from "./zod.ts";

type ErrorEntry = { readonly status: number; readonly when: string };

/** Fixed error codes and their HTTP status (spec §6.2). */
export const ERROR_CATALOG = {
  VALIDATION_FAILED: { status: 400, when: "Schema or field validation failed; see details.fieldErrors." },
  MALFORMED_REQUEST: { status: 400, when: "Unparseable JSON or wrong content type." },
  UNAUTHENTICATED: { status: 401, when: "Missing, invalid or expired access token." },
  SESSION_INVALID: { status: 401, when: "Session revoked or expired, or membership inactive." },
  MFA_REQUIRED: { status: 401, when: "The sign-in step needs a second factor." },
  PERMISSION_DENIED: { status: 403, when: "The resource is visible but the action is not permitted." },
  REAUTHENTICATION_REQUIRED: {
    status: 403,
    when: "Step-up needed (recent MFA or biometric) for a sensitive action.",
  },
  SEPARATION_OF_DUTIES: {
    status: 403,
    when: "The grant, membership or user-management action breaks a separation-of-duties rule.",
  },
  MEDIA_PERMISSION_NOT_GRANTED: {
    status: 403,
    when: "Export or release without a current purpose-specific media grant.",
  },
  INVALID_STATE_TRANSITION: { status: 409, when: "The action is not allowed from the current state." },
  IMMUTABLE_RECORD: { status: 409, when: "Attempt to modify a frozen record." },
  DUPLICATE_PATIENT_SUSPECTED: {
    status: 409,
    when: "Create without confirming probable duplicates; details.candidates holds opaque IDs and match reasons.",
  },
  IDEMPOTENCY_IN_PROGRESS: { status: 409, when: "Same Idempotency-Key is still processing; retry later." },
  IDEMPOTENCY_KEY_REUSED: { status: 409, when: "Same Idempotency-Key sent with a different body." },
  CONFLICT: { status: 409, when: "Unique constraint violated (for example an MRN already in use)." },
  SYNC_CONFLICT: { status: 409, when: "Integration data conflicts with local edits." },
  VERSION_CONFLICT: { status: 412, when: "If-Match is stale; details holds the current version." },
  PAYLOAD_TOO_LARGE: { status: 413, when: "Upload exceeds the size limit." },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, when: "File type not allowed." },
  UPLOAD_VERIFICATION_FAILED: { status: 422, when: "Size or checksum mismatch on upload completion." },
  COMPLETION_PRECONDITIONS_NOT_MET: {
    status: 422,
    when: "Completing a consultation with a spec §5.4.1 precondition unmet; details.unmet names each one.",
  },
  INCOMPATIBLE_VIEWS: {
    status: 422,
    when: "A before/after set from photos of different views (view key and pose target).",
  },
  BEFORE_AFTER_ORDER: {
    status: 422,
    when: "A before/after set whose before photo was not captured earlier than its after photo.",
  },
  REQUIRED_VIEWS_MISSING: {
    status: 422,
    when: "Completing a photo session with required views missing; details.viewKeys lists them.",
  },
  INPUT_QUALITY_INSUFFICIENT: {
    status: 422,
    when: "AI input fails quality checks; details.reasons holds actionable codes.",
  },
  UNSUPPORTED_SIMULATION_INPUT: {
    status: 422,
    when: "View or category outside the validated model domain.",
  },
  PRECONDITION_REQUIRED: { status: 428, when: "If-Match header missing." },
  RATE_LIMITED: { status: 429, when: "Too many requests; honour Retry-After." },
  INTERNAL_ERROR: { status: 500, when: "Unexpected error; details only in server logs, by requestId." },
  SERVICE_UNAVAILABLE: {
    status: 503,
    when: "A dependency is down (AI, storage, integration); honour Retry-After.",
  },
} as const satisfies Record<string, ErrorEntry>;

export type FixedErrorCode = keyof typeof ERROR_CATALOG;

/**
 * Not-found codes are per resource (`PATIENT_NOT_FOUND`, `PHOTO_NOT_FOUND`, …)
 * and always 404. The same body is returned whether the resource does not
 * exist, belongs to another tenant or is outside the caller's scope
 * (spec §6.1.10, no enumeration).
 */
export const NOT_FOUND_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_NOT_FOUND$/;

export function isFixedErrorCode(code: string): code is FixedErrorCode {
  return Object.hasOwn(ERROR_CATALOG, code);
}

/** HTTP status for an error code, or `undefined` for a code outside the catalog. */
export function httpStatusFor(code: string): number | undefined {
  if (isFixedErrorCode(code)) return ERROR_CATALOG[code].status;
  if (NOT_FOUND_PATTERN.test(code)) return 404;
  return undefined;
}

/**
 * Error codes travel as strings, not a closed enum: the catalog grows within
 * v1 and clients must tolerate codes they do not know yet (spec §6.1.1).
 */
export const ErrorCode = z
  .string()
  .regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/)
  .meta({
    id: "ErrorCode",
    description:
      "UPPER_SNAKE error code from the catalog (spec §6.2), or <RESOURCE>_NOT_FOUND. " +
      "Clients must handle codes they do not recognise by falling back to the HTTP status.",
    example: "PATIENT_NOT_FOUND",
  });

export const FieldError = z
  .strictObject({
    path: z
      .string()
      .min(1)
      .meta({ description: "Dotted path of the invalid field.", example: "dateOfBirth" }),
    code: ErrorCode,
    message: z.string().min(1),
  })
  .meta({ id: "FieldError", description: "One invalid field in a VALIDATION_FAILED error." });

/**
 * Code-specific extras. Only `fieldErrors` is shared; other keys (for example
 * `candidates`, `reasons`, `currentVersion`) are defined with the endpoints
 * that return them, so the object stays open.
 */
export const ErrorDetails = z
  .looseObject({
    fieldErrors: z.array(FieldError).optional(),
  })
  .meta({ id: "ErrorDetails", description: "Optional, code-specific details. Never contains PHI." });

export const ErrorEnvelope = z
  .strictObject({
    error: z.strictObject({
      code: ErrorCode,
      message: z.string().min(1).meta({
        description: "Human-readable and safe to show. No stack traces, SQL or storage keys.",
        example: "The requested patient could not be accessed.",
      }),
      requestId: RequestId,
      details: ErrorDetails.optional(),
    }),
  })
  .meta({ id: "ErrorEnvelope", description: "Every error response has this shape (Bible §20.4)." });

export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

/** HTTP statuses that carry an error envelope, with the codes each can return. */
export function errorCodesByStatus(): Map<number, string[]> {
  const byStatus = new Map<number, string[]>([[404, ["<RESOURCE>_NOT_FOUND"]]]);
  for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
    byStatus.set(entry.status, [...(byStatus.get(entry.status) ?? []), code]);
  }
  return new Map([...byStatus.entries()].sort(([a], [b]) => a - b));
}
