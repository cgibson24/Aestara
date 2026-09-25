// Shared UI kit for the design prototype. Mirrors the DesignSystem module the
// iOS apps will have (Bible 24.2): buttons, badges, lists, fields, states.
import React from "react";
import { Icon, type IconName } from "./icons";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "simulation";

// ---------------------------------------------------------------- view state
export type ViewState = "normal" | "loading" | "empty" | "error" | "offline" | "denied";
export const ViewStateContext = React.createContext<ViewState>("normal");
export const useViewState = () => React.useContext(ViewStateContext);

// ---------------------------------------------------------------- buttons
type ButtonProps = {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "tertiary" | "destructive" | undefined;
  size?: "md" | "lg" | undefined;
  icon?: IconName | undefined;
  disabled?: boolean | undefined;
  full?: boolean | undefined;
  onClick?: (() => void) | undefined;
  hint?: string | undefined;
};

export function Button({
  children,
  variant = "secondary",
  size = "md",
  icon,
  disabled,
  full,
  onClick,
  hint,
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size}${full ? " btn-full" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={hint}
    >
      {icon ? <Icon name={icon} size={size === "lg" ? 22 : 20} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  active,
}: {
  icon: IconName;
  label: string;
  onClick?: (() => void) | undefined;
  active?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? " is-active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} size={22} />
    </button>
  );
}

// ---------------------------------------------------------------- badges & chips
export function Badge({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: Tone;
  icon?: IconName | undefined;
  children: React.ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

export function Avatar({
  initials,
  size = 40,
  tone = "neutral",
}: {
  initials: string;
  size?: number;
  tone?: Tone;
}) {
  return (
    <span
      className={`avatar avatar-${tone}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------- controls
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
}: {
  options: readonly { value: T; label: string; icon?: IconName | undefined }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  // Native radio inputs: arrow keys, VoiceOver and form semantics come free.
  const name = React.useId();
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className={o.value === value ? "is-selected" : undefined}>
          <input
            type="radio"
            className="visually-hidden"
            name={name}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          {o.icon ? <Icon name={o.icon} size={16} /> : null}
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function SearchField({ placeholder, value }: { placeholder: string; value?: string | undefined }) {
  return (
    <label className="search-field">
      <Icon name="search" size={18} />
      <input type="search" placeholder={placeholder} defaultValue={value} aria-label={placeholder} />
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange?: (() => void) | undefined;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={onChange}>
      <span className="toggle-label">{label}</span>
      <span className={`toggle-track${checked ? " is-on" : ""}`}>
        <span className="toggle-thumb" />
      </span>
    </button>
  );
}

export function Meter({
  label,
  value,
  display,
}: {
  label: string;
  value: number;
  display?: string | undefined;
}) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="num">{display ?? value.toFixed(2)}</span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: native <meter> can't be styled consistently across engines; the ARIA meter role is equivalent */}
      <div
        className="meter-track"
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={1}
      >
        <span className="meter-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- layout pieces
export function Card({
  title,
  action,
  children,
  flush,
}: {
  title?: string | undefined;
  action?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean | undefined;
}) {
  return (
    <section className={`card${flush ? " card-flush" : ""}`}>
      {title ? (
        <header className="card-head">
          <h3 className="text-headline">{title}</h3>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  selected,
  chevron = true,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean | undefined;
  chevron?: boolean;
}) {
  return (
    <a
      href="#row"
      className={`list-row${selected ? " is-selected" : ""}`}
      aria-current={selected ? "true" : undefined}
    >
      {leading}
      <div className="list-row-text">
        <div className="list-row-title">{title}</div>
        {subtitle ? <div className="list-row-sub">{subtitle}</div> : null}
      </div>
      {trailing}
      {chevron ? <Icon name="chevronRight" size={18} className="list-row-chevron" /> : null}
    </a>
  );
}

export function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: Tone;
  icon: IconName;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`} role="status">
      <Icon name={icon} size={20} />
      <div>
        <strong>{title}</strong>
        {children ? <div className="banner-body">{children}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- states (Bible 24.1)
type EmptyCopy = { icon: IconName; title: string; body: string; action?: string | undefined };

export function StateView({
  empty,
  deniedWhat = "this information",
  children,
}: {
  empty: EmptyCopy;
  deniedWhat?: string;
  children: React.ReactNode;
}) {
  const state = useViewState();
  if (state === "loading") return <Skeleton />;
  if (state === "empty")
    return (
      <div className="state-view">
        <span className="state-icon">
          <Icon name={empty.icon} size={28} />
        </span>
        <h3 className="text-title3">{empty.title}</h3>
        <p className="text-subheadline muted">{empty.body}</p>
        {empty.action ? (
          <Button variant="primary" icon="plus">
            {empty.action}
          </Button>
        ) : null}
      </div>
    );
  if (state === "error")
    return (
      <div className="state-view">
        <span className="state-icon state-icon-danger">
          <Icon name="warning" size={28} />
        </span>
        <h3 className="text-title3">Couldn't load this</h3>
        <p className="text-subheadline muted">
          The connection to the server dropped. Nothing you entered was lost. Try again, or check your
          network.
        </p>
        <Button variant="primary" icon="refresh">
          Try again
        </Button>
      </div>
    );
  if (state === "denied")
    return (
      <div className="state-view">
        <span className="state-icon">
          <Icon name="lock" size={28} />
        </span>
        <h3 className="text-title3">You don't have access</h3>
        <p className="text-subheadline muted">
          Your role doesn't include {deniedWhat}. Ask a practice administrator if you need it.
        </p>
      </div>
    );
  return (
    <>
      {state === "offline" ? (
        <Banner tone="warning" icon="wifiOff" title="You're offline">
          Photos and notes are saved on this device and sync when you reconnect. AI visualizations, sending
          and releasing need a connection.
        </Banner>
      ) : null}
      {children}
    </>
  );
}

export function Skeleton() {
  return (
    <div className="skeleton" aria-busy="true">
      <span className="visually-hidden">Loading</span>
      <span className="sk sk-title" />
      <span className="sk sk-line" />
      <span className="sk sk-line sk-short" />
      <div className="sk-grid">
        <span className="sk sk-block" />
        <span className="sk sk-block" />
        <span className="sk sk-block" />
      </div>
      <span className="sk sk-line" />
      <span className="sk sk-line sk-short" />
    </div>
  );
}

export function useOffline() {
  return useViewState() === "offline";
}
