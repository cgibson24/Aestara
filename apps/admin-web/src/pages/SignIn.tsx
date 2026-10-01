// Sign-in, second factor, authenticator enrollment, organization choice, and
// the public pages reached from email links (token in the URL fragment, posted
// in the body; ADR-0018 K-09, ADR-0021).
import { type FormEvent, useEffect, useState } from "react";
import { postPublic, useAuth } from "../auth/session.tsx";
import { Banner, Button, Field, messageOf } from "../ui/kit.tsx";

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="brand">Aestara</p>
        <h1 id="auth-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}

export function SignInPage({ notice }: { notice?: string | undefined }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Sign in">
      {notice && <Banner tone="info">{notice}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
      <form onSubmit={submit} className="stack">
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <a href="/forgot-password">Forgot your password?</a>
    </AuthCard>
  );
}

export function SecondFactorPage() {
  const { state, verify, verifyPasskey, startEnrollment, confirmEnrollment, signOut } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [enrollment, setEnrollment] = useState<{ id: string; secret: string; otpauthUri: string }>();
  const [busy, setBusy] = useState(false);
  if (state.status !== "challenge") return null;
  const mustEnroll = state.challenge.enrollmentRequired;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (mustEnroll)
    return (
      <AuthCard title="Set up your authenticator">
        <p>
          The admin portal needs a second factor. Add Aestara to an authenticator app, then enter the code it
          shows.
        </p>
        {error && <Banner tone="danger">{error}</Banner>}
        {enrollment === undefined ? (
          <Button disabled={busy} onClick={() => run(async () => setEnrollment(await startEnrollment()))}>
            Show my setup key
          </Button>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await confirmEnrollment(enrollment.id, code);
                setCode("");
              });
            }}
          >
            <p>
              Setup key:{" "}
              <code className="secret" data-testid="totp-secret">
                {enrollment.secret}
              </code>
            </p>
            <p className="muted">
              Or open this link on the device with your authenticator app:{" "}
              <a href={enrollment.otpauthUri}>Add to authenticator</a>
            </p>
            <Field
              label="Code from the app"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              Confirm authenticator
            </Button>
          </form>
        )}
        <Button variant="quiet" onClick={() => void signOut()}>
          Cancel
        </Button>
      </AuthCard>
    );

  const passkey =
    state.challenge.factors.includes("WEBAUTHN") && state.challenge.webauthnOptions !== undefined;
  const totp = state.challenge.factors.includes("TOTP");
  return (
    <AuthCard title={totp ? "Enter your code" : "Use your passkey"}>
      {error && <Banner tone="danger">{error}</Banner>}
      {passkey && (
        <Button variant={totp ? "secondary" : "primary"} disabled={busy} onClick={() => run(verifyPasskey)}>
          Use a passkey
        </Button>
      )}
      {totp && <p>Open your authenticator app and enter the 6-digit code for Aestara.</p>}
      {totp && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => verify(code));
          }}
        >
          <Field
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            Verify
          </Button>
        </form>
      )}
      <Button variant="quiet" onClick={() => void signOut()}>
        Use a different account
      </Button>
    </AuthCard>
  );
}

export function ChooseOrganizationPage() {
  const { state, chooseOrganization, signOut } = useAuth();
  const [error, setError] = useState<string>();
  if (state.status !== "signedIn") return null;
  const active = state.session.memberships.filter((m) => m.status === "ACTIVE");
  return (
    <AuthCard title="Choose an organization">
      {error && <Banner tone="danger">{error}</Banner>}
      <ul className="choice-list">
        {active.map((m) => (
          <li key={m.organizationId}>
            <Button
              variant="secondary"
              onClick={() => chooseOrganization(m.organizationId).catch((e) => setError(messageOf(e)))}
            >
              {m.organizationName}
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="quiet" onClick={() => void signOut()}>
        Sign out
      </Button>
    </AuthCard>
  );
}

function tokenFromFragment(): string | undefined {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("token") ?? undefined;
}

/** Reads the token once, then removes it from the address bar and history. */
function useFragmentToken(): string | undefined {
  const [token] = useState(tokenFromFragment);
  useEffect(() => {
    if (token) window.history.replaceState(null, "", window.location.pathname);
  }, [token]);
  return token;
}

export function AcceptInvitationPage() {
  const token = useFragmentToken();
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  if (!token)
    return (
      <AuthCard title="Invitation link">
        {<Banner tone="danger">This link is incomplete. Open it again from the email.</Banner>}
      </AuthCard>
    );
  if (done)
    return (
      <AuthCard title="You are all set">
        <p>Your account is active. Sign in to continue.</p>
        <a className="btn btn-primary" href="/">
          Sign in
        </a>
      </AuthCard>
    );
  return (
    <AuthCard title="Accept your invitation">
      <p>
        Choose a password of at least 12 characters. If you already have an Aestara account, enter its
        password.
      </p>
      {error && <Banner tone="danger">{error}</Banner>}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          postPublic("/auth/invitations/accept", { token, password, ...(displayName ? { displayName } : {}) })
            .then(() => setDone(true))
            .catch((err) => setError(messageOf(err)));
        }}
      >
        <Field
          label="Your name (optional)"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit">Accept invitation</Button>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <AuthCard title="Reset your password">
      {sent ? (
        <Banner tone="success">
          If an account uses that email, a reset link is on its way. It works for 30 minutes.
        </Banner>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void postPublic("/auth/password/forgot", { email }).finally(() => setSent(true));
          }}
        >
          <Field
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit">Email me a reset link</Button>
        </form>
      )}
      <a href="/">Back to sign in</a>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const token = useFragmentToken();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  if (!token)
    return (
      <AuthCard title="Reset link">
        {<Banner tone="danger">This link is incomplete. Request a new one.</Banner>}
      </AuthCard>
    );
  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <>
          <Banner tone="success">Your password was changed and your other sessions were signed out.</Banner>
          <a className="btn btn-primary" href="/">
            Sign in
          </a>
        </>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            postPublic("/auth/password/reset", { token, newPassword: password })
              .then(() => setDone(true))
              .catch((err) => setError(messageOf(err)));
          }}
        >
          {error && <Banner tone="danger">{error}</Banner>}
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit">Set password</Button>
        </form>
      )}
    </AuthCard>
  );
}
