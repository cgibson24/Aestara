// Prototype viewer: pick a surface (device), a scene and a view state; the
// device frame is scaled to fit the viewer's screen. Deep link: #<surface>-<scene>.
import React from "react";
import { AdminAuditScene, AdminUsersScene } from "../scenes/admin";
import {
  PatientHomeScene,
  PatientMessagesScene,
  PatientPlanScene,
  PatientSimulationScene,
} from "../scenes/patient";
import {
  CaptureScene,
  CompareScene,
  ConsentScene,
  ConsultationScene,
  MessagesScene,
  PatientProfileScene,
  PatientsScene,
  PlansScene,
  ReleaseScene,
  SignInScene,
  SimulationScene,
} from "../scenes/provider";
import { Icon } from "../ui/icons";
import { type ViewState, ViewStateContext } from "../ui/kit";
import { Wordmark } from "../ui/shells";

export type SurfaceKey = "ipad" | "iphone" | "patient" | "admin";
type Scene = { key: string; name: string; note: string; render: () => React.ReactElement };

const providerScenes: Scene[] = [
  {
    key: "signin",
    name: "Sign in",
    note: "Password or Face ID; access is logged",
    render: () => <SignInScene />,
  },
  {
    key: "patients",
    name: "Patients",
    note: "Search, today's list and a patient overview",
    render: () => <PatientsScene />,
  },
  {
    key: "profile",
    name: "Patient record",
    note: "The 12 record sections from the Bible",
    render: () => <PatientProfileScene />,
  },
  {
    key: "consultation",
    name: "Consultation",
    note: "Guided steps; photography in progress",
    render: () => <ConsultationScene />,
  },
  {
    key: "capture",
    name: "Guided capture",
    note: "Live guidance, ghost overlay, position match",
    render: () => <CaptureScene />,
  },
  {
    key: "compare",
    name: "Before / after",
    note: "Side by side, slider, cross-fade, blink, overlay",
    render: () => <CompareScene />,
  },
  {
    key: "visualization",
    name: "AI visualization review",
    note: "Approve, reject or regenerate",
    render: () => <SimulationScene />,
  },
  {
    key: "release",
    name: "Release to patient",
    note: "Separate, confirmed step with disclaimer",
    render: () => <ReleaseScene />,
  },
  {
    key: "plans",
    name: "Treatment options",
    note: "Plans A, B and C with estimates",
    render: () => <PlansScene />,
  },
  {
    key: "consent",
    name: "Consent signing",
    note: "In-clinic hand-off to the patient",
    render: () => <ConsentScene />,
  },
  {
    key: "messages",
    name: "Messages",
    note: "Secure patient conversations",
    render: () => <MessagesScene />,
  },
];

export const surfaces: Record<
  SurfaceKey,
  { label: string; short: string; frame: "ipad" | "iphone" | "browser"; scenes: Scene[] }
> = {
  ipad: { label: "Provider · iPad", short: "iPad", frame: "ipad", scenes: providerScenes },
  iphone: { label: "Provider · iPhone", short: "iPhone", frame: "iphone", scenes: providerScenes },
  patient: {
    label: "Patient app · iPhone",
    short: "Patient",
    frame: "iphone",
    scenes: [
      { key: "home", name: "Home", note: "Next visit and to-dos", render: () => <PatientHomeScene /> },
      {
        key: "visualization",
        name: "Visualization",
        note: "Released only, with the required notice",
        render: () => <PatientSimulationScene />,
      },
      {
        key: "plan",
        name: "Treatment options",
        note: "Choose, ask or decline",
        render: () => <PatientPlanScene />,
      },
      {
        key: "messages",
        name: "Messages",
        note: "Care team conversation",
        render: () => <PatientMessagesScene />,
      },
    ],
  },
  admin: {
    label: "Admin · Web",
    short: "Admin",
    frame: "browser",
    scenes: [
      {
        key: "users",
        name: "Users & roles",
        note: "Roles, scopes and permissions",
        render: () => <AdminUsersScene />,
      },
      {
        key: "audit",
        name: "Audit log",
        note: "Append-only, identifiers only",
        render: () => <AdminAuditScene />,
      },
    ],
  },
};

