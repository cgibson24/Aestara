// The audit viewer (spec §6.3 "/audit/events"; Bible §22). Read-only; the
// api scopes it to the organization, or to platform-level events for platform
// operators. Filtering by patient ID gives the per-patient access report.
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, type Schemas, unwrap } from "../api/client.ts";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  formatDateTime,
  LoadingState,
  Select,
  words,
} from "../ui/kit.tsx";

type AuditEvent = Schemas["AuditEvent"];
type AuditAction = Schemas["AuditAction"];

interface Filters {
  action?: AuditAction | undefined;
  actorUserId?: string | undefined;
  patientId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

const ACTIONS: AuditAction[] = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILURE",
  "LOGOUT",
  "PATIENT_CREATED",
  "PATIENT_VIEWED",
  "PATIENT_UPDATED",
  "PATIENT_ARCHIVED",
  "USER_CREATED",
  "USER_UPDATED",
  "USER_DISABLED",
  "ROLE_ASSIGNED",
  "ROLE_REVOKED",
  "ACCESS_DENIED",
  "CONFIGURATION_CHANGED",
  "SECURITY_SESSION_REVOKED",
  "SECURITY_CREDENTIAL_CHANGED",
  "ORGANIZATION_SWITCHED",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIso(local: string | undefined): string | undefined {
  return local ? new Date(local).toISOString() : undefined;
}

export function AuditPage() {
  const [filters, setFilters] = useState<Filters>({});
  const [draft, setDraft] = useState<Filters>({});
  const [events, setEvents] = useState<AuditEvent[]>();
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [open, setOpen] = useState<AuditEvent>();

  const load = useCallback(
    async (after?: string) => {
      setError(undefined);
      try {
        const page = unwrap(
          await api.GET("/audit/events", {
            params: {
              query: {
                limit: 50,
                ...(after ? { cursor: after } : {}),
                ...(filters.action ? { action: filters.action } : {}),
                ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
                ...(filters.patientId ? { patientId: filters.patientId } : {}),
                ...(filters.from ? { from: toIso(filters.from) as string } : {}),
                ...(filters.to ? { to: toIso(filters.to) as string } : {}),
              },
            },
          }),
        );
        setEvents((current) => (after ? [...(current ?? []), ...page.data] : page.data));
        setCursor(page.page.hasMore ? page.page.nextCursor : undefined);
      } catch (e) {
        setError(e);
      }
    },
    [filters],
  );

  useEffect(() => {
    setEvents(undefined);
    void load();
  }, [load]);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setFilters(draft);
  };
  const invalidId = (value?: string) => (value && !UUID.test(value) ? "Enter a full identifier." : undefined);

  return (
    <section className="page" aria-labelledby="audit-title">
      <h1 id="audit-title">Audit log</h1>
      <p className="muted">
        Every sign-in, access and change, newest first. Entries cannot be edited or deleted.
      </p>
      <form className="filters" onSubmit={apply}>
        <Select
          label="Action"
          value={draft.action ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, action: (e.target.value || undefined) as AuditAction | undefined })
          }
        >
          <option value="">Any action</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {words(a)}
            </option>
          ))}
        </Select>
        <Field
          label="Patient ID"
          value={draft.patientId ?? ""}
          error={invalidId(draft.patientId)}
          onChange={(e) => setDraft({ ...draft, patientId: e.target.value.trim() || undefined })}
        />
        <Field
          label="User ID"
          value={draft.actorUserId ?? ""}
          error={invalidId(draft.actorUserId)}
          onChange={(e) => setDraft({ ...draft, actorUserId: e.target.value.trim() || undefined })}
        />
        <Field
          label="From"
          type="datetime-local"
          value={draft.from ?? ""}
          onChange={(e) => setDraft({ ...draft, from: e.target.value || undefined })}
        />
        <Field
          label="To"
          type="datetime-local"
          value={draft.to ?? ""}
          onChange={(e) => setDraft({ ...draft, to: e.target.value || undefined })}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={Boolean(invalidId(draft.patientId) || invalidId(draft.actorUserId))}
        >
          Apply filters
        </Button>
      </form>
      {error ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : events === undefined ? (
        <LoadingState label="Loading audit events" />
      ) : events.length === 0 ? (
        <EmptyState title="No events match" />
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">Outcome</th>
                <th scope="col">Actor</th>
                <th scope="col">Resource</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => setOpen(e)}>
                  <td>{formatDateTime(e.occurredAt)}</td>
                  <td>
                    <button type="button" className="link" onClick={() => setOpen(e)}>
                      {words(e.action)}
                    </button>
                  </td>
                  <td>
                    <Badge tone={e.outcome === "SUCCESS" ? "success" : "danger"}>{words(e.outcome)}</Badge>
                  </td>
                  <td className="mono">{e.actorUserId ?? words(e.actorType)}</td>
                  <td>
                    {e.resourceType}
                    {e.resourceId && <div className="mono muted">{e.resourceId}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && (
            <Button variant="secondary" onClick={() => void load(cursor)}>
              Load more
            </Button>
          )}
        </>
      )}
      {open && (
        <aside className="drawer" aria-labelledby="event-title">
          <h2 id="event-title">{words(open.action)}</h2>
          <dl className="facts">
            {Object.entries(open)
              .filter(([key]) => key !== "metadata")
              .map(([key, value]) => (
                <div key={key} className="fact">
                  <dt>{key}</dt>
                  <dd className="mono">{String(value)}</dd>
                </div>
              ))}
          </dl>
          {open.metadata && <pre className="mono">{JSON.stringify(open.metadata, null, 2)}</pre>}
          <Button variant="quiet" onClick={() => setOpen(undefined)}>
            Close
          </Button>
        </aside>
      )}
    </section>
  );
}
