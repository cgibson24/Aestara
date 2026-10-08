// Per-request state, attached to the Fastify request by the request hooks and
// the operation pipeline. Nothing here is ever logged except requestId.
import type { EndpointDefinition } from "@aestara/api-contracts";
import type { ClientApp, RoleAssignmentScope } from "@aestara/shared-types";
import type { Tx } from "../db/database.ts";

export interface Grant {
  readonly id: string;
  readonly roleId: string;
  readonly roleKey: string;
  readonly scope: RoleAssignmentScope;
  readonly practiceId: string | null;
  readonly locationId: string | null;
  readonly permissions: ReadonlySet<string>;
}

export interface AuthContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly clientApp: ClientApp;
  readonly deviceId: string | null;
  /** The session's active organization; null for platform sessions and before one is chosen. */
  readonly organizationId: string | null;
  /** Where this request's permissions were evaluated. */
  readonly scope: "organization" | "platform" | "none";
  readonly grants: readonly Grant[];
  readonly permissions: ReadonlySet<string>;
  readonly mfaVerifiedAt: Date | null;
  readonly sessionCreatedAt: Date;
  readonly amr: readonly string[];
}

/** The in-clinic hand-off a /handoff request's token belongs to (ADR-0029). */
export interface HandoffContext {
  readonly id: string;
  readonly purpose: "CONSENT_SIGNING" | "PLAN_RESPONSE";
  readonly patientId: string;
  readonly consentAssignmentId: string | null;
  readonly treatmentPlanId: string | null;
  readonly absoluteExpiresAt: Date;
}

export interface RequestContext {
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly origin: string | null;
  readonly startedAt: number;
  operation?: EndpointDefinition | undefined;
  auth?: AuthContext | undefined;
  /** Set on /handoff routes: the hand-off the token belongs to. */
  handoff?: HandoffContext | undefined;
  /** The request transaction, when the operation runs in one. */
  tx?: Tx | undefined;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  ifMatch?: number | undefined;
  idempotencyKey?: string | undefined;
  /** Raw cookie header value of the refresh cookie (admin web). */
  refreshCookie?: string | undefined;
  /** Cookies to set on the response. */
  setCookies: string[];
  /** Work to run once the request transaction has committed (emails). Never throws. */
  afterCommit: (() => Promise<void>)[];
}

declare module "fastify" {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

export function requireAuth(ctx: RequestContext): AuthContext {
  if (ctx.auth === undefined) throw new Error("Operation needs an authenticated context");
  return ctx.auth;
}

export function requireTx(ctx: RequestContext): Tx {
  if (ctx.tx === undefined) throw new Error("Operation needs a request transaction");
  return ctx.tx;
}

export function requireOrganization(ctx: RequestContext): string {
  const org = requireAuth(ctx).organizationId;
  if (org === null) throw new Error("Operation needs an organization");
  return org;
}

/** Grants of the caller that carry a permission. */
export function grantsWith(auth: AuthContext, permission: string): Grant[] {
  return auth.grants.filter((g) => g.permissions.has(permission));
}
