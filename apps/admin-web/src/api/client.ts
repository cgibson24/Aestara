// The typed API client (spec §6.8: types generated from openapi.json by
// openapi-typescript). The access token lives in memory only; the refresh token
// is an HttpOnly cookie the browser sends to /api/v1/auth/token/refresh alone
// (spec §4.2; ADR-0018 K-11). A 401 on any call triggers one refresh, then a retry.
import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema.ts";

export type Schemas = components["schemas"];
export type ErrorBody = Schemas["ErrorEnvelope"]["error"];

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

let accessToken: string | undefined;
let refreshing: Promise<boolean> | undefined;
let onSignedOut: (() => void) | undefined;

export function setAccessToken(token: string | undefined): void {
  accessToken = token;
}

export function whenSignedOut(callback: () => void): void {
  onSignedOut = callback;
}

/** Rotates the refresh cookie and returns whether a new access token was issued. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/token/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { data: Schemas["AuthTokens"] };
      accessToken = body.data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

const RETRIED = "x-aestara-retried";

const auth: Middleware = {
  onRequest({ request }) {
    if (accessToken && !request.headers.has("authorization"))
      request.headers.set("authorization", `Bearer ${accessToken}`);
    request.headers.set("x-client-request-id", crypto.randomUUID());
    return request;
  },
  async onResponse({ request, response }) {
    const path = new URL(request.url, window.location.origin).pathname;
    if (response.status !== 401 || request.headers.has(RETRIED) || path.includes("/auth/")) return response;
    if (!(await refreshSession())) {
      onSignedOut?.();
      return response;
    }
    const retry = new Request(request, { headers: new Headers(request.headers) });
    retry.headers.set("authorization", `Bearer ${accessToken}`);
    retry.headers.set(RETRIED, "1");
    return fetch(retry);
  },
};

export const api = createClient<paths>({ baseUrl: API_BASE, credentials: "include" });
api.use(auth);

/** A thrown API error with the envelope's code and message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Unwraps an openapi-fetch result: the data, or an ApiError from the envelope. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || result.data === undefined) {
    const e = (result.error as { error?: ErrorBody } | undefined)?.error;
    throw new ApiError(
      result.response.status,
      e?.code ?? "INTERNAL_ERROR",
      e?.message ?? "Something went wrong.",
      e?.requestId,
      e?.details as Record<string, unknown> | undefined,
    );
  }
  return result.data;
}

/** A version for If-Match from a resource version (spec §6.1.7). */
export const ifMatch = (version: number) => `"v${version}"`;
