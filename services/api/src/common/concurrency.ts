// Optimistic concurrency (spec §6.1.7): a change applies only to the version
// named in If-Match; a stale version returns 412 with the current version.
import type { RequestContext } from "./context.ts";
import { ApiError, versionConflict } from "./errors.ts";

/** Checks If-Match against the current version. `required` false allows a missing header (create-or-replace). */
export function checkVersion(ctx: RequestContext, current: number, required = true): void {
  if (ctx.ifMatch === undefined) {
    if (required) throw new ApiError("PRECONDITION_REQUIRED");
    return;
  }
  if (ctx.ifMatch !== current) throw versionConflict(current);
}

/** A conditional update matched no row: someone else changed it first. */
export function lostRace(current: number): ApiError {
  return versionConflict(current);
}

export const iso = (d: Date): string => d.toISOString();

/** Drops undefined keys (absent fields); null stays, meaning "clear" in an update. */
export function present<T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

/** Copies only defined values: absent optional fields are omitted, not null (spec §6.1.2). */
export function defined<T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], null>;
  };
}

const LOCKABLE = new Set([
  "Document",
  "Organization",
  "Practice",
  "Location",
  "Membership",
  "Patient",
  "PatientContact",
  "ProviderProfile",
  "StaffProfile",
  "OrganizationSetting",
  "PhotographyProtocol",
  "PhotoSession",
  "PatientPhoto",
  "PhotoPermission",
  "MediaRelease",
  "AIJob",
  "PracticeSetting",
  "StorageObject",
  "Consultation",
  "ConsultationNote",
  "PatientConcern",
  "PatientMedicalHistory",
  "BeforeAfterSet",
  "PhotoAnnotation",
]);

/**
 * Locks a row for the rest of the transaction before its version is checked, so
 * a concurrent writer waits and then sees the new version (412, never a lost
 * update). The table name comes from a fixed list, never from input.
 */
export async function lockRow(
  tx: { $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> },
  table: string,
  id: string,
): Promise<void> {
  if (!LOCKABLE.has(table)) throw new Error(`Table ${table} is not lockable`);
  await tx.$executeRawUnsafe(`SELECT 1 FROM "${table}" WHERE id = $1::uuid FOR UPDATE`, id);
}
