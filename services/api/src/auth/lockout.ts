// Progressive sign-in lockout, computed from the LoginEvent ledger (spec §4.2;
// ADR-0018 K-15; ADR-0021 "Lockout"). Keyed on an HMAC of the normalized
// identifier, so known and unknown identifiers behave the same. Failures that
// count: INVALID_CREDENTIALS and MFA_FAILED in the last 24 hours, since the
// later of the last success and the current password. Every 5 failures lock
// for 15 minutes, doubling with each further 5, up to 24 hours.
import type { Tx } from "../db/database.ts";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const BASE_LOCK_MS = 15 * 60 * 1000;
const FAILURES_PER_LOCK = 5;

export interface LockState {
  readonly locked: boolean;
  /** Seconds until the lock ends, when locked. */
  readonly retryAfterSeconds: number;
}

/** Lock state from the times of the counted failures, oldest first. */
export function lockFromFailures(failures: readonly Date[], now: number): LockState {
  const locks = Math.floor(failures.length / FAILURES_PER_LOCK);
  if (locks === 0) return { locked: false, retryAfterSeconds: 0 };
  const lockStartedAt = failures[locks * FAILURES_PER_LOCK - 1]?.getTime() ?? now;
  const duration = Math.min(BASE_LOCK_MS * 2 ** (locks - 1), WINDOW_MS);
  const endsAt = lockStartedAt + duration;
  return endsAt > now
    ? { locked: true, retryAfterSeconds: Math.ceil((endsAt - now) / 1000) }
    : { locked: false, retryAfterSeconds: 0 };
}

export async function lockState(
  tx: Tx,
  identifierHash: string,
  passwordSetAt: Date | null,
  now = Date.now(),
): Promise<LockState> {
  const windowStart = new Date(now - WINDOW_MS);
  const lastSuccess = await tx.loginEvent.findFirst({
    where: { identifierHash, eventType: "LOGIN_SUCCESS", occurredAt: { gte: windowStart } },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  const anchors = [windowStart, lastSuccess?.occurredAt, passwordSetAt].filter(
    (d): d is Date => d instanceof Date,
  );
  const since = new Date(Math.max(...anchors.map((d) => d.getTime())));
  const failures = await tx.loginEvent.findMany({
    where: {
      identifierHash,
      eventType: "LOGIN_FAILURE",
      failureReason: { in: ["INVALID_CREDENTIALS", "MFA_FAILED"] },
      occurredAt: { gt: since },
    },
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
    take: 500,
  });
  return lockFromFailures(
    failures.map((f) => f.occurredAt),
    now,
  );
}
