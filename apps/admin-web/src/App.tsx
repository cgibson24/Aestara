// The portal shell: public pages from email links, the sign-in steps, and the
// signed-in layout with its navigation (Users, Roles, Audit).
import type { MouseEvent, ReactNode } from "react";
import { useAuth } from "./auth/session.tsx";
import { AccountPage } from "./pages/Account.tsx";
import { AuditPage } from "./pages/Audit.tsx";
import {
  AcceptInvitationPage,
  ChooseOrganizationPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  SecondFactorPage,
  SignInPage,
} from "./pages/SignIn.tsx";
import { RolesPage, UsersPage } from "./pages/Users.tsx";
import { navigate, usePath } from "./router.ts";
import { Button, LoadingState } from "./ui/kit.tsx";

const PUBLIC: Record<string, () => ReactNode> = {
  "/accept-invitation": () => <AcceptInvitationPage />,
  "/reset-password": () => <ResetPasswordPage />,
  "/forgot-password": () => <ForgotPasswordPage />,
};

const NAV = [
  { path: "/users", label: "Users", permission: "user.read" },
  { path: "/roles", label: "Roles", permission: "role.read" },
  { path: "/audit", label: "Audit log", permission: "audit.read" },
] as const;

function NavLink({ path, children }: { path: string; children: ReactNode }) {
  const current = usePath() === path;
  return (
    <a
      href={path}
      aria-current={current ? "page" : undefined}
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        navigate(path);
      }}
    >
      {children}
    </a>
  );
}

export function App() {
  const path = usePath();
  const { state, can, signOut } = useAuth();
  const publicPage = PUBLIC[path];
  if (publicPage) return publicPage();
  if (state.status === "loading") return <LoadingState label="Opening Aestara" />;
  if (state.status === "signedOut") return <SignInPage notice={state.notice} />;
  if (state.status === "challenge") return <SecondFactorPage />;

  const session = state.session;
  const isPlatform = session.platformPermissions.length > 0;
  if (!session.organization && !isPlatform) return <ChooseOrganizationPage />;

  const allowed = NAV.filter((n) => can(n.permission));
  const page = path === "/account" ? undefined : (allowed.find((n) => n.path === path) ?? allowed[0]);
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <p className="brand">Aestara</p>
        <p className="muted">{session.organization?.name ?? "Platform"}</p>
        <ul>
          {allowed.map((n) => (
            <li key={n.path}>
              <NavLink path={n.path}>{n.label}</NavLink>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <NavLink path="/account">{session.user.displayName ?? session.user.email}</NavLink>
          <Button variant="quiet" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </nav>
      <main className="content">
        {path === "/account" ? (
          <AccountPage />
        ) : page === undefined ? (
          <p>Your roles do not include any part of the admin portal.</p>
        ) : page.path === "/users" ? (
          <UsersPage />
        ) : page.path === "/roles" ? (
          <RolesPage />
        ) : (
          <AuditPage />
        )}
      </main>
    </div>
  );
}
