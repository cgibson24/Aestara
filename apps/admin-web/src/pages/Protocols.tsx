// Photography protocols (Bible §6.2; spec §6.3 "Photography"; ADR-0023 K2-10,
// K2-11). The standard protocols are seeded ACTIVE for every organization; a
// practice manager authors custom protocols as drafts, activates them, and
// retires them. An active protocol is frozen: changing one means a successor
// draft, and activating the successor retires the protocol it replaces. The
// api enforces every rule; this page only offers the actions the status allows.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, type Schemas, unwrap } from "../api/client.ts";
import { practicesQuery, protocolsQuery, queryClient } from "../api/queries.ts";
import { useAuth } from "../auth/session.tsx";
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  messageOf,
  Select,
  words,
} from "../ui/kit.tsx";

type Protocol = Schemas["PhotographyProtocol"];
type ViewInput = Schemas["ProtocolViewInput"];
type Status = Schemas["ProtocolStatus"];

const BODY_REGIONS: Schemas["BodyRegion"][] = ["FACE", "BREAST", "ABDOMEN_BODY", "OTHER"];
const STATUS_TONE: Record<Status, "success" | "warning" | "neutral"> = {
  ACTIVE: "success",
  DRAFT: "warning",
  RETIRED: "neutral",
};

/** The editable shape of a protocol: what the create and update bodies carry. */
interface Draft {
  name: string;
  bodyRegion: Schemas["BodyRegion"];
  description: string;
  practiceId: string;
  views: ViewInput[];
}

const emptyView = (): ViewInput => ({ viewKey: "", name: "", isRequired: true });

/** Views as inputs, keeping each view's pose target (live guidance) when copied. */
function viewInputs(p: Protocol): ViewInput[] {
  return p.views.map((v) => ({
    viewKey: v.viewKey,
    name: v.name,
    isRequired: v.isRequired,
    ...(v.captureInstructions ? { captureInstructions: v.captureInstructions } : {}),
    ...(v.poseTarget ? { poseTarget: v.poseTarget } : {}),
  }));
}

