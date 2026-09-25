// App shells. The provider shell is one component for both devices: a CSS
// container query shows the iPad sidebar at regular width and collapses to an
// iPhone tab bar at compact width, the same way SwiftUI's NavigationSplitView
// adapts (Bible 24.5).
import React from "react";
import { me, org } from "../data/fixtures";
import { Icon, type IconName } from "./icons";
import { Avatar } from "./kit";

export type ProviderNav = "patients" | "schedule" | "consultations" | "messages" | "capture" | "settings";

const sidebarItems: { key: ProviderNav; label: string; icon: IconName; badge?: number }[] = [
  { key: "patients", label: "Patients", icon: "people" },
  { key: "schedule", label: "Schedule", icon: "calendar" },
  { key: "consultations", label: "Consultations", icon: "stethoscope" },
  { key: "messages", label: "Messages", icon: "message", badge: 3 },
  { key: "capture", label: "Capture", icon: "camera" },
  { key: "settings", label: "Settings", icon: "gear" },
];

const tabItems: { key: ProviderNav; label: string; icon: IconName }[] = [
  { key: "patients", label: "Patients", icon: "people" },
  { key: "schedule", label: "Schedule", icon: "calendar" },
  { key: "capture", label: "Capture", icon: "camera" },
  { key: "messages", label: "Messages", icon: "message" },
  { key: "settings", label: "More", icon: "more" },
];

export function Wordmark({ compact }: { compact?: boolean | undefined }) {
  return (
    <span className="wordmark">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M7 16.5 12 6l5 10.5M9 13h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span className={compact ? "visually-hidden" : undefined}>Aestara</span>
    </span>
  );
}

export function ProviderShell({
  nav,
  title,
  subtitle,
  back,
  actions,
  children,
  wide,
}: {
  nav: ProviderNav;
  title: string;
  subtitle?: React.ReactNode;
  back?: string | undefined;
  actions?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean | undefined;
}) {
  return (
    <div className="app provider">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <Wordmark />
        </div>
        <button type="button" className="practice-switch">
          <Icon name="building" size={18} />
          <span>
            <span className="practice-org">{org.name}</span>
            <span className="practice-name">{org.activePractice}</span>
          </span>
          <Icon name="chevronDown" size={16} />
        </button>
        <nav className="sidebar-nav">
          {sidebarItems.map((i) => (
            <a key={i.key} href="#nav" className={`sidebar-item${i.key === nav ? " is-active" : ""}`}>
              <Icon name={i.icon} size={20} />
              <span>{i.label}</span>
              {i.badge ? <span className="count">{i.badge}</span> : null}
            </a>
          ))}
        </nav>
        <div className="sidebar-me">
          <Avatar initials={me.initials} size={36} tone="accent" />
          <span>
            <span className="me-name">{me.name}</span>
            <span className="me-role">{me.role}</span>
          </span>
        </div>
      </aside>
      <div className="main">
        <header className="navbar">
          {back ? (
            <a href="#back" className="nav-back">
              <Icon name="chevronLeft" size={22} />
              <span>{back}</span>
            </a>
          ) : null}
          <div className="nav-titles">
            <h1 className="nav-title">{title}</h1>
            {subtitle ? <div className="nav-subtitle">{subtitle}</div> : null}
          </div>
          {actions ? <div className="nav-actions">{actions}</div> : null}
        </header>
        <div className={`content${wide ? " content-wide" : ""}`}>{children}</div>
        <TabBar items={tabItems} active={nav === "consultations" ? "patients" : nav} />
      </div>
    </div>
  );
}

export function TabBar({
  items,
  active,
}: {
  items: { key: string; label: string; icon: IconName }[];
  active: string;
}) {
  return (
    <nav className="tabbar" aria-label="Tabs">
      {items.map((t) => (
        <a key={t.key} href="#tab" className={`tab${t.key === active ? " is-active" : ""}`}>
          <Icon name={t.icon} size={24} />
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

export type PatientTab = "home" | "care" | "appointments" | "messages" | "profile";

const patientTabs: { key: PatientTab; label: string; icon: IconName }[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "care", label: "My care", icon: "heart" },
  { key: "appointments", label: "Visits", icon: "calendar" },
  { key: "messages", label: "Messages", icon: "message" },
  { key: "profile", label: "Profile", icon: "person" },
];

export function PatientShell({
  tab,
  title,
  back,
  children,
  largeTitle = true,
}: {
  tab: PatientTab;
  title: string;
  back?: string | undefined;
  children: React.ReactNode;
  largeTitle?: boolean;
}) {
  return (
    <div className="app patient">
      <div className="main">
        <header className={`navbar${largeTitle ? " navbar-large" : ""}`}>
          {back ? (
            <a href="#back" className="nav-back">
              <Icon name="chevronLeft" size={22} />
              <span>{back}</span>
            </a>
          ) : null}
          <div className="nav-titles">
            <h1 className="nav-title">{title}</h1>
          </div>
        </header>
        <div className="content">{children}</div>
        <TabBar items={patientTabs} active={tab} />
      </div>
    </div>
  );
}

export type AdminSection = "users" | "audit";

const adminNav: { key: string; label: string; icon: IconName }[] = [
  { key: "org", label: "Organization", icon: "building" },
  { key: "practices", label: "Practices & locations", icon: "grid" },
  { key: "users", label: "Users & roles", icon: "people" },
  { key: "protocols", label: "Photo protocols", icon: "camera" },
  { key: "content", label: "Education content", icon: "doc" },
  { key: "consents", label: "Consent templates", icon: "signature" },
  { key: "catalog", label: "Treatment catalog", icon: "list" },
  { key: "ai", label: "AI models", icon: "sparkles" },
  { key: "integrations", label: "Integrations", icon: "layers" },
  { key: "audit", label: "Audit log", icon: "shield" },
  { key: "security", label: "Security & sessions", icon: "lock" },
];

export function AdminShell({
  section,
  title,
  description,
  actions,
  children,
}: {
  section: AdminSection;
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="app admin">
      <aside className="admin-nav" aria-label="Admin navigation">
        <div className="sidebar-brand">
          <Wordmark />
          <span className="admin-tag">Admin</span>
        </div>
        <nav>
          {adminNav.map((i) => (
            <a key={i.key} href="#admin" className={`sidebar-item${i.key === section ? " is-active" : ""}`}>
              <Icon name={i.icon} size={18} />
              <span>{i.label}</span>
            </a>
          ))}
        </nav>
      </aside>
      <div className="admin-main">
        <header className="admin-top">
          <span className="admin-org">
            <Icon name="building" size={16} /> {org.name}
          </span>
          <span className="admin-user">
            <Avatar initials="EN" size={28} tone="accent" /> Elena Novak · Practice admin
          </span>
        </header>
        <div className="admin-page">
          <div className="admin-page-head">
            <div>
              <h1 className="text-title2">{title}</h1>
              <p className="text-subheadline muted">{description}</p>
            </div>
            {actions}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
