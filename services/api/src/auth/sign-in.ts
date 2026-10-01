// What a user may sign in to, read before any tenant is chosen through the one
// SECURITY DEFINER function auth_sign_in_memberships (ADR-0018 K-16), and the
// MFA rule that follows from it (spec §4.2; ADR-0018 K-03; ADR-0021).
import { MfaPolicy } from "@aestara/api-contracts";
import type { ClientApp } from "@aestara/shared-types";
import type { Tx } from "../db/database.ts";
import { ADMIN_ROLE_KEYS, type Catalog } from "./catalog.ts";

export interface SignInRow {
  readonly organizationId: string | null;
  readonly organizationName: string | null;
  readonly organizationStatus: string | null;
  readonly membershipStatus: string | null;
  readonly mfaPolicy: unknown;
  readonly roleKeys: string[];
}

export interface SignInView {
  readonly memberships: SignInRow[];
  /** Memberships the user can work in now: membership and organization both ACTIVE. */
  readonly active: SignInRow[];
  /** Role keys held at platform scope. */
  readonly platformRoleKeys: string[];
}

export async function signInView(tx: Tx, userId: string): Promise<SignInView> {
  const rows = await tx.$queryRaw<
    {
      organization_id: string | null;
      organization_name: string | null;
      organization_status: string | null;
      membership_status: string | null;
      mfa_policy: unknown;
      role_keys: string[];
    }[]
  >`SELECT * FROM auth_sign_in_memberships(${userId}::uuid)`;
  const all: SignInRow[] = rows.map((r) => ({
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    organizationStatus: r.organization_status,
    membershipStatus: r.membership_status,
    mfaPolicy: r.mfa_policy,
    roleKeys: r.role_keys,
  }));
  const memberships = all.filter((r) => r.organizationId !== null);
  return {
    memberships,
    active: memberships.filter((r) => r.membershipStatus === "ACTIVE" && r.organizationStatus === "ACTIVE"),
    platformRoleKeys: all.find((r) => r.organizationId === null)?.roleKeys ?? [],
  };
}

function organizationRequiresMfa(row: SignInRow): boolean {
  const policy = MfaPolicy.safeParse(row.mfaPolicy);
  return (policy.success && policy.data === "ALL_STAFF") || row.roleKeys.some((k) => ADMIN_ROLE_KEYS.has(k));
}

/**
 * MFA is always required on the admin web, for platform operators and for any
 * admin role; an organization may require it for all staff. Before an
 * organization is chosen, the strictest of the user's active memberships applies.
 */
export function mfaRequired(view: SignInView, app: ClientApp): boolean {
  return app === "ADMIN_WEB" || view.platformRoleKeys.length > 0 || view.active.some(organizationRequiresMfa);
}

/** The rule for one organization, applied again when switching to it (ADR-0021). */
export function mfaRequiredIn(view: SignInView, organizationId: string, app: ClientApp): boolean {
  const row = view.active.find((r) => r.organizationId === organizationId);
  return app === "ADMIN_WEB" || (row !== undefined && organizationRequiresMfa(row));
}

export function permissionsOf(catalog: Catalog, roleKeys: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const roleKey of roleKeys) for (const p of catalog.roleByKey(roleKey)?.permissions ?? []) keys.add(p);
  return [...keys].sort();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
