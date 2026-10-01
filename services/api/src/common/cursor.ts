// Opaque, signed, expiring pagination cursors (spec §6.1.6; ADR-0021): the last
// row's sort key and ID, an expiry, and an HMAC over both, bound to the
// operation so a cursor from one list cannot be replayed on another.

import { hmacBase64Url, safeEqual } from "./crypto.ts";
import { ApiError } from "./errors.ts";

const CURSOR_LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface CursorPosition {
  /** Sort key of the last row (ISO timestamp, name key, …). */
  readonly k: string | null;
  /** ID of the last row; the tiebreaker. */
  readonly id: string;
}

export class CursorCodec {
  constructor(private readonly key: Buffer) {}

  encode(scope: string, position: CursorPosition, now = Date.now()): string {
    const payload = Buffer.from(JSON.stringify({ ...position, e: now + CURSOR_LIFETIME_MS })).toString(
      "base64url",
    );
    return `${payload}.${hmacBase64Url(this.key, `${scope}.${payload}`)}`;
  }

  decode(scope: string, cursor: string | undefined, now = Date.now()): CursorPosition | undefined {
    if (cursor === undefined) return undefined;
    const [payload, mac, extra] = cursor.split(".");
    const invalid = new ApiError("VALIDATION_FAILED", "The cursor is not valid or has expired.", {
      fieldErrors: [{ path: "cursor", code: "INVALID_CURSOR", message: "Start again from the first page." }],
    });
    if (!payload || !mac || extra !== undefined) throw invalid;
    if (!safeEqual(mac, hmacBase64Url(this.key, `${scope}.${payload}`))) throw invalid;
    let parsed: { k?: unknown; id?: unknown; e?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw invalid;
    }
    if (typeof parsed.id !== "string" || typeof parsed.e !== "number" || parsed.e < now) throw invalid;
    if (parsed.k !== null && typeof parsed.k !== "string") throw invalid;
    return { k: parsed.k, id: parsed.id };
  }
}

/** Takes `limit + 1` rows and returns the page plus its next cursor. */
export function paginate<T extends { id: string }>(
  rows: readonly T[],
  limit: number,
  cursorOf: (last: T) => string,
): { items: T[]; page: { hasMore: boolean; nextCursor?: string } } {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    page: hasMore && last !== undefined ? { hasMore, nextCursor: cursorOf(last) } : { hasMore: false },
  };
}
