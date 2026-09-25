// Provider app scenes (iPad landscape first, adapts to iPhone). Static layouts
// with hard-coded data; interactions are local UI state only.
import React from "react";
import {
  ana,
  consultationSteps,
  conversation,
  disclaimer,
  faceProtocol,
  mediaPermissions,
  money,
  type Plan,
  patients,
  plans,
  profileTabs,
  simulation,
  threads,
} from "../data/fixtures";
import { Icon } from "../ui/icons";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  IconButton,
  ListRow,
  Meter,
  SearchField,
  Segmented,
  StateView,
  Toggle,
  useOffline,
} from "../ui/kit";
import { type FaceView, Portrait } from "../ui/Portrait";
import { ProviderShell, Wordmark } from "../ui/shells";

// ============================================================ Sign in
export function SignInScene() {
  return (
    <div className="app signin">
      <div className="signin-art" aria-hidden="true">
        <div className="signin-mosaic">
          <Portrait view="LEFT_45" />
          <Portrait view="FRONT" />
          <Portrait view="RIGHT_PROFILE" />
        </div>
        <p className="signin-tagline">
          Standardized photography, consultation and visualization in one place.
        </p>
      </div>
      <div className="signin-panel">
        <div className="signin-form">
          <Wordmark />
          <h1 className="text-title1">Sign in</h1>
          <p className="text-subheadline muted">
            Use your practice account. Your organization's security policy applies.
          </p>
          <label className="field">
            <span className="field-label">Work email</span>
            <input type="email" defaultValue="mia.kim@lumenaesthetic.example" />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input type="password" defaultValue="correct horse battery" />
          </label>
          <Button variant="primary" size="lg" full>
            Sign in
          </Button>
          <Button variant="secondary" size="lg" icon="faceId" full>
            Sign in with Face ID
          </Button>
          <a className="link text-subheadline" href="#forgot">
            Forgot password?
          </a>
          <p className="text-footnote muted signin-foot">
            <Icon name="lock" size={14} /> Protected health information. Access is logged.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================ shared patient pieces
function PatientHeader({ compact }: { compact?: boolean }) {
  return (
    <div className="patient-header">
      <Avatar initials={ana.initials} size={compact ? 48 : 64} tone="accent" />
      <div className="patient-header-text">
        <div className="patient-name-row">
          <h2 className={compact ? "text-title3" : "text-title2"}>{ana.name}</h2>
          <Badge tone="info" icon="stethoscope">
            In consultation
          </Badge>
        </div>
        <div className="patient-meta text-subheadline muted">
          <span>
            {ana.dob} · {ana.age} y
          </span>
          <span>MRN {ana.mrn}</span>
          <span>{ana.practice}</span>
        </div>
      </div>
    </div>
  );
}

function PermissionList() {
  const tone = (s: string) =>
    s === "GRANTED" ? "success" : s === "DECLINED" ? "danger" : s === "REQUESTED" ? "warning" : "neutral";
  const text = (s: string) =>
    s === "GRANTED"
      ? "Granted"
      : s === "DECLINED"
        ? "Declined"
        : s === "REQUESTED"
          ? "Requested"
          : "Not asked";
  return (
    <ul className="perm-list">
      {mediaPermissions.map((p) => (
        <li key={p.category}>
          <span>
            {p.category}
            {p.note ? <span className="text-footnote muted">{p.note}</span> : null}
          </span>
          <span className="perm-right">
            <Badge tone={tone(p.state)}>{text(p.state)}</Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}

function PatientOverview() {
  return (
    <div className="overview-grid">
      <Card title="Today" action={<Badge tone="info">10:00 AM</Badge>}>
        <div className="today-row">
          <Icon name="stethoscope" size={22} />
          <div>
            <div className="text-headline">Lip and perioral consultation</div>
            <div className="text-subheadline muted">With Dr. Mia Kim · Room 2 · started 10:05 AM</div>
          </div>
        </div>
        <Button variant="primary" icon="chevronRight">
          Resume consultation
        </Button>
      </Card>
      <Card title="Clinical alerts">
        <Banner tone="warning" icon="warning" title="Allergy">
          {ana.allergies}
        </Banner>
        <div className="chip-row">
          {ana.concerns.map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
        </div>
      </Card>
      <Card
        title="Recent photos"
        action={
          <a className="link text-subheadline" href="#photos">
            See all
          </a>
        }
      >
        <div className="thumb-row">
          {faceProtocol.slice(0, 3).map((v) => (
            <figure key={v.key} className="thumb">
              <Portrait view={v.key} />
              <figcaption>{v.name}</figcaption>
            </figure>
          ))}
        </div>
        <p className="text-footnote muted">Face · standard protocol · today</p>
      </Card>
      <Card
        title="Media permissions"
        action={
          <a className="link text-subheadline" href="#perm">
            Manage
          </a>
        }
      >
        <PermissionList />
      </Card>
    </div>
  );
}

// ============================================================ Patients (list + detail)
export function PatientsScene() {
  const [filter, setFilter] = React.useState<"today" | "all" | "recent">("today");
  return (
    <ProviderShell
      nav="patients"
      title="Patients"
      actions={
        <Button variant="primary" icon="plus">
          New patient
        </Button>
      }
      wide
    >
      <div className="split">
        <div className="split-list">
          <SearchField placeholder="Search name, date of birth or MRN" />
          <Segmented
            label="Filter patients"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "today", label: "Today" },
              { value: "recent", label: "Recent" },
              { value: "all", label: "All" },
            ]}
          />
          <StateView
            empty={{
              icon: "people",
              title: "No patients yet",
              body: "Add your first patient to start a consultation. Duplicates are checked before anything is saved.",
              action: "New patient",
            }}
            deniedWhat="patient records"
          >
            <div className="list">
              {patients.map((p, i) => (
                <ListRow
                  key={p.id}
                  selected={i === 0}
                  leading={<Avatar initials={p.initials} tone={i === 0 ? "accent" : "neutral"} />}
                  title={
                    <span className="row-title">
                      {p.name}
                      {p.status === "INACTIVE" ? <Badge>Inactive</Badge> : null}
                    </span>
                  }
                  subtitle={
                    <>
                      {p.dob} · MRN {p.mrn}
                      {p.flag ? <span className="row-flag">{p.flag}</span> : null}
                      {p.next && !p.flag ? <span className="row-next">{p.next}</span> : null}
                    </>
                  }
                />
              ))}
            </div>
          </StateView>
        </div>
        <div className="split-detail">
          <StateView
            empty={{ icon: "person", title: "Select a patient", body: "Their overview appears here." }}
            deniedWhat="this patient's record"
          >
            <PatientHeader />
            <PatientOverview />
          </StateView>
        </div>
      </div>
    </ProviderShell>
  );
}

// ============================================================ Patient profile
export function PatientProfileScene() {
  const [tab, setTab] = React.useState<string>("Overview");
  return (
    <ProviderShell
      nav="patients"
      back="Patients"
      title="Patient record"
      actions={
        <>
          <IconButton icon="message" label="Message patient" />
          <Button variant="primary" icon="camera">
            Capture photos
          </Button>
        </>
      }
    >
      <StateView
        empty={{ icon: "person", title: "Patient not found", body: "It may have been archived." }}
        deniedWhat="this patient's record"
      >
        <PatientHeader />
        <div className="tab-strip" role="tablist" aria-label="Patient record sections">
          {profileTabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              className={t === tab ? "is-selected" : undefined}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "Overview" ? (
          <PatientOverview />
        ) : (
          <div className="state-view">
            <span className="state-icon">
              <Icon name="list" size={28} />
            </span>
            <h3 className="text-title3">{tab}</h3>
            <p className="text-subheadline muted">
              This tab's layout is designed in its own layer. The Overview, consultation, photo, comparison,
              visualization, plan, consent and message scenes show the core patterns.
            </p>
          </div>
        )}
      </StateView>
    </ProviderShell>
  );
}

// ============================================================ Consultation workspace
export function ConsultationScene() {
  return (
    <ProviderShell
      nav="consultations"
      back={ana.name}
      title="Lip and perioral consultation"
      subtitle={
        <span className="subtitle-row">
          <Badge tone="info">In progress</Badge> Dr. Mia Kim · Room 2 · started 10:05 AM
        </span>
      }
      actions={
        <Button variant="secondary" icon="doc">
          Request information
        </Button>
      }
      wide
    >
      <StateView
        empty={{
          icon: "stethoscope",
          title: "No consultation open",
          body: "Start one from the patient's record.",
        }}
        deniedWhat="consultations"
      >
        <div className="consult">
          <ol className="stepper" aria-label="Consultation steps">
            {consultationSteps.map((s, i) => (
              <li
                key={s.key}
                className={`step${s.done ? " is-done" : ""}${"current" in s && s.current ? " is-current" : ""}`}
                aria-current={"current" in s && s.current ? "step" : undefined}
              >
                <span className="step-dot">{s.done ? <Icon name="check" size={14} /> : i + 1}</span>
                <span className="step-label">
                  {s.label}
                  {"optional" in s && s.optional ? <span className="step-opt">Optional</span> : null}
                </span>
              </li>
            ))}
          </ol>
          <div className="consult-main">
            <Card title="Photography" action={<Badge tone="warning">1 required view left</Badge>}>
              <p className="text-subheadline muted card-sub">Face · standard protocol · 5 views</p>
              <div className="view-grid">
                {faceProtocol.map((v) => (
                  <figure key={v.key} className={`view-tile${v.captured ? " is-captured" : ""}`}>
                    {v.captured ? (
                      <Portrait view={v.key} />
                    ) : (
                      <div className="view-empty">
                        <Icon name="camera" size={26} />
                      </div>
                    )}
                    <figcaption>
                      <span>{v.name}</span>
                      {v.captured ? (
                        <Badge tone="success" icon="check">
                          {Math.round((v.score ?? 0) * 100)}%
                        </Badge>
                      ) : v.required ? (
                        <Badge tone="warning">Required</Badge>
                      ) : (
                        <Badge>Optional</Badge>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
              <div className="card-actions">
                <Button variant="secondary" icon="photo">
                  Import from library
                </Button>
                <Button variant="primary" size="lg" icon="camera">
                  Capture left profile
                </Button>
              </div>
            </Card>
            <div className="consult-side">
              <Card title="Concerns">
                <div className="chip-row">
                  {ana.concerns.map((c) => (
                    <span key={c} className="chip">
                      {c}
                    </span>
                  ))}
                </div>
              </Card>
              <Card title="Notes" action={<Badge>Draft · saved on device</Badge>}>
                <p className="note-text">
                  Wants subtle upper-lip volume and a more defined border. No prior filler. Discussed natural
                  proportions and the two-week review visit.
                </p>
              </Card>
              <Card title="Before you complete">
                <ul className="check-list">
                  <li className="is-done">
                    <Icon name="check" size={16} /> Reason and concerns recorded
                  </li>
                  <li>
                    <Icon name="clock" size={16} /> Summary not generated yet
                  </li>
                  <li>
                    <Icon name="clock" size={16} /> Release decision not recorded
                  </li>
                </ul>
              </Card>
            </div>
          </div>
        </div>
      </StateView>
    </ProviderShell>
  );
}

// ============================================================ Guided capture (full-bleed camera)
export function CaptureScene() {
  const [ghost, setGhost] = React.useState(true);
  const current = faceProtocol[3] as (typeof faceProtocol)[number];
  const stripRef = React.useRef<HTMLOListElement>(null);
  // Keep the current view in sight when the strip is wider than the screen.
  React.useEffect(() => {
    const strip = stripRef.current;
    const item = strip?.querySelector<HTMLElement>(".is-current");
    if (strip && item) strip.scrollLeft = item.offsetLeft - (strip.clientWidth - item.offsetWidth) / 2;
  }, []);
  return (
    <div className="app capture">
      <header className="capture-top">
        <a href="#close" className="capture-close" aria-label="Close camera">
          <Icon name="close" size={22} />
        </a>
        <div className="capture-title">
          <strong>{current.name}</strong>
          <span>Ana Reyes · Face, standard · view 4 of 5</span>
        </div>
        <Toggle label="Ghost" checked={ghost} onChange={() => setGhost((g) => !g)} />
      </header>
      <div className="viewfinder">
        {/* The stage keeps the photo's 3:4 frame so the oval sits on the face on every screen size. */}
        <div className="viewfinder-stage">
          <Portrait view="LEFT_PROFILE" className="live" fit="contain" backdrop="none" />
          {ghost ? (
            <Portrait view="LEFT_PROFILE" lipFullness={0} className="ghost" fit="contain" backdrop="none" />
          ) : null}
          <span className="guide-oval" aria-hidden="true" />
        </div>
        <div className="frame-guides" aria-hidden="true">
          <span className="guide-h" />
          <span className="guide-v" />
        </div>
        <div className="guidance" role="status">
          <Icon name="info" size={18} />
          Raise chin slightly
        </div>
        <div className="level" role="img" aria-label="Camera level: 1.5 degrees">
          <span className="level-line" />
          <span className="level-val">1.5°</span>
        </div>
      </div>
      <footer className="capture-bottom">
        <ol className="capture-strip" aria-label="Protocol views" ref={stripRef}>
          {faceProtocol.map((v) => (
            <li
              key={v.key}
              className={`strip-item${v.key === current.key ? " is-current" : ""}${v.captured ? " is-done" : ""}`}
            >
              {v.captured ? <Icon name="check" size={14} /> : null}
              {v.name}
            </li>
          ))}
        </ol>
        <div className="capture-controls">
          <div className="capture-meter">
            <Meter label="Position match" value={0.86} display="86%" />
            <span className="capture-note">Photographic position match, not a medical measurement.</span>
          </div>
          <button type="button" className="shutter" aria-label="Take photo">
            <span />
          </button>
          <div className="capture-right">
            <span className="capture-check is-ok">
              <Icon name="check" size={14} /> Lighting
            </span>
            <span className="capture-check is-ok">
              <Icon name="check" size={14} /> Distance
            </span>
            <span className="capture-check">
              <Icon name="warning" size={14} /> Chin
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ============================================================ Before / after
type CompareMode = "side" | "slider" | "fade" | "blink" | "overlay";

export function CompareScene() {
  const [mode, setMode] = React.useState<CompareMode>("slider");
  const [pos, setPos] = React.useState(52);
  const [view, setView] = React.useState<FaceView>("FRONT");
  const [sync, setSync] = React.useState(true);
  const [blinkAfter, setBlinkAfter] = React.useState(false);

  React.useEffect(() => {
    if (mode !== "blink") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setBlinkAfter((b) => !b), 900);
    return () => window.clearInterval(id);
  }, [mode]);

  const before = <Portrait view={view} lipFullness={0} fit="contain" />;
  const after = <Portrait view={view} lipFullness={3} fit="contain" />;

  return (
    <ProviderShell
      nav="patients"
      back={ana.name}
      title="Before / after"
      subtitle="Mar 14, 2026 → Sep 25, 2026 · same patient, same view"
      actions={
        <Button variant="secondary" icon="export">
          Export…
        </Button>
      }
      wide
    >
      <StateView
        empty={{
          icon: "compare",
          title: "No comparisons yet",
          body: "Pick two photos of the same view to compare.",
        }}
        deniedWhat="photos for this patient"
      >
        <div className="compare-toolbar">
          <Segmented
            label="Comparison mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "side", label: "Side by side" },
              { value: "slider", label: "Slider" },
              { value: "fade", label: "Cross-fade" },
              { value: "blink", label: "Blink" },
              { value: "overlay", label: "Overlay" },
            ]}
          />
          <Segmented
            label="View"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "FRONT", label: "Front" },
              { value: "LEFT_45", label: "L 45°" },
              { value: "RIGHT_45", label: "R 45°" },
            ]}
          />
        </div>
        <div className={`stage stage-${mode}`}>
          {mode === "side" ? (
            <div className="stage-side">
              <figure>
                {before}
                <figcaption>Before · Mar 14, 2026</figcaption>
              </figure>
              <figure>
                {after}
                <figcaption>After · Sep 25, 2026</figcaption>
              </figure>
            </div>
          ) : (
            <div className="stage-stack">
              <div className="stage-layer">{before}</div>
              <div
                className="stage-layer"
                style={
                  mode === "slider"
                    ? { clipPath: `inset(0 0 0 ${pos}%)` }
                    : mode === "fade"
                      ? { opacity: pos / 100 }
                      : mode === "blink"
                        ? { opacity: blinkAfter ? 1 : 0 }
                        : { opacity: 0.5, mixBlendMode: "normal" }
                }
              >
                {after}
              </div>
              {mode === "slider" ? <span className="slider-handle" style={{ left: `${pos}%` }} /> : null}
              <span className="stage-tag stage-tag-left">Before</span>
              <span className="stage-tag stage-tag-right">After</span>
              {mode === "slider" || mode === "fade" ? (
                <input
                  className="stage-range"
                  type="range"
                  min={0}
                  max={100}
                  value={pos}
                  aria-label={mode === "slider" ? "Slider position" : "Cross-fade amount"}
                  onChange={(e) => setPos(Number(e.target.value))}
                />
              ) : null}
            </div>
          )}
        </div>
        <div className="compare-footer">
          <Toggle label="Sync zoom and pan" checked={sync} onChange={() => setSync((s) => !s)} />
          <div className="compare-reg">
            <Badge tone="success" icon="check">
              Auto-aligned
            </Badge>
            <Button variant="tertiary" icon="refresh">
              Reset alignment
            </Button>
            <Button variant="tertiary" icon="sliders">
              Align manually
            </Button>
          </div>
          <p className="text-footnote muted">
            <Icon name="lock" size={14} /> Originals are never changed. Alignment is display-only; exports
            create a new copy and check the patient's permission for that purpose.
          </p>
        </div>
      </StateView>
    </ProviderShell>
  );
}

// ============================================================ AI visualization review
export function SimulationScene({ releasing = false }: { releasing?: boolean }) {
  const offline = useOffline();
  const [showBefore, setShowBefore] = React.useState(false);
  const approved = releasing;
  return (
    <ProviderShell
      nav="patients"
      back={ana.name}
      title="AI visualization · Lips"
      subtitle={
        <span className="subtitle-row">
          {approved ? (
            <Badge tone="success" icon="check">
              Approved by you
            </Badge>
          ) : (
            <Badge tone="simulation" icon="sparkles">
              Ready for your review
            </Badge>
          )}
          Version {simulation.version} · {simulation.model} · {simulation.generatedAt}
        </span>
      }
      wide
    >
      <StateView
        empty={{ icon: "sparkles", title: "No visualizations", body: "Create one from a consultation." }}
        deniedWhat="AI visualizations"
      >
        <div className="sim">
          <div className="sim-stage">
            <figure className="sim-photo">
              <Portrait view="FRONT" lipFullness={0} />
              <figcaption>Photo · today, front</figcaption>
            </figure>
            <figure className="sim-photo">
              <Portrait view="FRONT" lipFullness={showBefore ? 0 : 3} />
              <span className="ai-tag">
                <Icon name="sparkles" size={14} /> AI visualization
              </span>
              <figcaption>Visualization · not a predicted result</figcaption>
            </figure>
            <div className="sim-stage-actions">
              <Toggle
                label="Compare with photo"
                checked={showBefore}
                onChange={() => setShowBefore((s) => !s)}
              />
            </div>
          </div>
          <div className="sim-side">
            <Card title="Visual parameters">
              {simulation.parameters.map((p) => (
                <Meter
                  key={p.label}
                  label={p.label}
                  value={p.value}
                  display={`${Math.round(p.value * 100)}%`}
                />
              ))}
              <p className="text-footnote muted">
                Visual controls only. The model has no dose, product, units, depth or technique settings.
              </p>
            </Card>
            <Card title="Checks before review">
              <ul className="check-list">
                {simulation.checks.map((c) => (
                  <li key={c.label} className="is-done">
                    <Icon name="check" size={16} />
                    <span>
                      <strong>{c.label}</strong>
                      <span className="muted"> · {c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
        {approved ? null : (
          <div className="decision-bar">
            <Button variant="destructive" icon="close">
              Reject
            </Button>
            <Button
              variant="secondary"
              icon="refresh"
              disabled={offline}
              hint={offline ? "Needs a connection" : undefined}
            >
              Adjust & regenerate
            </Button>
            <span className="spacer" />
            <span className="text-footnote muted decision-note">
              Approving doesn't share anything with the patient.
            </span>
            <Button variant="primary" size="lg" icon="check">
              Approve
            </Button>
          </div>
        )}
        {approved ? (
          <div className="sheet-backdrop">
            <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="release-title">
              <span className="sheet-grabber" aria-hidden="true" />
              <h2 id="release-title" className="text-title3">
                Release to Ana's app?
              </h2>
              <p className="text-subheadline muted">
                Ana will see this visualization and her photo in the patient app. You can withdraw it later,
                but she may already have seen it.
              </p>
              <ul className="check-list">
                <li className="is-done">
                  <Icon name="check" size={16} /> Approved by you at 10:54 AM
                </li>
                <li className="is-done">
                  <Icon name="check" size={16} /> Patient-app permission granted (Mar 14, 2026)
                </li>
              </ul>
              <div className="sheet-quote">
                <span className="text-caption1 muted">Ana will see this notice with the image</span>
                <p>{disclaimer}</p>
              </div>
              <div className="sheet-actions">
                <Button variant="secondary" size="lg" full>
                  Not now
                </Button>
                <Button variant="primary" size="lg" icon="send" full disabled={offline}>
                  Release
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </StateView>
    </ProviderShell>
  );
}

export function ReleaseScene() {
  return <SimulationScene releasing />;
}

// ============================================================ Treatment plans A/B/C
function PlanCard({ plan, selected }: { plan: Plan; selected?: boolean | undefined }) {
  const subtotal = plan.items.reduce((s, i) => s + i.price, 0);
  const total = subtotal - plan.discount;
  return (
    <section className={`plan${selected ? " is-selected" : ""}`}>
      <header className="plan-head">
        <span className="plan-label">{plan.label}</span>
        {plan.recommended ? <Badge tone="accent">Suggested</Badge> : null}
      </header>
      <h3 className="text-title3">{plan.title}</h3>
      <p className="text-subheadline muted">{plan.note}</p>
      <table className="plan-items">
        <tbody>
          {plan.items.map((i) => (
            <tr key={i.treatment}>
              <td>
                <div>{i.treatment}</div>
                <div className="text-footnote muted">{i.area === "—" ? i.qty : `${i.area} · ${i.qty}`}</div>
              </td>
              <td className="num">{i.price ? money(i.price) : "Included"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="plan-totals">
        <div>
          <dt>Subtotal</dt>
          <dd className="num">{money(subtotal)}</dd>
        </div>
        {plan.discount ? (
          <div>
            <dt>Discount</dt>
            <dd className="num">−{money(plan.discount)}</dd>
          </div>
        ) : null}
        <div className="plan-total">
          <dt>Estimated total</dt>
          <dd className="num">{money(total)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function PlansScene() {
  const [active, setActive] = React.useState("Plan B");
  const offline = useOffline();
  return (
    <ProviderShell
      nav="patients"
      back={ana.name}
      title="Treatment options"
      subtitle={
        <span className="subtitle-row">
          <Badge>Draft</Badge> Lip and perioral consultation · prices in USD
        </span>
      }
      actions={
        <Button variant="primary" icon="send" disabled={offline}>
          Send to patient
        </Button>
      }
      wide
    >
      <StateView
        empty={{
          icon: "clipboard",
          title: "No plans yet",
          body: "Build up to three options (A, B, C) to compare.",
          action: "New plan",
        }}
        deniedWhat="treatment plans"
      >
        <div className="plan-switch">
          <Segmented
            label="Plan option"
            value={active}
            onChange={setActive}
            options={plans.map((p) => ({ value: p.label, label: p.label }))}
          />
        </div>
        <div className="plans" role="radiogroup" aria-label="Treatment plan options">
          {plans.map((p) => (
            // biome-ignore lint/a11y/useSemanticElements: a card with a table can't live inside <input type="radio">
            <div
              key={p.label}
              role="radio"
              tabIndex={0}
              aria-checked={p.label === active}
              className={`plan-col${p.label === active ? " is-active" : ""}`}
              onClick={() => setActive(p.label)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") setActive(p.label);
              }}
            >
              <PlanCard plan={p} selected={p.label === active} />
            </div>
          ))}
        </div>
        <Banner tone="info" icon="info" title="Estimates, not invoices">
          Choosing a plan is not consent to treatment. Consent is signed separately. Financing reference: none
          added.
        </Banner>
      </StateView>
    </ProviderShell>
  );
}

// ============================================================ In-clinic consent signing (hand-off mode)
export function ConsentScene() {
  const [ack1, setAck1] = React.useState(true);
  const [ack2, setAck2] = React.useState(true);
  return (
    <div className="app consent">
      <header className="handoff-bar">
        <Icon name="lock" size={18} />
        <span>
          <strong>Patient signing mode.</strong> Hand the device back to staff when you're done. Leaving needs
          staff Face ID.
        </span>
      </header>
      <div className="consent-doc">
        <div className="consent-paper">
          <span className="text-caption1 muted">
            Lumen Aesthetic Partners · Consent · version 3 · published Sep 1, 2026
          </span>
          <h1 className="text-title1">Consent for dermal filler treatment of the lips</h1>
          <p>
            This form explains the treatment you are considering, its expected benefits, its risks and your
            alternatives. Read it carefully and ask any questions before you sign.
          </p>
          <h2 className="text-title3">Possible side effects</h2>
          <ul>
            <li>Swelling, tenderness and bruising for several days</li>
            <li>Lumps or asymmetry that may need follow-up</li>
            <li>Rare but serious vascular complications that need urgent care</li>
          </ul>
          <button
            type="button"
            className={`consent-check${ack1 ? " is-checked" : ""}`}
            onClick={() => setAck1((a) => !a)}
            aria-pressed={ack1}
          >
            <span className="box">{ack1 ? <Icon name="check" size={16} /> : null}</span>
            <span>
              I have read and understood the possible side effects. <em className="req">Required</em>
            </span>
          </button>
          <button
            type="button"
            className={`consent-check${ack2 ? " is-checked" : ""}`}
            onClick={() => setAck2((a) => !a)}
            aria-pressed={ack2}
          >
            <span className="box">{ack2 ? <Icon name="check" size={16} /> : null}</span>
            <span>
              I understand results vary and no outcome is guaranteed. <em className="req">Required</em>
            </span>
          </button>
          <div className="consent-row">
            <label className="field field-initial">
              <span className="field-label">Initials</span>
              <input defaultValue="AR" aria-label="Initials" />
            </label>
            <label className="field">
              <span className="field-label">Date</span>
              <input defaultValue="09/25/2026" aria-label="Date" />
            </label>
          </div>
          <div className="signature">
            <span className="field-label">Patient signature</span>
            <div className="signature-pad">
              <svg viewBox="0 0 400 110" aria-label="Signature drawn by patient">
                <path
                  d="M20 80c20-40 40-60 55-55s-25 60-5 58 30-50 50-48-10 40 8 38 22-30 40-28 5 22 20 20 25-18 40-16 10 14 30 10 40-8 60-12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
              <button type="button" className="link text-subheadline">
                Clear
              </button>
            </div>
            <span className="text-footnote muted">Ana Reyes · signing on this iPad</span>
          </div>
        </div>
      </div>
      <footer className="consent-footer">
        <div className="consent-progress">
          <Badge tone="success" icon="check">
            2 of 2 required items
          </Badge>
          <span className="text-footnote muted">Next: Dr. Kim signs as provider</span>
        </div>
        <Button variant="primary" size="lg" icon="signature" disabled={!(ack1 && ack2)}>
          Sign and finish
        </Button>
      </footer>
    </div>
  );
}

// ============================================================ Messages
export function MessagesScene() {
  const offline = useOffline();
  return (
    <ProviderShell
      nav="messages"
      title="Messages"
      actions={<IconButton icon="plus" label="New message" />}
      wide
    >
      <div className="split">
        <div className="split-list">
          <SearchField placeholder="Search messages" />
          <StateView
            empty={{
              icon: "message",
              title: "No conversations",
              body: "Messages with patients appear here.",
            }}
            deniedWhat="messages"
          >
            <div className="list">
              {threads.map((t, i) => (
                <ListRow
                  key={t.id}
                  selected={i === 0}
                  chevron={false}
                  leading={<Avatar initials={t.initials} tone={i === 0 ? "accent" : "neutral"} />}
                  title={
                    <span className="row-title">
                      {t.patient}
                      <span className="row-time">{t.time}</span>
                    </span>
                  }
                  subtitle={
                    <>
                      <span className="row-subject">{t.subject}</span>
                      <span className="row-preview">{t.last}</span>
                    </>
                  }
                  trailing={t.unread ? <span className="count">{t.unread}</span> : undefined}
                />
              ))}
            </div>
          </StateView>
        </div>
        <div className="split-detail convo">
          <StateView
            empty={{ icon: "message", title: "Pick a conversation", body: "" }}
            deniedWhat="messages"
          >
            <header className="convo-head">
              <Avatar initials="AR" tone="accent" />
              <div>
                <div className="text-headline">Ana Reyes</div>
                <div className="text-footnote muted">Your consultation materials · care team thread</div>
              </div>
            </header>
            <div className="bubbles">
              {conversation.map((m) => (
                <div
                  key={m.time + m.author}
                  className={`bubble-row ${m.from === "staff" ? "is-out" : "is-in"}`}
                >
                  <div className="bubble">
                    <p>{m.text}</p>
                    {m.attachment ? (
                      <span className="attachment">
                        <Icon name="doc" size={16} /> {m.attachment}
                      </span>
                    ) : null}
                  </div>
                  <span className="bubble-meta">
                    {m.author} · {m.time}
                  </span>
                </div>
              ))}
            </div>
            <div className="composer">
              <IconButton icon="paperclip" label="Attach a file" />
              <input
                placeholder={
                  offline ? "Offline: your message will send when you reconnect" : "Write a secure message"
                }
                aria-label="Message"
              />
              <IconButton icon="send" label="Send" />
            </div>
          </StateView>
        </div>
      </div>
    </ProviderShell>
  );
}
