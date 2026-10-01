import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, installFetch, json, tokens } from "./support.ts";

async function renderApp() {
  vi.resetModules();
  const { App } = await import("../src/App.tsx");
  const { AuthProvider } = await import("../src/auth/session.tsx");
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
}

const challenge = (factors: string[], webauthnOptions?: object) =>
  apiError(401, "MFA_REQUIRED", "Enter your second factor.", {
    challengeToken: "challenge-1",
    expiresAt: "2026-10-01T10:05:00.000Z",
    factors,
    enrollmentRequired: false,
    ...(webauthnOptions ? { webauthnOptions } : {}),
  });

describe("sign-in", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("goes from password to TOTP code to the signed-in portal", async () => {
    const { calls } = installFetch({
      "POST /auth/token/refresh": () => apiError(401, "SESSION_INVALID", "No session."),
      "POST /auth/login": () => challenge(["TOTP"]),
      "POST /auth/mfa/verify": () => json(200, tokens()),
      "GET /users": () => json(200, { data: [], page: { nextCursor: null } }),
      "GET /roles": () => json(200, { data: [], page: { nextCursor: null } }),
    });
    const user = userEvent.setup();
    await renderApp();

    await user.type(await screen.findByLabelText("Email"), "admin@example.test");
    await user.type(screen.getByLabelText("Password"), "a long passphrase");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await user.type(await screen.findByLabelText("Code"), "123456");
    expect(screen.queryByRole("button", { name: "Use a passkey" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Users" })).toBeTruthy();
    const verify = calls.find((c) => c.url.endsWith("/auth/mfa/verify"));
    expect(await verify?.json()).toEqual({ challengeToken: "challenge-1", totpCode: "123456" });
  });

  it("offers a passkey when the account has one", async () => {
    installFetch({
      "POST /auth/token/refresh": () => apiError(401, "SESSION_INVALID", "No session."),
      "POST /auth/login": () => challenge(["TOTP", "WEBAUTHN"], { challenge: "abc", allowCredentials: [] }),
    });
    const user = userEvent.setup();
    await renderApp();
    await user.type(await screen.findByLabelText("Email"), "admin@example.test");
    await user.type(screen.getByLabelText("Password"), "a long passphrase");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("button", { name: "Use a passkey" })).toBeTruthy();
    expect(screen.getByLabelText("Code")).toBeTruthy();
  });

  it("shows the server's message when the password is wrong", async () => {
    installFetch({
      "POST /auth/token/refresh": () => apiError(401, "SESSION_INVALID", "No session."),
      "POST /auth/login": () => apiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect."),
    });
    const user = userEvent.setup();
    await renderApp();
    await user.type(await screen.findByLabelText("Email"), "admin@example.test");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Email or password is incorrect.");
  });

  it("restores the session from the refresh cookie and hides pages the role lacks", async () => {
    installFetch({
      "POST /auth/token/refresh": () => json(200, tokens()),
      "GET /auth/session": () =>
        json(200, { data: { ...tokens().data.session, permissions: ["audit.read"] } }),
      "GET /audit/events": () => json(200, { data: [], page: { nextCursor: null } }),
    });
    await renderApp();
    await waitFor(() => expect(screen.getByRole("link", { name: "Audit log" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
  });
});
