# Architecture Decision Records

Authority order (Bible §0, §30): **Production Bible > this file > DATABASE_SCHEMA > API_CONTRACTS > SECURITY_REQUIREMENTS > DESIGN_SYSTEM > active layer prompt.**

Each ADR records one material decision. To change a locked decision, add a new ADR that supersedes it, *before* implementing the change (Bible §0 change control), and add a `CHANGELOG.md` entry.

Status values:

- **Accepted**: locked.
- **Adopted (delegated)**: the owner delegated the choice; the baseline holds unless it is re-confirmed or changed at the named layer's kickoff.
- **Superseded**: replaced by a later ADR.

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](#adr-0001) | Patient data shared within an organization, never across organizations | Accepted | 2026-09-25 |
| [0002](#adr-0002) | First-party, OIDC-compatible identity | Accepted | 2026-09-25 |
| [0003](#adr-0003) | Admin web is a React + Vite static SPA | Accepted | 2026-09-25 |
| [0004](#adr-0004) | PostgreSQL Row-Level Security with a performance gate | Accepted | 2026-09-25 |
| [0005](#adr-0005) | Minimum iOS/iPadOS 26; intuitive controls are a hard requirement | Accepted | 2026-09-25 |
| [0006](#adr-0006) | United States only | Accepted | 2026-09-25 |
| [0007](#adr-0007) | Default database naming | Accepted | 2026-09-25 |
| [0008](#adr-0008) | Technical Specification v1.0 proposals adopted | Adopted (delegated) | 2026-09-25 |
| [0009](#adr-0009) | Static design prototype before feature work | Accepted | 2026-09-25 |
| [0010](#adr-0010) | Development environment and tooling | Adopted (delegated) | 2026-09-25 |
| [0011](#adr-0011) | One design-token source for iOS and web | Adopted (delegated) | 2026-09-25 |

---

## ADR-0001

**Patient data shared within an organization, never across organizations**

- **Status:** Accepted (owner), 2026-09-25. Resolves UD-09 → D-01.
- **Context:** Bible §1.2 prohibits "cross-practice patient data sharing" without an approved feature. The owner clarified that sharing is allowed between the practices of one organization and prohibited between organizations (other customers of the software).
- **Decision:**
  - Patient records and clinical history are readable across all practices of the owning organization, by staff holding the relevant read permission.
  - Practice/location role scope limits who may *create or change* practice-owned records (consultations, appointments, procedures, photo sessions, plans).
  - The similar-case library is organization-wide.
  - Cross-organization access is impossible by construction: token-bound tenant, composite foreign keys, RLS (ADR-0004), and generated cross-tenant tests.
- **Consequences:** simpler patient search and continuity of care inside multi-practice organizations. Spec §4.6 (authorization) and §5.2 (case library) reflect this.

## ADR-0002

**First-party, OIDC-compatible identity**

- **Status:** Accepted (owner delegated the choice), 2026-09-25. Resolves UD-02 → D-02.
- **Options considered:** first-party module; Amazon Cognito; Auth0/Okta/WorkOS.
- **Decision:** identity lives in the API:
  - Argon2id passwords
  - TOTP and passkeys (WebAuthn) as second factors; MFA required for admin roles
  - 10-minute ES256 access tokens bound to the session and active organization
  - rotating, hashed refresh tokens with reuse detection
  - server-side session and device revocation

  Enterprise SSO (SAML/OIDC federation) can be added later behind an identity-provider adapter (`User.externalIdpSubject`).
- **Why:**
  - Layer 1 acceptance needs reproducible local authentication.
  - The Bible requires server-side revocation and full login audit (§21.1, §22.1).
  - There is no per-user vendor cost, and no extra BAA scope.
- **Consequences / mitigation:** security-critical code is in-house. Only vetted libraries (`jose`, `@node-rs/argon2`, `otplib`, `@simplewebauthn/server`); no custom cryptography; a threat model in Layer 0; an external penetration test before production.

## ADR-0003

**Admin web is a React + Vite static SPA**

- **Status:** Accepted (owner), 2026-09-25. Resolves UD-01 → D-03.
- **Decision:** React 19 + TypeScript + Vite, TanStack Router/Query, and a TypeScript client generated from the OpenAPI contract. Served as static assets behind CloudFront + WAF (Bible §25.3).
- **Consequences:** no server-side rendering tier handles PHI. Web styling consumes `packages/design-tokens`, the same source as iOS.

## ADR-0004

**PostgreSQL Row-Level Security with a performance gate**

- **Status:** Accepted (owner: "as long as it doesn't slow things down noticeably"), 2026-09-25. Resolves UD-03 → D-04.
- **Decision:**
  - RLS policies on every tenant-owned table, keyed on `SET LOCAL app.organization_id` inside the per-request transaction.
  - The application DB role lacks `BYPASSRLS`; migrations run as a separate owner role.
- **Performance gate (defines "noticeably"):** the Layer 1 benchmark must show ≤ 10% added p95 latency and ≤ 5 ms absolute on login, patient search and patient open. If it doesn't, the policy design is revised (e.g. simpler predicates, index changes) before Layer 1 ships. RLS is not silently dropped.
- **Consequences:** a second, independent isolation net beneath application checks and composite foreign keys.

## ADR-0005

**Minimum iOS/iPadOS 26; intuitive controls are a hard requirement**

- **Status:** Accepted (owner), 2026-09-25. Resolves UD-12 → D-05.
- **Decision:**
  - Deployment target iOS/iPadOS 26 for both apps.
  - iPad landscape is the primary provider layout, iPhone fully supported (Bible §24.1).
  - The owner's requirement that controls be intuitive is binding: see `DESIGN_SYSTEM.md` §2 "Intuitive controls: the rules" (native controls, 44-pt minimum targets, one obvious primary action per screen, no hidden gestures for critical actions, confirmation for irreversible actions).
- **Consequences:** the latest SwiftUI, Vision and camera APIs are available. The design prototype validates layouts before feature work.

## ADR-0006

**United States only**

- **Status:** Accepted (owner), 2026-09-25. Resolves UD-13 → D-06.
- **Decision:** HIPAA posture; US English; USD; US time zones; NPI for providers; US phone and address formats; a single AWS region (us-east-1), multi-AZ. Locale and region stay configurable in code, but no non-US deployment is planned.

## ADR-0007

**Default database naming**

- **Status:** Accepted (owner), 2026-09-25. Resolves UD-26 → D-07.
- **Decision:** physical names equal the Prisma names (PascalCase tables, camelCase columns); no `@@map`/`@map`.

## ADR-0008

**Technical Specification v1.0 proposals adopted**

- **Status:** Adopted (delegated), 2026-09-25. The owner delegated the remaining choices ("choose what you feel is best").
- **Decision:** every item tagged **[P]** in `TECHNICAL_SPECIFICATION.md` §§2–8, and every "adopted by delegation" baseline in §10.2, is the working architecture. Layer kickoffs re-confirm the items listed for them.
- **Key items:**
  - Toolchain (§2)
  - Composite tenant foreign keys and database immutability triggers (§5)
  - Transactional outbox (§3)
  - Separate patient-portal API (§6.5)
  - Separation-of-duties rules (§4.5)
  - Per-layer table rollout (§5.8)
  - Audit tamper resistance (§7.3)
  - Offline rules (§8)

## ADR-0009

**Static design prototype before feature work**

- **Status:** Accepted (owner request), 2026-09-25.
- **Context:**
  - The owner asked for a front-end mock-up with hard-coded data, to check the interface before feature-by-feature work.
  - The Bible forbids a *mock application* that bypasses authorization, persistence, audit or validation (§0.1). §31 warns against *beginning* with disconnected mock screens.
- **Decision:**
  - `apps/design-prototype` is a clearly labelled **design prototype**: React + Vite, static layouts and styling for the core scenes on iPad, iPhone, the patient app and admin web, using fixtures only.
  - It has no backend, no authentication and no persistence, is never deployed as the product, and is excluded from production builds.
  - It comes *after* the locked architecture, not instead of it.
  - Product UIs are built layer by layer in `apps/ios-*` and `apps/admin-web` with real authorization, using the same tokens and component patterns.
- **Consequences:** layout and interaction problems surface before feature work. The prototype stays a reference; it isn't a code base to extend.

## ADR-0010

**Development environment and tooling**

- **Status:** Adopted (delegated), 2026-09-25.
- **Decision:**
  - **Runtime and packages:** Node.js 24 LTS (pinned in `.nvmrc`); pnpm 12 via corepack (`packageManager` field); Turborepo; TypeScript 6.0; Vitest.
  - **Lint and format:** Biome, one fast tool instead of ESLint + Prettier.
  - **Local services:** `docker compose`, starting with PostgreSQL 18. Services are added by the layer that first needs them, so no service is configured before it can be exercised.
  - **Cloud IDE:** GitHub Codespaces / Dev Containers (`.devcontainer/`).
  - **Claude Code on the web:** a SessionStart hook installs the pinned Node (checksum-verified), pnpm and dependencies.
  - **CI:** GitHub Actions runs lint, typecheck, tests, build, token drift, Bible → spec traceability, and schema + DB behaviour on PostgreSQL 18.
  - **Agent guardrails:** `CLAUDE.md` carries the Bible §30 constitution.
- **Consequences:** a fresh clone is ready with one command locally, in Codespaces and in Claude Code on the web.

## ADR-0011

**One design-token source for iOS and web**

- **Status:** Adopted (delegated), 2026-09-25.
- **Decision:**
  - `packages/design-tokens/tokens.json` compiles to CSS variables, TypeScript and Swift (`DSColor`, `DSFont`, …).
  - Type styles mirror iOS Dynamic Type text styles.
  - Every colour pair used for text must pass WCAG 4.5:1, and every UI pair 3:1, in light and dark mode; this is enforced by tests in CI.
- **Consequences:** iPhone, iPad and web stay visually identical by construction, and accessibility regressions fail the build.