export function ProtocolsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState<Status | "">("ACTIVE");
  const result = useQuery(protocolsQuery(status || undefined));
  const practices = useQuery({ ...practicesQuery, enabled: can("practice.read") });
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<{ mode: "new" | "edit" | "successor"; source?: Protocol }>();
  const reload = () => queryClient.invalidateQueries({ queryKey: ["protocols"] });

  if (result.error) return <ErrorState error={result.error} onRetry={() => void result.refetch()} />;
  const protocols = result.data;
  if (protocols === undefined) return <LoadingState label="Loading protocols" />;
  const current = protocols.find((p) => p.id === selected);
  const practiceName = (id: string | undefined) =>
    id === undefined
      ? "Whole organization"
      : (practices.data?.find((p) => p.id === id)?.name ?? "A practice");

  return (
    <div className="split">
      <section className="list-pane" aria-labelledby="protocols-title">
        <header className="pane-header">
          <h1 id="protocols-title">Photo protocols</h1>
          {can("practice.manage") && (
            <Button
              onClick={() => {
                setSelected(undefined);
                setEditing({ mode: "new" });
              }}
            >
              New protocol
            </Button>
          )}
        </header>
        <div className="filters">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status | "")}>
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Drafts</option>
            <option value="RETIRED">Retired</option>
            <option value="">All</option>
          </Select>
        </div>
        {protocols.length === 0 ? (
          <EmptyState title="No protocols here">
            <p>Change the status filter, or create a protocol.</p>
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col">Views</th>
                <th scope="col">Used by</th>
              </tr>
            </thead>
            <tbody>
              {protocols.map((p) => (
                <tr
                  key={p.id}
                  aria-selected={p.id === selected}
                  onClick={() => {
                    setEditing(undefined);
                    setSelected(p.id);
                  }}
                  className="clickable"
                >
                  <td>
                    <button type="button" className="link" onClick={() => setSelected(p.id)}>
                      {p.name}
                    </button>
                    <div className="muted">
                      {words(p.bodyRegion)}
                      {p.standard ? " · Standard" : ""}
                    </div>
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[p.status]}>{words(p.status)}</Badge>
                  </td>
                  <td>{p.views.length}</td>
                  <td>{practiceName(p.practiceId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="detail-pane" aria-live="polite">
        {editing ? (
          <ProtocolForm
            key={`${editing.mode}-${editing.source?.id ?? "new"}`}
            mode={editing.mode}
            source={editing.source}
            practices={practices.data ?? []}
            onCancel={() => setEditing(undefined)}
            onSaved={async (saved) => {
              setEditing(undefined);
              setStatus(saved.status);
              setSelected(saved.id);
              await reload();
            }}
          />
        ) : current ? (
          <ProtocolDetail
            protocol={current}
            scope={practiceName(current.practiceId)}
            onEdit={() => setEditing({ mode: "edit", source: current })}
            onSuccessor={() => setEditing({ mode: "successor", source: current })}
            onChanged={async (changed) => {
              setStatus(changed.status);
              setSelected(changed.id);
              await reload();
            }}
          />
        ) : (
          <EmptyState title="Select a protocol">
            <p>
              Each protocol is a series of views captured in order. The standard Face, Breast and Body
              protocols are always available.
            </p>
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function ProtocolDetail({
  protocol,
  scope,
  onEdit,
  onSuccessor,
  onChanged,
}: {
  protocol: Protocol;
  scope: string;
  onEdit: () => void;
  onSuccessor: () => void;
  onChanged: (p: Protocol) => Promise<void>;
}) {
  const { can } = useAuth();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState<"activate" | "retire">();
  const manage = can("practice.manage");

  const transition = async (action: "activate" | "retire") => {
    setError(undefined);
    try {
      const path =
        action === "activate" ? "/photography-protocols/{id}/activate" : "/photography-protocols/{id}/retire";
      const res = unwrap(
        await api.POST(path, {
          params: { path: { id: protocol.id }, header: { "If-Match": ifMatch(protocol.version) } },
        }),
      );
      setConfirming(undefined);
      await onChanged(res.data);
    } catch (err) {
      setError(messageOf(err));
    }
  };

  return (
    <article className="stack" aria-labelledby="protocol-title">
      <header className="stack">
        <h2 id="protocol-title">{protocol.name}</h2>
        <div className="row wrap">
          <Badge tone={STATUS_TONE[protocol.status]}>{words(protocol.status)}</Badge>
          {protocol.standard && <Badge>Standard</Badge>}
          <span className="muted">
            {words(protocol.bodyRegion)} · {scope} · version {protocol.version}
          </span>
        </div>
        {protocol.description && <p>{protocol.description}</p>}
        {protocol.supersededById && <p className="muted">Replaced by a newer protocol.</p>}
      </header>
      {error && <Banner tone="danger">{error}</Banner>}
      <ol className="plain-list" aria-label="Views in capture order">
        {protocol.views.map((v) => (
          <li key={v.id} className="stack">
            <div className="row wrap">
              <strong>{v.name}</strong>
              <span className="mono muted">{v.viewKey}</span>
              <Badge tone={v.isRequired ? "warning" : "neutral"}>
                {v.isRequired ? "Required" : "Optional"}
              </Badge>
            </div>
            {v.captureInstructions && <p className="muted">{v.captureInstructions}</p>}
          </li>
        ))}
      </ol>
      {manage && confirming === undefined && (
        <div className="row wrap">
          {protocol.status === "DRAFT" && (
            <>
              <Button onClick={onEdit}>Edit draft</Button>
              <Button variant="secondary" onClick={() => setConfirming("activate")}>
                Activate
              </Button>
              <Button variant="danger" onClick={() => setConfirming("retire")}>
                Discard draft
              </Button>
            </>
          )}
          {protocol.status === "ACTIVE" && (
            <>
              <Button onClick={onSuccessor}>Create a new version</Button>
              <Button variant="danger" onClick={() => setConfirming("retire")}>
                Retire
              </Button>
            </>
          )}
        </div>
      )}
      {confirming && (
        <fieldset className="confirm">
          <legend className="muted">Confirm</legend>
          <p>
            {confirming === "activate"
              ? protocol.supersedesId
                ? "Activate this version? Staff can start sessions with it, and the version it replaces is retired."
                : "Activate this protocol? Staff can start sessions with it, and it can no longer be edited."
              : protocol.status === "DRAFT"
                ? "Discard this draft? It is kept as retired and cannot be used."
                : "Retire this protocol? No new session can use it; sessions already started continue."}
          </p>
          <div className="row">
            <Button
              variant={confirming === "retire" ? "danger" : "primary"}
              onClick={() => void transition(confirming)}
            >
              {confirming === "activate" ? "Activate" : protocol.status === "DRAFT" ? "Discard" : "Retire"}
            </Button>
            <Button variant="quiet" onClick={() => setConfirming(undefined)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      )}
    </article>
  );
}

function ProtocolForm({
  mode,
  source,
  practices,
  onCancel,
  onSaved,
}: {
  mode: "new" | "edit" | "successor";
  source: Protocol | undefined;
  practices: Schemas["Practice"][];
  onCancel: () => void;
  onSaved: (p: Protocol) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    name: source ? (mode === "successor" ? `${source.name} (new version)` : source.name) : "",
    bodyRegion: source?.bodyRegion ?? "FACE",
    description: source?.description ?? "",
    practiceId: source?.practiceId ?? "",
    views: source ? viewInputs(source) : [emptyView()],
  }));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const setView = (i: number, change: Partial<ViewInput>) =>
    setDraft((d) => ({ ...d, views: d.views.map((v, j) => (j === i ? { ...v, ...change } : v)) }));
  const move = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      const views = [...d.views];
      const [view] = views.splice(i, 1);
      if (view) views.splice(i + by, 0, view);
      return { ...d, views };
    });

  const save = async () => {
    setBusy(true);
    setError(undefined);
    const views = draft.views.map((v) => ({
      ...v,
      viewKey: v.viewKey.trim().toUpperCase(),
      name: v.name.trim(),
      ...(v.captureInstructions?.trim() ? { captureInstructions: v.captureInstructions.trim() } : {}),
    }));
    for (const v of views) if (!v.captureInstructions) delete v.captureInstructions;
    try {
      const saved =
        mode === "edit" && source
          ? unwrap(
              await api.PATCH("/photography-protocols/{id}", {
                params: { path: { id: source.id }, header: { "If-Match": ifMatch(source.version) } },
                body: {
                  name: draft.name,
                  bodyRegion: draft.bodyRegion,
                  description: draft.description.trim() || null,
                  practiceId: draft.practiceId || null,
                  views,
                },
              }),
            ).data
          : unwrap(
              await api.POST("/photography-protocols", {
                body: {
                  name: draft.name,
                  bodyRegion: draft.bodyRegion,
                  ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
                  ...(draft.practiceId ? { practiceId: draft.practiceId } : {}),
                  ...(mode === "successor" && source ? { supersedesId: source.id } : {}),
                  views,
                },
              }),
            ).data;
      await onSaved(saved);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "edit" ? "Edit draft" : mode === "successor" ? "New version" : "New protocol";
  return (
    <form
      className="stack"
      aria-labelledby="protocol-form-title"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 id="protocol-form-title">{title}</h2>
      <p className="muted">
        {mode === "successor"
          ? "This is saved as a draft. Activating it retires the current version; sessions already started keep theirs."
          : "Saved as a draft. Activate it when it is ready; an active protocol cannot be edited."}
      </p>
      {error && <Banner tone="danger">{error}</Banner>}
      <Field
        label="Name"
        required
        maxLength={100}
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
      />
      <Select
        label="Body region"
        value={draft.bodyRegion}
        onChange={(e) => setDraft({ ...draft, bodyRegion: e.target.value as Schemas["BodyRegion"] })}
      >
        {BODY_REGIONS.map((r) => (
          <option key={r} value={r}>
            {words(r)}
          </option>
        ))}
      </Select>
      <Field
        label="Description"
        hint="Optional; shown to staff choosing a protocol."
        maxLength={500}
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
      />
      <Select
        label="Available to"
        value={draft.practiceId}
        onChange={(e) => setDraft({ ...draft, practiceId: e.target.value })}
      >
        <option value="">The whole organization</option>
        {practices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} only
          </option>
        ))}
      </Select>
      <fieldset className="stack">
        <legend>Views, in capture order</legend>
        {draft.views.map((v, i) => (
          // Views are positional: the index is their identity while editing.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <div key={i} className="card stack">
            <div className="row wrap">
              <Field
                label={`View ${i + 1} name`}
                required
                maxLength={60}
                value={v.name}
                onChange={(e) => setView(i, { name: e.target.value })}
              />
              <Field
                label="Key"
                required
                hint="Upper case, e.g. LEFT_45"
                pattern="[A-Za-z][A-Za-z0-9_]{0,39}"
                value={v.viewKey}
                onChange={(e) => setView(i, { viewKey: e.target.value })}
              />
            </div>
            <Field
              label="Capture instructions"
              hint="Short positioning text for the photographer."
              maxLength={500}
              value={v.captureInstructions ?? ""}
              onChange={(e) => setView(i, { captureInstructions: e.target.value })}
            />
            <div className="row wrap">
              <label className="row">
                <input
                  type="checkbox"
                  checked={v.isRequired}
                  onChange={(e) => setView(i, { isRequired: e.target.checked })}
                />
                Required
              </label>
              <Button variant="quiet" disabled={i === 0} onClick={() => move(i, -1)}>
                Move up
              </Button>
              <Button variant="quiet" disabled={i === draft.views.length - 1} onClick={() => move(i, 1)}>
                Move down
              </Button>
              <Button
                variant="quiet"
                disabled={draft.views.length === 1}
                onClick={() => setDraft({ ...draft, views: draft.views.filter((_, j) => j !== i) })}
              >
                Remove view
              </Button>
            </div>
          </div>
        ))}
        <Button
          variant="secondary"
          disabled={draft.views.length >= 20}
          onClick={() => setDraft({ ...draft, views: [...draft.views, emptyView()] })}
        >
          Add a view
        </Button>
      </fieldset>
      <div className="row">
        <Button type="submit" disabled={busy}>
          Save draft
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
