// Configuration (spec §6.3 administration rows; ADR-0023 K2-17 to K2-19;
// ADR-0024): feature flags for the organization or one practice, each
// practice's offline cache policy, and retention policies. Flag and setting
// keys are registered in code with their defaults; a practice value wins over
// the organization's, which wins over the default. A flag only hides a
// feature and never grants access. Retention policies are recorded only: no
// job acts on them yet, and deletion is refused until legal hold exists.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, type Schemas, unwrap } from "../api/client.ts";
import {
  flagsQuery,
  offlinePolicyQuery,
  practicesQuery,
  queryClient,
  retentionQuery,
} from "../api/queries.ts";
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

const SOURCE_LABEL: Record<Schemas["FeatureFlag"]["source"], string> = {
  DEFAULT: "Default",
  ORGANIZATION: "Set for the organization",
  PRACTICE: "Set for this practice",
};

export function ConfigurationPage() {
  const { can } = useAuth();
  const practices = useQuery({ ...practicesQuery, enabled: can("practice.read") });
  const [practiceId, setPracticeId] = useState("");

  return (
    <div className="page stack">
      <header className="pane-header">
        <h1>Configuration</h1>
      </header>
      <Select
        label="Settings for"
        value={practiceId}
        onChange={(e) => setPracticeId(e.target.value)}
        aria-describedby="scope-hint"
      >
        <option value="">The whole organization</option>
        {(practices.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <p id="scope-hint" className="muted">
        A practice's own value wins over the organization's, which wins over the default.
      </p>
      <FeatureFlags practiceId={practiceId || undefined} />
      {practiceId ? (
        <OfflinePolicy practiceId={practiceId} />
      ) : (
        <section className="card stack" aria-labelledby="offline-title">
          <h2 id="offline-title">Offline use</h2>
          <p className="muted">
            Each practice sets how many patients and how many days of photos a device may keep for offline
            use. Choose a practice above to change it.
          </p>
        </section>
      )}
      <RetentionPolicies />
    </div>
  );
}

function FeatureFlags({ practiceId }: { practiceId: string | undefined }) {
  const result = useQuery(flagsQuery(practiceId));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const set = async (flag: Schemas["FeatureFlag"], enabled: boolean) => {
    setBusy(flag.key);
    setError(undefined);
    try {
      unwrap(
        await api.PUT("/feature-flags/{key}", {
          params: { path: { key: flag.key } },
          body: { enabled, ...(practiceId ? { practiceId } : {}) },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ["feature-flags"] });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="card stack" aria-labelledby="flags-title">
      <h2 id="flags-title">Features</h2>
      {error && <Banner tone="danger">{error}</Banner>}
      {result.error ? (
        <ErrorState error={result.error} onRetry={() => void result.refetch()} />
      ) : result.data === undefined ? (
        <LoadingState label="Loading features" />
      ) : (
        <ul className="plain-list">
          {result.data.map((flag) => (
            <li key={flag.key} className="row wrap" aria-label={flag.description}>
              <span className="stack">
                <strong>{flag.description}</strong>
                <span className="mono muted">{flag.key}</span>
              </span>
              <Badge tone={flag.enabled ? "success" : "neutral"}>{flag.enabled ? "On" : "Off"}</Badge>
              <span className="muted">
                {SOURCE_LABEL[flag.source]}
                {flag.updatedAt ? `, ${formatDateTime(flag.updatedAt)}` : ""}
              </span>
              <Button
                variant="secondary"
                disabled={busy === flag.key}
                onClick={() => void set(flag, !flag.enabled)}
              >
                {flag.enabled ? "Turn off" : "Turn on"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OfflinePolicy({ practiceId }: { practiceId: string }) {
  const result = useQuery(offlinePolicyQuery(practiceId));
  if (result.error) return <ErrorState error={result.error} onRetry={() => void result.refetch()} />;
  if (result.data === undefined) return <LoadingState label="Loading the offline policy" />;
  // A fresh form per stored version, so a save or a reload shows the stored values.
  return (
    <OfflinePolicyForm
      key={`${practiceId}-${result.data.version}`}
      practiceId={practiceId}
      setting={result.data}
    />
  );
}

function OfflinePolicyForm({
  practiceId,
  setting,
}: {
  practiceId: string;
  setting: Schemas["PracticeSetting"];
}) {
  // The registered shape of offline.cachePolicy (the api validates every write).
  const value = setting.value as { maxPatients: number; maxAgeDays: number };
  const [maxPatients, setMaxPatients] = useState(String(value.maxPatients));
  const [maxAgeDays, setMaxAgeDays] = useState(String(value.maxAgeDays));
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string }>();
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card stack"
      aria-labelledby="offline-title"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setNotice(undefined);
        try {
          unwrap(
            await api.PUT("/settings/practices/{practiceId}/{key}", {
              params: {
                path: { practiceId, key: "offline.cachePolicy" },
                header: { "If-Match": ifMatch(setting.version) },
              },
              body: { value: { maxPatients: Number(maxPatients), maxAgeDays: Number(maxAgeDays) } },
            }),
          );
          setNotice({ tone: "success", text: "Saved. Devices apply it at their next sign-in or sync." });
          await queryClient.invalidateQueries({ queryKey: ["settings", practiceId] });
        } catch (err) {
          setNotice({ tone: "danger", text: messageOf(err) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id="offline-title">Offline use</h2>
      <p className="muted">
        {setting.isDefault
          ? "This practice uses the default."
          : `Set for this practice on ${formatDateTime(setting.updatedAt)}.`}{" "}
        A device keeps no more than the strictest policy of the practices its user works in, and never beyond
        7 days.
      </p>
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      <div className="row wrap">
        <Field
          label="Patients kept on a device"
          type="number"
          min={1}
          max={100}
          required
          value={maxPatients}
          onChange={(e) => setMaxPatients(e.target.value)}
        />
        <Field
          label="Days kept"
          type="number"
          min={1}
          max={7}
          required
          value={maxAgeDays}
          onChange={(e) => setMaxAgeDays(e.target.value)}
        />
      </div>
      <div className="row">
        <Button type="submit" disabled={busy}>
          Save offline policy
        </Button>
      </div>
    </form>
  );
}

const CATEGORIES: Schemas["RetentionRecordCategory"][] = [
  "CLINICAL_PHOTO",
  "CLINICAL_RECORD",
  "CONSENT_DOCUMENT",
  "MESSAGE",
  "AUDIT_EVENT",
  "LOGIN_EVENT",
  "AI_ARTIFACT",
  "DATA_EXPORT",
  "TELEHEALTH_METADATA",
  "INTEGRATION_PAYLOAD",
];

function RetentionPolicies() {
  const result = useQuery(retentionQuery);
  const [adding, setAdding] = useState(false);

  return (
    <section className="card stack" aria-labelledby="retention-title">
      <header className="pane-header">
        <h2 id="retention-title">Retention policies</h2>
        {!adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Record a policy
          </Button>
        )}
      </header>
      <Banner tone="info">
        Policies are recorded for your records schedule. Nothing is archived or deleted automatically yet, and
        deletion cannot be chosen until legal holds are supported.
      </Banner>
      {adding && <RetentionForm onDone={() => setAdding(false)} />}
      {result.error ? (
        <ErrorState error={result.error} onRetry={() => void result.refetch()} />
      ) : result.data === undefined ? (
        <LoadingState label="Loading retention policies" />
      ) : result.data.length === 0 ? (
        <EmptyState title="No policies recorded">
          <p>Without a policy, records are kept indefinitely.</p>
        </EmptyState>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Records</th>
              <th scope="col">Kept for</th>
              <th scope="col">Then</th>
              <th scope="col">Basis</th>
              <th scope="col">From</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((p) => (
              <tr key={p.id}>
                <td>{words(p.recordCategory)}</td>
                <td>{p.retentionDays === undefined ? "Indefinitely" : `${p.retentionDays} days`}</td>
                <td>{words(p.action)}</td>
                <td>{p.basis}</td>
                <td>{formatDateTime(p.effectiveFrom)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function RetentionForm({ onDone }: { onDone: () => void }) {
  const [recordCategory, setCategory] = useState<Schemas["RetentionRecordCategory"]>("CLINICAL_PHOTO");
  const [retentionDays, setDays] = useState("");
  const [action, setAction] = useState<"ARCHIVE" | "REVIEW">("REVIEW");
  const [basis, setBasis] = useState("");
  const [effectiveFrom, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="stack"
      aria-label="Record a retention policy"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          unwrap(
            await api.POST("/retention-policies", {
              body: {
                recordCategory,
                action,
                basis,
                effectiveFrom: new Date(`${effectiveFrom}T00:00:00`).toISOString(),
                ...(retentionDays ? { retentionDays: Number(retentionDays) } : {}),
              },
            }),
          );
          await queryClient.invalidateQueries({ queryKey: retentionQuery.queryKey });
          onDone();
        } catch (err) {
          setError(messageOf(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="row wrap">
        <Select
          label="Records"
          value={recordCategory}
          onChange={(e) => setCategory(e.target.value as Schemas["RetentionRecordCategory"])}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {words(c)}
            </option>
          ))}
        </Select>
        <Field
          label="Kept for (days)"
          type="number"
          min={1}
          max={36500}
          hint="Leave empty to keep indefinitely."
          value={retentionDays}
          onChange={(e) => setDays(e.target.value)}
        />
        <Select
          label="Then"
          value={action}
          onChange={(e) => setAction(e.target.value as "ARCHIVE" | "REVIEW")}
        >
          <option value="REVIEW">Review</option>
          <option value="ARCHIVE">Archive</option>
        </Select>
      </div>
      <Field
        label="Basis"
        required
        maxLength={300}
        hint="Your policy or legal basis, for example a records schedule reference."
        value={basis}
        onChange={(e) => setBasis(e.target.value)}
      />
      <Field
        label="Effective from"
        type="date"
        required
        value={effectiveFrom}
        onChange={(e) => setFrom(e.target.value)}
      />
      <div className="row">
        <Button type="submit" disabled={busy}>
          Record policy
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
