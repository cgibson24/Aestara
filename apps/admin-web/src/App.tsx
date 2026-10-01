// The portal: providers, the route tree (TanStack Router; spec §2.2 D-03) and
// the signed-in layout. Public routes serve the pages reached from email links;
// every other route needs a session, and each page checks its permission. The
// checks only shape the UI: the api authorizes every request.
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Navigate,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { queryClient } from "./api/queries.ts";
import { AuthProvider, useAuth } from "./auth/session.tsx";
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
import { Button, EmptyState, LoadingState } from "./ui/kit.tsx";

const NAV = [
  { to: "/users", label: "Users", permission: "user.read" },
  { to: "/roles", label: "Roles", permission: "role.read" },
  { to: "/audit", label: "Audit log", permission: "audit.read" },
] as const;

/** Sign-in until a session exists, then the sidebar layout around the page. */
function SignedInLayout() {
  const { state, can, signOut } = useAuth();
  if (state.status === "loading") return <LoadingState label="Opening Aestara" />;
  if (state.status === "signedOut") return <SignInPage notice={state.notice} />;
  if (state.status === "challenge") return <SecondFactorPage />;
  const session = state.session;
  if (!session.organization && session.platformPermissions.length === 0) return <ChooseOrganizationPage />;

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <p className="brand">Aestara</p>
        <p className="muted">{session.organization?.name ?? "Platform"}</p>
        <ul>
          {NAV.filter((n) => can(n.permission)).map((n) => (
            <li key={n.to}>
              <Link to={n.to}>{n.label}</Link>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <Link to="/account">{session.user.displayName ?? session.user.email}</Link>
          <Button variant="quiet" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? (
    children
  ) : (
    <EmptyState title="Not available for your role">
      <p>Ask an administrator of your organization if you need it.</p>
    </EmptyState>
  );
}

/** The first page the caller's role allows. */
function Home() {
  const { can } = useAuth();
  const first = NAV.find((n) => can(n.permission));
  if (first === undefined)
    return (
      <EmptyState title="Nothing to administer">
        <p>Your roles do not include any part of the admin portal.</p>
      </EmptyState>
    );
  return <Navigate to={first.to} replace />;
}

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: () => (
    <EmptyState title="Page not found">
      <Link to="/">Go to the portal</Link>
    </EmptyState>
  ),
});
const portalRoute = createRoute({ getParentRoute: () => rootRoute, id: "portal", component: SignedInLayout });
const guarded = (permission: string, Page: () => ReactNode) => () => (
  <RequirePermission permission={permission}>
    <Page />
  </RequirePermission>
);

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/accept-invitation",
    component: AcceptInvitationPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/reset-password", component: ResetPasswordPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/forgot-password", component: ForgotPasswordPage }),
  portalRoute.addChildren([
    createRoute({ getParentRoute: () => portalRoute, path: "/", component: Home }),
    createRoute({
      getParentRoute: () => portalRoute,
      path: "/users",
      component: guarded("user.read", UsersPage),
    }),
    createRoute({
      getParentRoute: () => portalRoute,
      path: "/roles",
      component: guarded("role.read", RolesPage),
    }),
    createRoute({
      getParentRoute: () => portalRoute,
      path: "/audit",
      component: guarded("audit.read", AuditPage),
    }),
    createRoute({ getParentRoute: () => portalRoute, path: "/account", component: AccountPage }),
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: false });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function Portal() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
