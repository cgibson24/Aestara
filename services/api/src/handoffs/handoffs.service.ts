// The in-clinic hand-off (UD-31; spec §6.3 "In-clinic hand-off"; ADR-0028 K4-13,
// ADR-0029). Staff open a hand-off scoped to one consent or one plan option and
// hand their device to the patient. The token is `aeh.<org>.<id>.<secret>`; only
// the secret's SHA-256 is stored. It reaches the /handoff routes only, ends after
// 15 idle minutes or 60 in all, and dies with the opener's session. A request
// made with it acts as the opener (their session and device) with no
// permissions, so its audit rows name the staff member who opened it.
import { Injectable } from "@nestjs/common";
import type { AuthContext, HandoffContext, RequestContext } from "../common/context.ts";
import { requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { randomToken, safeEqual, sha256Hex } from "../common/crypto.ts";
import { ApiError, notFound } from "../common/errors.ts";
import type { Tx } from "../db/database.ts";

export const HANDOFF_IDLE_MS = 15 * 60_000;
export const HANDOFF_MAX_MS = 60 * 60_000;
const PREFIX = "aeh";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface HandoffToken {
  readonly organizationId: string;
  readonly handoffId: string;
  readonly secret: string;
}

export function requireHandoff(ctx: RequestContext): HandoffContext {
  if (ctx.handoff === undefined) throw new Error("Operation needs a hand-off");
  return ctx.handoff;
}

/** Splits a bearer value into a hand-off token, or undefined if it is not one. */
export function parseHandoffToken(bearer: string | undefined): HandoffToken | undefined {
  const parts = bearer?.split(".");
  if (parts?.length !== 4 || parts[0] !== PREFIX) return undefined;
  const [, organizationId = "", handoffId = "", secret = ""] = parts;
  if (!UUID.test(organizationId) || !UUID.test(handoffId) || !/^[A-Za-z0-9_-]{43}$/.test(secret))
    return undefined;
  return { organizationId, handoffId, secret };
}

const SESSION_INVALID = () =>
  new ApiError("SESSION_INVALID", "This hand-off has ended. Hand the device back.");

@Injectable()
export class HandoffsService {
  /**
   * Opens a hand-off for one target, revoking one still open for it. Needs a
   * session from a registered device: the token is bound to both.
   */
  async open(
    ctx: RequestContext,
    target:
      | { purpose: "PLAN_RESPONSE"; patientId: string; treatmentPlanId: string }
      | { purpose: "CONSENT_SIGNING"; patientId: string; consentAssignmentId: string },
  ) {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    const organizationId = requireOrganization(ctx);
    if (auth.deviceId === null)
      throw new ApiError("CONFLICT", "Open the hand-off from the provider app on its registered device.");
    const now = new Date();
    const scope =
      target.purpose === "PLAN_RESPONSE"
        ? { treatmentPlanId: target.treatmentPlanId }
        : { consentAssignmentId: target.consentAssignmentId };
    await tx.patientHandoff.updateMany({
      where: { ...scope, endedAt: null },
      data: { endedAt: now, endReason: "REVOKED" },
    });
    const secret = randomToken(32);
    const absoluteExpiresAt = new Date(now.getTime() + HANDOFF_MAX_MS);
    const created = await tx.patientHandoff.create({
      data: {
        organizationId,
        patientId: target.patientId,
        purpose: target.purpose,
        ...scope,
        openedById: auth.userId,
        sessionId: auth.sessionId,
        deviceId: auth.deviceId,
        tokenHash: sha256Hex(secret),
        identityConfirmedAt: now,
        openedAt: now,
        lastActivityAt: now,
        absoluteExpiresAt,
      },
    });
    return {
      handoffId: created.id,
      purpose: target.purpose,
      token: [PREFIX, organizationId, created.id, secret].join("."),
      absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      idleTimeoutSeconds: HANDOFF_IDLE_MS / 1000,
    };
  }

  /**
   * Checks a token inside its organization's transaction and returns the
   * opener's identity without permissions. Every check failure is the same 401.
   */
  async authenticate(tx: Tx, token: HandoffToken): Promise<{ auth: AuthContext; handoff: HandoffContext }> {
    const h = await tx.patientHandoff.findUnique({
      where: { id: token.handoffId },
      include: {
        session: {
          select: { id: true, clientApp: true, createdAt: true, revokedAt: true, absoluteExpiresAt: true },
        },
      },
    });
    const now = Date.now();
    if (
      h === null ||
      !safeEqual(h.tokenHash, sha256Hex(token.secret)) ||
      h.endedAt !== null ||
      now - h.lastActivityAt.getTime() > HANDOFF_IDLE_MS ||
      now >= h.absoluteExpiresAt.getTime() ||
      h.session.revokedAt !== null ||
      now >= h.session.absoluteExpiresAt.getTime()
    )
      throw SESSION_INVALID();
    await tx.patientHandoff.update({ where: { id: h.id }, data: { lastActivityAt: new Date(now) } });
    return {
      auth: {
        userId: h.openedById,
        sessionId: h.sessionId,
        clientApp: h.session.clientApp,
        deviceId: h.deviceId,
        organizationId: token.organizationId,
        scope: "organization",
        grants: [],
        permissions: new Set(),
        mfaVerifiedAt: null,
        sessionCreatedAt: h.session.createdAt,
        amr: [],
      },
      handoff: {
        id: h.id,
        purpose: h.purpose,
        patientId: h.patientId,
        consentAssignmentId: h.consentAssignmentId,
        treatmentPlanId: h.treatmentPlanId,
        absoluteExpiresAt: h.absoluteExpiresAt,
      },
    };
  }

  /** The patient finished: the token stops working. */
  async complete(tx: Tx, id: string): Promise<void> {
    await tx.patientHandoff.update({ where: { id }, data: { endedAt: new Date(), endReason: "COMPLETED" } });
  }

  /** The staff member who opened it takes the device back. Ending an ended hand-off changes nothing. */
  async end(ctx: RequestContext, id: string): Promise<void> {
    const tx = requireTx(ctx);
    const h = await tx.patientHandoff.findUnique({ where: { id } });
    if (h === null || h.openedById !== requireAuth(ctx).userId) throw notFound("HANDOFF_NOT_FOUND");
    if (h.endedAt === null)
      await tx.patientHandoff.update({ where: { id }, data: { endedAt: new Date(), endReason: "EXITED" } });
  }
}
