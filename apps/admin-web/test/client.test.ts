import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, installFetch, json, tokens } from "./support.ts";

// The client captures fetch when it is created, so it is imported after each stub.
async function loadClient() {
  vi.resetModules();
  return import("../src/api/client.ts");
}

const list = { data: [], page: { nextCursor: null } };

describe("api client", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("sends the access token and a correlation ID", async () => {
    const { calls } = installFetch({ "GET /users": () => json(200, list) });
    const client = await loadClient();
    client.setAccessToken("access-1");
    await client.api.GET("/users");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
    expect(calls[0]?.headers.get("x-client-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refreshes once on a 401, then retries with the new token", async () => {
    const { calls } = installFetch({
      "GET /users": [() => apiError(401, "UNAUTHENTICATED", "Sign in to continue."), () => json(200, list)],
      "POST /auth/token/refresh": () => json(200, tokens("access-2")),
    });
    const client = await loadClient();
    client.setAccessToken("expired");
    const result = await client.api.GET("/users");
    expect(result.response.status).toBe(200);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/api/v1/users",
      "/api/v1/auth/token/refresh",
      "/api/v1/users",
    ]);
    expect(calls[2]?.headers.get("authorization")).toBe("Bearer access-2");
    // The refresh token is a cookie; the browser sends it, the page never sees it.
    expect(await calls[1]?.text()).toBe("{}");
  });

  it("shares one refresh between concurrent 401s (refresh tokens are single-use)", async () => {
    let refreshes = 0;
    installFetch({
      "GET /users": [
        () => apiError(401, "UNAUTHENTICATED", "Sign in."),
        () => apiError(401, "UNAUTHENTICATED", "Sign in."),
        () => json(200, list),
        () => json(200, list),
      ],
      "POST /auth/token/refresh": async () => {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, tokens("access-2"));
      },
    });
    const client = await loadClient();
    client.setAccessToken("expired");
    await Promise.all([client.api.GET("/users"), client.api.GET("/users")]);
    expect(refreshes).toBe(1);
  });

  it("ends the session when the refresh fails", async () => {
    installFetch({
      "GET /users": () => apiError(401, "UNAUTHENTICATED", "Sign in."),
      "POST /auth/token/refresh": () => apiError(401, "SESSION_INVALID", "Sign in again."),
    });
    const client = await loadClient();
    const ended = vi.fn();
    client.whenSignedOut(ended);
    client.setAccessToken("expired");
    const result = await client.api.GET("/users");
    expect(result.response.status).toBe(401);
    expect(ended).toHaveBeenCalledOnce();
  });

  it("never retries an /auth/ call", async () => {
    const { calls } = installFetch({
      "POST /auth/login": () => apiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect."),
    });
    const client = await loadClient();
    await client.api.POST("/auth/login", {
      body: { email: "a@example.test", password: "x", clientApp: "ADMIN_WEB" },
    });
    expect(calls).toHaveLength(1);
  });

  it("turns the error envelope into an ApiError", async () => {
    installFetch({
      "GET /users": () =>
        apiError(400, "VALIDATION_FAILED", "The request is not valid.", {
          fieldErrors: [{ path: "limit", code: "TOO_BIG", message: "At most 100." }],
        }),
    });
    const client = await loadClient();
    const kit = await import("../src/ui/kit.tsx");
    const result = await client.api.GET("/users");
    let caught: unknown;
    try {
      client.unwrap(result);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(client.ApiError);
    const error = caught as InstanceType<typeof client.ApiError>;
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.requestId).toBe("0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f");
    expect(kit.messageOf(error)).toBe("At most 100.");
  });

  it("formats If-Match from a version", async () => {
    const client = await loadClient();
    expect(client.ifMatch(3)).toBe('"v3"');
  });
});
