// Sign-in state for the admin web (spec §4.2; ADR-0021). The admin web always
// needs a second factor: password → MFA challenge (or TOTP enrollment with
// the challenge when none is set up) → choose an organization if several.
// On load, the refresh cookie restores the session without a password.
import { startAuthentication } from "@simplewebauthn/browser";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  API_BASE,
  ApiError,
  api,
  refreshSession,
  type Schemas,
  setAccessToken,
  unwrap,
  whenSignedOut,
} from "../api/client.ts";
import { queryClient } from "../api/queries.ts";

export type Session = Schemas["SessionInfo"];
export type Challenge = Schemas["MfaChallengeDetails"];
export type WebAuthnJson = Schemas["WebAuthnJson"];

export type AuthState =
  | { readonly status: "loading" }
  | { readonly status: "signedOut"; readonly notice?: string }
  | { readonly status: "challenge"; readonly challenge: Challenge }
  | { readonly status: "signedIn"; readonly session: Session };

interface AuthContextValue {
  readonly state: AuthState;
  signIn(email: string, password: string): Promise<void>;
  verify(code: string): Promise<void>;
  verifyPasskey(): Promise<void>;
  startEnrollment(): Promise<{ id: string; secret: string; otpauthUri: string }>;
  confirmEnrollment(id: string, code: string): Promise<void>;
  chooseOrganization(organizationId: string): Promise<void>;
  signOut(): Promise<void>;
  reload(): Promise<void>;
  can(permission: string): boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) throw new Error("useAuth outside AuthProvider");
  return value;
}

function challengeFrom(error: unknown): Challenge | undefined {
  if (error instanceof ApiError && error.code === "MFA_REQUIRED" && error.details)
    return error.details as unknown as Challenge;
  return undefined;
}

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const loadSession = useCallback(async () => {
    const session = unwrap(await api.GET("/auth/session")).data;
    setState({ status: "signedIn", session });
  }, []);

  useEffect(() => {
    whenSignedOut(() => {
      setAccessToken(undefined);
      queryClient.clear();
      setState({ status: "signedOut", notice: "Your session has ended. Sign in again." });
    });
    void (async () => {
      if (await refreshSession()) await loadSession().catch(() => setState({ status: "signedOut" }));
      else setState({ status: "signedOut" });
    })();
  }, [loadSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.POST("/auth/login", { body: { email, password, clientApp: "ADMIN_WEB" } });
    try {
      const tokens = unwrap(result).data;
      setAccessToken(tokens.accessToken);
      setState({ status: "signedIn", session: tokens.session });
    } catch (error) {
      const challenge = challengeFrom(error);
      if (challenge === undefined) throw error;
      setState({ status: "challenge", challenge });
    }
  }, []);

  /** Answers the challenge with a TOTP code or a passkey assertion. */
  const answer = useCallback(
    async (factor: { totpCode: string } | { webauthnResponse: WebAuthnJson }) => {
      if (state.status !== "challenge") return;
      const result = await api.POST("/auth/mfa/verify", {
        body: { challengeToken: state.challenge.challengeToken, ...factor },
      });
      try {
        const tokens = unwrap(result).data;
        setAccessToken(tokens.accessToken);
        setState({ status: "signedIn", session: tokens.session });
      } catch (error) {
        const challenge = challengeFrom(error);
        if (challenge !== undefined) setState({ status: "challenge", challenge });
        throw error;
      }
    },
    [state],
  );

  const verify = useCallback((code: string) => answer({ totpCode: code }), [answer]);

  const verifyPasskey = useCallback(async () => {
    if (state.status !== "challenge" || state.challenge.webauthnOptions === undefined) return;
    const assertion = await startAuthentication({
      optionsJSON: state.challenge.webauthnOptions as unknown as Parameters<
        typeof startAuthentication
      >[0]["optionsJSON"],
    });
    await answer({ webauthnResponse: assertion as unknown as WebAuthnJson });
  }, [state, answer]);

  const startEnrollment = useCallback(async () => {
    if (state.status !== "challenge") throw new Error("No sign-in challenge");
    const enrollment = unwrap(
      await api.POST("/auth/mfa/enrollments", {
        params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        body: { type: "TOTP", challengeToken: state.challenge.challengeToken },
      }),
    ).data;
    if (enrollment.totp === undefined) throw new Error("No authenticator secret returned");
    return { id: enrollment.id, secret: enrollment.totp.secret, otpauthUri: enrollment.totp.otpauthUri };
  }, [state]);

  const confirmEnrollment = useCallback(
    async (id: string, code: string) => {
      if (state.status !== "challenge") return;
      const result = await api.POST("/auth/mfa/enrollments/{id}/confirm", {
        params: { path: { id } },
        body: { totpCode: code, challengeToken: state.challenge.challengeToken },
      });
      if (!result.response.ok) unwrap(result as { data?: unknown; error?: unknown; response: Response });
      setState({
        status: "challenge",
        challenge: { ...state.challenge, enrollmentRequired: false, factors: ["TOTP"] },
      });
    },
    [state],
  );

  const chooseOrganization = useCallback(async (organizationId: string) => {
    const result = unwrap(await api.PUT("/auth/session/organization", { body: { organizationId } })).data;
    setAccessToken(result.accessToken);
    // Another organization is another tenant: nothing cached may carry over.
    queryClient.clear();
    setState({ status: "signedIn", session: result.session });
  }, []);

  const signOut = useCallback(async () => {
    await api.POST("/auth/logout").catch(() => undefined);
    setAccessToken(undefined);
    queryClient.clear();
    setState({ status: "signedOut" });
  }, []);

  const can = useCallback(
    (permission: string) =>
      state.status === "signedIn" &&
      (state.session.permissions.includes(permission) ||
        state.session.platformPermissions.includes(permission)),
    [state],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signIn,
      verify,
      verifyPasskey,
      startEnrollment,
      confirmEnrollment,
      chooseOrganization,
      signOut,
      reload: loadSession,
      can,
    }),
    [
      state,
      signIn,
      verify,
      verifyPasskey,
      startEnrollment,
      confirmEnrollment,
      chooseOrganization,
      signOut,
      loadSession,
      can,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Public, token-in-body endpoints that work without a session (K-09). */
export async function postPublic(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = ((await res.json().catch(() => ({}))) as { error?: { code: string; message: string } })
      .error;
    throw new ApiError(
      res.status,
      error?.code ?? "INTERNAL_ERROR",
      error?.message ?? "Something went wrong.",
    );
  }
}