const frameSize = {
  ipad: { w: 1180, h: 820 },
  iphone: { w: 393, h: 852 },
  browser: { w: 1280, h: 820 },
} as const;
const bezel = { ipad: 16, iphone: 12, browser: 0 } as const;

const states: { value: ViewState; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "loading", label: "Loading" },
  { value: "empty", label: "Empty" },
  { value: "error", label: "Error" },
  { value: "offline", label: "Offline" },
  { value: "denied", label: "No access" },
];

type ThemeChoice = "viewer" | "light" | "dark";

function readHash(): { surface: SurfaceKey; scene: string } | null {
  if (typeof window === "undefined") return null;
  const m = /^#(ipad|iphone|patient|admin)-([a-z]+)$/.exec(window.location.hash);
  if (!m) return null;
  const surface = m[1] as SurfaceKey;
  return surfaces[surface].scenes.some((s) => s.key === m[2]) ? { surface, scene: m[2] as string } : null;
}

export function Prototype() {
  const initial = readHash();
  const narrow = typeof window !== "undefined" && window.innerWidth < 760;
  const [surface, setSurface] = React.useState<SurfaceKey>(initial?.surface ?? (narrow ? "iphone" : "ipad"));
  const [sceneKey, setSceneKey] = React.useState<string>(initial?.scene ?? "patients");
  const [state, setState] = React.useState<ViewState>("normal");
  const [theme, setTheme] = React.useState<ThemeChoice>("viewer");
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);

  const def = surfaces[surface];
  const scene = def.scenes.find((s) => s.key === sceneKey) ?? (def.scenes[0] as Scene);
  const size = frameSize[def.frame];
  const outer = {
    w: size.w + bezel[def.frame] * 2,
    h: size.h + bezel[def.frame] * 2 + (def.frame === "browser" ? 40 : 0),
  };

  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fitToStage = () => {
      const availW = el.clientWidth;
      const availH = Math.max(320, window.innerHeight - el.getBoundingClientRect().top - 24);
      const fitW = availW / outer.w;
      const fitH = availH / outer.h;
      const s = Math.min(1, fitW, fitH);
      setScale(s < fitW * 0.62 ? Math.min(1, fitW) : s);
    };
    fitToStage();
    const ro = new ResizeObserver(fitToStage);
    ro.observe(el);
    window.addEventListener("resize", fitToStage);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fitToStage);
    };
  }, [outer.w, outer.h]);

  // Tokens respond to :root[data-theme]; remember the page's own value so
  // "Match my device" restores it.
  const hostTheme = React.useRef<string | null>(null);
  React.useEffect(() => {
    hostTheme.current = document.documentElement.getAttribute("data-theme");
  }, []);
  React.useEffect(() => {
    const root = document.documentElement;
    if (theme !== "viewer") root.setAttribute("data-theme", theme);
    else if (hostTheme.current) root.setAttribute("data-theme", hostTheme.current);
    else root.removeAttribute("data-theme");
  }, [theme]);

  React.useEffect(() => {
    const hash = `#${surface}-${scene.key}`;
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  }, [surface, scene.key]);

  const chooseSurface = (s: SurfaceKey) => {
    setSurface(s);
    if (!surfaces[s].scenes.some((x) => x.key === sceneKey)) setSceneKey(surfaces[s].scenes[0]?.key ?? "");
  };

  return (
    <div className="proto">
      <header className="proto-bar">
        <div className="proto-brand">
          <Wordmark />
          <span className="proto-label">Design prototype</span>
        </div>
        <div className="proto-surfaces" role="tablist" aria-label="Device">
          {(Object.keys(surfaces) as SurfaceKey[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === surface}
              className={k === surface ? "is-selected" : undefined}
              onClick={() => chooseSurface(k)}
            >
              <span className="long">{surfaces[k].label}</span>
              <span className="short">{surfaces[k].short}</span>
            </button>
          ))}
        </div>
        <div className="proto-tools">
          <label className="proto-select">
            <span>State</span>
            <select id="proto-state" value={state} onChange={(e) => setState(e.target.value as ViewState)}>
              {states.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="proto-select">
            <span>Theme</span>
            <select id="proto-theme" value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)}>
              <option value="viewer">Match my device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </header>
      <div className="proto-body">
        <nav className="proto-scenes" aria-label="Scenes">
          <label className="proto-scene-select proto-select">
            <span>Scene</span>
            <select id="proto-scene" value={scene.key} onChange={(e) => setSceneKey(e.target.value)}>
              {def.scenes.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <ol className="proto-scene-list">
            {def.scenes.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className={s.key === scene.key ? "is-selected" : undefined}
                  aria-current={s.key === scene.key ? "page" : undefined}
                  onClick={() => setSceneKey(s.key)}
                >
                  <span className="scene-name">{s.name}</span>
                  <span className="scene-note">{s.note}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="proto-disclaimer">
            <Icon name="info" size={14} /> Static prototype with made-up data. No backend, no sign-in, nothing
            is saved.
          </p>
        </nav>
        <main className="proto-stage" ref={stageRef}>
          <div className="device-slot" style={{ width: outer.w * scale, height: outer.h * scale }}>
            <div
              className={`device device-${def.frame}`}
              style={{ width: outer.w, height: outer.h, transform: `scale(${scale})` }}
            >
              {def.frame === "browser" ? (
                <div className="browser-bar" aria-hidden="true">
                  <span className="dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="address">
                    <Icon name="lock" size={12} /> admin.aestara.example/{scene.key}
                  </span>
                </div>
              ) : null}
              <div className="screen" style={{ width: size.w, height: size.h }}>
                {def.frame !== "browser" ? (
                  <StatusBar frame={def.frame} dark={scene.key === "capture" || scene.key === "consent"} />
                ) : null}
                {def.frame === "iphone" ? <span className="island" aria-hidden="true" /> : null}
                <ViewStateContext.Provider value={state}>
                  <div className="screen-body" key={`${surface}-${scene.key}-${state}`}>
                    {scene.render()}
                  </div>
                </ViewStateContext.Provider>
                {def.frame === "iphone" ? <span className="home-indicator" aria-hidden="true" /> : null}
              </div>
            </div>
          </div>
          <p className="proto-caption">
            {def.label} · {scene.name} · {Math.round(scale * 100)}% scale
          </p>
        </main>
      </div>
    </div>
  );
}

