// Practice and location scope of grants (spec §4.5 rule 3, §4.6; ADR-0018 K-07).
// Reads span the whole organization (D-01); scope limits where a caller may
// create or change practice-owned records and which users it may manage.
import type { RoleAssignmentScope } from "@aestara/shared-types";
import { type AuthContext, type Grant, grantsWith } from "./context.ts";
import { ApiError } from "./errors.ts";

export interface ScopedTarget {
  readonly scope: RoleAssignmentScope;
  readonly practiceId: string | null;
  readonly locationId: string | null;
}

/** Whether a grant's scope contains a target scope (an assignment, or a practice-owned record). */
export function covers(grant: Grant, target: ScopedTarget): boolean {
  switch (grant.scope) {
    case "ORGANIZATION":
      return target.scope !== "PLATFORM";
    case "PRACTICE":
      return (
        (target.scope === "PRACTICE" || target.scope === "LOCATION") && target.practiceId === grant.practiceId
      );
    case "LOCATION":
      return target.scope === "LOCATION" && target.locationId === grant.locationId;
    default:
      return false;
  }
}

/** A write to a practice-owned record: an organization grant, or one whose scope contains the record. */
export function requireScopedPermission(auth: AuthContext, permission: string, target: ScopedTarget): void {
  if (!grantsWith(auth, permission).some((g) => covers(g, target))) throw new ApiError("PERMISSION_DENIED");
}

/** Creating something organization-wide needs an organization-scope grant. */
export function requireOrganizationGrant(auth: AuthContext, permission: string): void {
  if (!grantsWith(auth, permission).some((g) => g.scope === "ORGANIZATION"))
    throw new ApiError("PERMISSION_DENIED");
}

/**
 * Separation of duties rule 3: the caller manages another user only when one
 * of its grants for the action contains every active grant of that user, or is
 * organization-wide.
 */
export function requireManageUser(
  auth: AuthContext,
  permission: string,
  targetGrants: readonly ScopedTarget[],
): void {
  const applicable = grantsWith(auth, permission);
  const ok = applicable.some((g) => g.scope === "ORGANIZATION" || targetGrants.every((t) => covers(g, t)));
  if (!ok)
    throw new ApiError(
      "SEPARATION_OF_DUTIES",
      "This user has access outside your scope. An organization administrator must make this change.",
    );
}

/** Separation of duties rule 1: never on one's own account. */
export function requireNotSelf(auth: AuthContext, targetUserId: string): void {
  if (auth.userId === targetUserId)
    throw new ApiError(
      "SEPARATION_OF_DUTIES",
      "Another administrator must make this change to your own account.",
    );
}
