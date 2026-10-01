// A request context for work the system does on its own (scan results,
// derivative results, expiry): no signed-in user, so audit events are written
// with actor type SYSTEM and a fresh request ID for correlation.
import { randomUUID } from "node:crypto";
import type { RequestContext } from "../common/context.ts";

export function systemContext(): RequestContext {
  return {
    requestId: randomUUID(),
    ipAddress: null,
    userAgent: null,
    origin: null,
    startedAt: Date.now(),
    params: {},
    query: {},
    body: undefined,
    setCookies: [],
    afterCommit: [],
  };
}
