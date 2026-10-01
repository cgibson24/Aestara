// Users and roles (spec §6.3 "Users, roles, permissions"; §4.5 rules 1–4).
// Every action goes to the api, which enforces permissions and separation of
// duties; the buttons only hide what the caller cannot do.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, type Schemas, unwrap } from "../api/client.ts";
import { queryClient, rolesQuery, usersQuery } from "../api/queries.ts";
import { useAuth } from "../auth/session.tsx";
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  formatDateTime,
  LoadingState,
  messageOf,
  Select,
  words,
} from "../ui/kit.tsx";

type StaffUser = Schemas["StaffUser"];
type Role = Schemas["Role"];

function statusTone(status: StaffUser["status"]) {
  return status === "ACTIVE" ? "success" : status === "INVITED" ? "warning" : "danger";
}

export function UsersPage() {
  const { can } = useAuth();
  const usersResult = useQuery(usersQuery);
  const rolesResult = useQuery(rolesQuery);
  const [selected, setSelected] = useState<string>();
  const [inviting, setInviting] = useState(false);
  // Writes change users and their roles: read them again.
  const load = () => queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });

  const error = usersResult.error ?? rolesResult.error;
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void usersResult.refetch();
          void rolesResult.refetch();
        }}
      />
    );
  const users = usersResult.data;
  const roles = rolesResult.data;
  if (users === undefined || roles === undefined) return <LoadingState label="Loading users" />;
  const current = users.find((u) => u.id === selected);

  return (
    <div className="split">
      <section className="list-pane" aria-labelledby="users-title">
        <header className="pane-header">
          <h1 id="users-title">Users</h1>
          {can("user.create") && <Button onClick={() => setInviting(true)}>Invite user</Button>}
        </header>
        {users.length === 0 ? (
          <EmptyState title="No users yet">
            <p>Invite the people who work in this organization.</p>
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col">Roles</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  aria-selected={u.id === selected}
                  onClick={() => setSelected(u.id)}
                  className="clickable"
                >
                  <td>
                    <button type="button" className="link" onClick={() => setSelected(u.id)}>
                      {u.displayName ?? u.email}
                    </button>
                    <div className="muted">{u.email}</div>
                  </td>
                  <td>
                    <Badge tone={statusTone(u.status)}>{words(u.status)}</Badge>
                  </td>
                  <td>{u.roleAssignments.map((a) => words(a.roleKey)).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="detail-pane" aria-live="polite">
        {inviting ? (
          <InviteUser
            roles={roles}
            onDone={async () => {
              setInviting(false);
              await load();
            }}
          />
        ) : current ? (
          <UserDetail user={current} roles={roles} onChanged={load} />
        ) : (
          <EmptyState title="Select a user">
            <p>Choose someone in the list to see their roles and security.</p>
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function InviteUser({ roles, onDone }: { roles: Role[]; onDone: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      aria-labelledby="invite-title"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          unwrap(
            await api.POST("/users", {
              params: { header: { "Idempotency-Key": crypto.randomUUID() } },
              body: {
                email,
                displayName,
                roleAssignments: roleId ? [{ roleId, scope: "ORGANIZATION" }] : [],
              },
            }),
          );
          await onDone();
        } catch (err) {
          setError(messageOf(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id="invite-title">Invite a user</h2>
      <p className="muted">They receive an email to set their password. The link works for 72 hours.</p>
      {error && <Banner tone="danger">{error}</Banner>}
      <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Field label="Name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      <Select label="Role (organization-wide)" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
        <option value="">No role yet</option>
        {roles
          .filter((r) => r.key !== "SUPER_ADMIN" && r.key !== "PATIENT")
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
      </Select>
      <div className="row">
        <Button type="submit" disabled={busy}>
          Send invitation
        </Button>
        <Button variant="quiet" onClick={() => void onDone()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function UserDetail({
  user,
  roles,
  onChanged,
}: {
  user: StaffUser;
  roles: Role[];
  onChanged: () => Promise<void>;
}) {
  const { can, state } = useAuth();
  const [roleId, setRoleId] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string }>();
  const [confirming, setConfirming] = useState<"disable" | "mfa" | undefined>();
  const [method, setMethod] = useState("IN_PERSON");
  const self = state.status === "signedIn" && state.session.user.id === user.id;

  const act = async (action: () => Promise<unknown>, success: string) => {
    setNotice(undefined);
    try {
      await action();
      setNotice({ tone: "success", text: success });
      setConfirming(undefined);
      await onChanged();
    } catch (err) {
      const text =
        err instanceof ApiError && err.code === "REAUTHENTICATION_REQUIRED"
          ? "Sign in again to confirm it is you, then retry."
          : messageOf(err);
      setNotice({ tone: "danger", text });
    }
  };

  return (
    <section className="stack" aria-labelledby="user-title">
      <h2 id="user-title">{user.displayName ?? user.email}</h2>
      <dl className="facts">
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Status</dt>
        <dd>
          <Badge tone={statusTone(user.status)}>{words(user.status)}</Badge>
        </dd>
        <dt>Second factor</dt>
        <dd>{user.mfaEnrolled ? "Set up" : "Not set up"}</dd>
        <dt>Last sign-in</dt>
        <dd>{formatDateTime(user.lastLoginAt)}</dd>
      </dl>
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      <h3>Roles</h3>
      {user.roleAssignments.length === 0 ? (
        <p className="muted">No roles. This person can sign in but do nothing.</p>
      ) : (
        <ul className="plain-list">
          {user.roleAssignments.map((a) => (
            <li key={a.id} className="row">
              <span>
                {words(a.roleKey)} <span className="muted">({words(a.scope)})</span>
              </span>
              {can("role.assign") && !self && (
                <Button
                  variant="quiet"
                  aria-label={`Remove ${words(a.roleKey)}`}
                  onClick={() =>
                    act(
                      async () =>
                        unwrap(
                          (await api.DELETE("/users/{id}/role-assignments/{assignmentId}", {
                            params: { path: { id: user.id, assignmentId: a.id } },
                          })) as { data?: unknown; error?: unknown; response: Response },
                        ),
                      "Role removed.",
                    )
                  }
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {can("role.assign") && !self && user.status !== "DISABLED" && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!roleId) return;
            void act(
              async () =>
                unwrap(
                  await api.POST("/users/{id}/role-assignments", {
                    params: { path: { id: user.id } },
                    body: { roleId, scope: "ORGANIZATION" },
                  }),
                ),
              "Role added.",
            );
          }}
        >
          <Select label="Add a role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">Choose a role</option>
            {roles
              .filter((r) => r.key !== "SUPER_ADMIN" && r.key !== "PATIENT")
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </Select>
          <Button type="submit" variant="secondary">
            Add role
          </Button>
        </form>
      )}

      <h3>Security</h3>
      <div className="row wrap">
        {can("security.manage") && (
          <Button
            variant="secondary"
            onClick={() =>
              act(
                async () =>
                  unwrap(
                    await api.POST("/users/{id}/sessions/revoke", { params: { path: { id: user.id } } }),
                  ),
                "Signed out of every device in this organization.",
              )
            }
          >
            Sign out everywhere
          </Button>
        )}
        {can("security.manage") && !self && (
          <Button variant="secondary" onClick={() => setConfirming("mfa")}>
            Reset second factor
          </Button>
        )}
        {can("user.disable") && !self && user.status !== "DISABLED" && (
          <Button variant="danger" onClick={() => setConfirming("disable")}>
            Disable user
          </Button>
        )}
      </div>

      {confirming === "disable" && (
        <div className="confirm" role="alertdialog" aria-labelledby="confirm-disable">
          <p id="confirm-disable">
            Disable {user.displayName ?? user.email}? They are signed out of this organization at once and
            cannot sign in to it again.
          </p>
          <div className="row">
            <Button
              variant="danger"
              onClick={() =>
                act(
                  async () =>
                    unwrap(await api.POST("/users/{id}/disable", { params: { path: { id: user.id } } })),
                  "User disabled.",
                )
              }
            >
              Disable
            </Button>
            <Button variant="quiet" onClick={() => setConfirming(undefined)}>
              Keep active
            </Button>
          </div>
        </div>
      )}
      {confirming === "mfa" && (
        <div className="confirm" role="alertdialog" aria-labelledby="confirm-mfa">
          <p id="confirm-mfa">
            Only reset after you have confirmed who is asking. Their factors are removed and every session
            ends; they set up a new factor at the next sign-in.
          </p>
          <Select
            label="How did you confirm their identity?"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="IN_PERSON">In person</option>
            <option value="VIDEO_CALL">Video call</option>
            <option value="KNOWN_CALLBACK">Call back on a known number</option>
          </Select>
          <div className="row">
            <Button
              variant="danger"
              onClick={() =>
                act(
                  async () =>
                    unwrap(
                      await api.POST("/users/{id}/mfa-reset", {
                        params: { path: { id: user.id } },
                        body: { identityVerificationMethod: method as "IN_PERSON" },
                      }),
                    ),
                  "Second factors removed.",
                )
              }
            >
              Reset second factor
            </Button>
            <Button variant="quiet" onClick={() => setConfirming(undefined)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function RolesPage() {
  const { data: roles, error, refetch } = useQuery(rolesQuery);
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (roles === undefined) return <LoadingState label="Loading roles" />;
  return (
    <section className="page" aria-labelledby="roles-title">
      <h1 id="roles-title">Roles</h1>
      <p className="muted">System roles and what they allow. Roles are defined by the platform.</p>
      {roles.map((r) => (
        <details key={r.id} className="card">
          <summary>
            <strong>{r.name}</strong> <span className="muted">{r.description}</span>
          </summary>
          <ul className="tags">
            {r.permissions.map((p) => (
              <li key={p}>
                <code>{p}</code>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
