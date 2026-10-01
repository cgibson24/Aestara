// A scripted fetch: each test lists the responses the api would give.
import { vi } from "vitest";

export type Handler = (request: Request) => Response | Promise<Response>;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function apiError(status: number, code: string, message: string, details?: unknown): Response {
  return json(status, {
    error: { code, message, requestId: "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f", details },
  });
}

/** Installs a fetch that routes by "METHOD /path" and records every request. */
export function installFetch(routes: Record<string, Handler | Handler[]>) {
  const calls: Request[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      input instanceof Request ? input : new Request(new URL(String(input), "http://localhost"), init);
    calls.push(request.clone());
    const key = `${request.method} ${new URL(request.url).pathname.replace("/api/v1", "")}`;
    const route = queues.get(key);
    if (route === undefined) throw new Error(`Unexpected request ${key}`);
    const handler = Array.isArray(route) ? route.shift() : route;
    if (handler === undefined) throw new Error(`No more responses for ${key}`);
    return handler(request);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

export const ORG = "0192f7c4-0000-7000-8000-000000000001";
export const USER = "0192f7c4-0000-7000-8000-000000000002";

export function session(permissions: string[] = ["user.read", "role.read", "audit.read"]) {
  return {
    sessionId: "0192f7c4-0000-7000-8000-000000000003",
    clientApp: "ADMIN_WEB",
    user: { id: USER, email: "admin@example.test", displayName: "Avery Admin" },
    organization: { id: ORG, name: "Northside Aesthetics", slug: "northside" },
    memberships: [{ organizationId: ORG, organizationName: "Northside Aesthetics", status: "ACTIVE" }],
    permissions,
    platformPermissions: [],
    factors: [],
    idleExpiresAt: "2026-10-01T12:00:00.000Z",
    absoluteExpiresAt: "2026-10-01T20:00:00.000Z",
  };
}

export function tokens(accessToken = "access-1") {
  return { data: { accessToken, accessTokenExpiresAt: "2026-10-01T10:10:00.000Z", session: session() } };
}
