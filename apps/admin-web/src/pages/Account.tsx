// The signed-in person's own security (spec §4.2; ADR-0021): devices and
// sessions, password change, and adding a passkey. Changing a password or
// adding a factor needs a recent second factor (step-up, 15 minutes).
import { startRegistration } from "@simplewebauthn/browser";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api, type Schemas, unwrap } from "../api/client.ts";
import type { WebAuthnJson } from "../auth/session.tsx";
import {
  Banner,
  Button,
  ErrorState,
  Field,
  formatDateTime,
  LoadingState,
  messageOf,
  words,
} from "../ui/kit.tsx";

type SessionItem = Schemas["SessionListItem"];
type Notice = { tone: "success" | "danger"; text: string } | undefined;

function stepUpMessage(error: unknown): string {
  return error instanceof ApiError && error.code === "REAUTHENTICATION_REQUIRED"
    ? "For your security, sign out and sign in again, then retry within 15 minutes."
    : messageOf(error);
}

export function AccountPage() {
  return (
    <div className="page">
      <h1>Your account</h1>
      <Sessions />
      <ChangePassword />
      <Passkeys />
    </div>
  );
}

function Sessions() {
  const [sessions, setSessions] = useState<SessionItem[]>();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<Notice>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setSessions(unwrap(await api.GET("/auth/sessions", { params: { query: { limit: 50 } } })).data);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    setNotice(undefined);
    try {
      const result = await api.DELETE("/auth/sessions/{id}", { params: { path: { id } } });
      if (!result.response.ok) unwrap(result as { data?: unknown; error?: unknown; response: Response });
      setNotice({ tone: "success", text: "That device is signed out." });
      await load();
    } catch (err) {
      setNotice({ tone: "danger", text: messageOf(err) });
    }
  };

  return (
    <section className="card stack" aria-labelledby="sessions-title">
      <h2 id="sessions-title">Signed-in devices</h2>
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      {error !== undefined ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : sessions === undefined ? (
        <LoadingState label="Loading devices" />
      ) : (
        <ul className="plain-list">
          {sessions.map((s) => (
            <li key={s.id} className="row">
              <span>
                {s.device?.name ?? words(s.clientApp)}{" "}
                <span className="muted">
                  {s.current ? "This browser" : `Last used ${formatDateTime(s.lastUsedAt ?? s.createdAt)}`}
                </span>
              </span>
              {!s.current && (
                <Button variant="quiet" onClick={() => void revoke(s.id)}>
                  Sign out this device
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await api.POST("/auth/password/change", {
        body: { currentPassword: current, newPassword: next },
      });
      if (!result.response.ok) unwrap(result as { data?: unknown; error?: unknown; response: Response });
      setCurrent("");
      setNext("");
      setNotice({ tone: "success", text: "Password changed. Your other devices are signed out." });
    } catch (err) {
      setNotice({ tone: "danger", text: stepUpMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby="password-title">
      <h2 id="password-title">Password</h2>
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      <form className="stack" onSubmit={submit}>
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters. Avoid common passwords and your name or email."
          minLength={12}
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={busy}>
          Change password
        </Button>
      </form>
    </section>
  );
}

function Passkeys() {
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== "undefined" && "PublicKeyCredential" in window;

  const add = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      const enrollment = unwrap(
        await api.POST("/auth/mfa/enrollments", {
          params: { header: { "Idempotency-Key": crypto.randomUUID() } },
          body: { type: "WEBAUTHN" },
        }),
      ).data;
      if (enrollment.webauthnOptions === undefined) throw new Error("No passkey options returned");
      const registration = await startRegistration({
        optionsJSON: enrollment.webauthnOptions as unknown as Parameters<
          typeof startRegistration
        >[0]["optionsJSON"],
      });
      const result = await api.POST("/auth/mfa/enrollments/{id}/confirm", {
        params: { path: { id: enrollment.id } },
        body: { webauthnResponse: registration as unknown as WebAuthnJson },
      });
      if (!result.response.ok) unwrap(result as { data?: unknown; error?: unknown; response: Response });
      setNotice({ tone: "success", text: "Passkey added. You can use it at your next sign-in." });
    } catch (err) {
      setNotice({ tone: "danger", text: stepUpMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby="passkey-title">
      <h2 id="passkey-title">Passkeys</h2>
      <p className="muted">
        A passkey on this computer or your phone can replace the authenticator code when you sign in.
      </p>
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      {supported ? (
        <Button variant="secondary" disabled={busy} onClick={() => void add()}>
          Add a passkey
        </Button>
      ) : (
        <p>This browser does not support passkeys.</p>
      )}
    </section>
  );
}