function StatusBar({ frame, dark }: { frame: "ipad" | "iphone"; dark: boolean }) {
  return (
    <div className={`status-bar status-${frame}${dark ? " status-dark" : ""}`} aria-hidden="true">
      <span className="status-time">10:58</span>
      {frame === "ipad" ? <span className="status-date">Fri Sep 25</span> : null}
      <span className="status-icons">
        <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
          <path d="M1 11h2V8H1zM5 11h2V6H5zM9 11h2V4H9zM13 11h2V1h-2z" fill="currentColor" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
          <path
            d="M8 11.5 10.5 9a3.5 3.5 0 0 0-5 0L8 11.5ZM3.6 7.1a6.2 6.2 0 0 1 8.8 0l1.4-1.4a8.2 8.2 0 0 0-11.6 0l1.4 1.4ZM.8 4.3a10.2 10.2 0 0 1 14.4 0L16 3.5a11.3 11.3 0 0 0-16 0l.8.8Z"
            fill="currentColor"
          />
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true">
          <rect
            x="0.5"
            y="0.5"
            width="22"
            height="11"
            rx="3"
            fill="none"
            stroke="currentColor"
            opacity="0.5"
          />
          <rect x="2" y="2" width="16" height="8" rx="1.6" fill="currentColor" />
          <rect x="23.5" y="4" width="1.8" height="4" rx="0.8" fill="currentColor" opacity="0.5" />
        </svg>
      </span>
    </div>
  );
}
