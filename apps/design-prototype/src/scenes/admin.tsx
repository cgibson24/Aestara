// Admin web scenes (React SPA in production, ADR-0003).
import React from "react";
import { auditRows, rolePermissions, staffUsers } from "../data/fixtures";
import { Icon } from "../ui/icons";
import { Avatar, Badge, Button, SearchField, Segmented, StateView } from "../ui/kit";
import { AdminShell } from "../ui/shells";

const statusTone = (s: string) => (s === "Active" ? "success" : s === "Invited" ? "info" : "neutral");

export function AdminUsersScene() {
  return (
    <AdminShell
      section="users"
      title="Users & roles"
      description="Who can do what, and where. Roles grant permissions; the server checks every request."
      actions={
        <Button variant="primary" icon="plus">
          Invite user
        </Button>
      }
    >
      <StateView
        empty={{
          icon: "people",
          title: "No users yet",
          body: "Invite your team to get started.",
          action: "Invite user",
        }}
        deniedWhat="user management"
      >
        <div className="admin-split">
          <div className="table-wrap">
            <div className="table-tools">
              <SearchField placeholder="Search people" />
              <Segmented
                label="Status"
                size="sm"
                value="all"
                onChange={() => undefined}
                options={[
                  { value: "all", label: "All" },
                  { value: "active", label: "Active" },
                  { value: "invited", label: "Invited" },
                  { value: "disabled", label: "Disabled" },
                ]}
              />
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role and scope</th>
                  <th>Status</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {staffUsers.map((u, i) => (
                  <tr key={u.email} className={i === 1 ? "is-selected" : undefined}>
                    <td>
                      <span className="user-cell">
                        <Avatar
                          initials={u.name
                            .replace("Dr. ", "")
                            .split(" ")
                            .map((w) => w[0])
                            .join("")
                            .slice(0, 2)}
                          size={32}
                        />
                        <span>
                          <span className="user-name">{u.name}</span>
                          <span className="user-email">{u.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="role-cell">
                        {u.role}
                        <span className="text-footnote muted">{u.scope}</span>
                      </span>
                    </td>
                    <td>
                      <Badge tone={statusTone(u.status)}>{u.status}</Badge>
                    </td>
                    <td className="num muted">{u.last}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="drawer" aria-label="Selected user">
            <div className="drawer-head">
              <Avatar initials="JA" size={48} tone="accent" />
              <div className="drawer-id">
                <div className="text-headline">Jordan Alvarez, RN</div>
                <div className="text-footnote muted">jordan.alvarez@lumenaesthetic.example</div>
              </div>
            </div>
            <div className="drawer-section">
              <div className="text-caption1 muted eyebrow">Role</div>
              <div className="role-line">
                <span>Nurse / Injector / Aesthetician</span>
                <Badge>Madison Avenue</Badge>
              </div>
            </div>
            <div className="drawer-section">
              <div className="text-caption1 muted eyebrow">Permissions from this role</div>
              {rolePermissions.map((g) => (
                <div key={g.group} className="perm-group">
                  <span className="perm-group-name">{g.group}</span>
                  <span className="perm-keys">
                    {g.items.map((k) => {
                      const granted = ![
                        "patient.archive",
                        "photo.export",
                        "consultation.complete",
                        "simulation.approve",
                        "simulation.release",
                        "treatmentplan.send",
                        "consent.sign.provider",
                        "consent.void",
                      ].includes(k);
                      return (
                        <span key={k} className={`perm-key${granted ? " is-on" : ""}`}>
                          {granted ? <Icon name="check" size={12} /> : <Icon name="close" size={12} />}
                          {k}
                        </span>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
            <div className="drawer-actions">
              <Button variant="secondary">Change role</Button>
              <Button variant="destructive">Disable</Button>
            </div>
            <p className="text-footnote muted">
              You can't change your own role. Every change is recorded in the audit log.
            </p>
          </aside>
        </div>
      </StateView>
    </AdminShell>
  );
}

const outcomeTone = (o: string) => (o === "SUCCESS" ? "success" : o === "DENIED" ? "warning" : "danger");

export function AdminAuditScene() {
  return (
    <AdminShell
      section="audit"
      title="Audit log"
      description="Every access and change, append-only. Entries show identifiers only, never clinical content."
      actions={
        <Button variant="secondary" icon="export">
          Export range
        </Button>
      }
    >
      <StateView
        empty={{
          icon: "shield",
          title: "No events in this range",
          body: "Try a wider date range or fewer filters.",
        }}
        deniedWhat="the audit log"
      >
        <div className="table-wrap">
          <div className="table-tools">
            <SearchField placeholder="Patient MRN, user or request ID" />
            <span className="filter-chip">
              <Icon name="calendar" size={16} /> Today
            </span>
            <span className="filter-chip">
              <Icon name="list" size={16} /> All actions
            </span>
            <span className="filter-chip">
              <Icon name="building" size={16} /> All practices
            </span>
          </div>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Time (ET)</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Patient</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((r) => (
                <tr key={r.time + r.action}>
                  <td className="num">{r.time}</td>
                  <td>{r.actor}</td>
                  <td>
                    <code className="action-code">{r.action}</code>
                  </td>
                  <td>{r.resource}</td>
                  <td className="num">{r.patient}</td>
                  <td>
                    <Badge tone={outcomeTone(r.outcome)}>
                      {r.outcome.charAt(0) + r.outcome.slice(1).toLowerCase()}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StateView>
    </AdminShell>
  );
}
