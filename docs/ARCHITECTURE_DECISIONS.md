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
| [0012](#adr-0012) | Layer 0 documentation pack: the spec stays normative | Adopted (delegated) | 2026-09-28 |
| [0013](#adr-0013) | API contract tooling and forward-compatible error codes | Adopted (delegated) | 2026-09-28 |
| [0014](#adr-0014) | AWS infrastructure baseline | Adopted (delegated) | 2026-09-28 |
| [0015](#adr-0015) | iOS module architecture and project generation | Adopted (delegated) | 2026-09-28 |
| [0016](#adr-0016) | CI supply-chain and security gates | Adopted (delegated) | 2026-09-28 |
| [0017](#adr-0017) | Layer 0 errata to the locked specification | Accepted | 2026-09-28 |
| [0018](#adr-0018) | Layer 1 kickoff decisions | Accepted | 2026-09-29 |
| [0019](#adr-0019) | Layer 1 database foundation: generated schema, roles, Row-Level Security, catalog | Adopted (delegated) | 2026-09-29 |
| [0020](#adr-0020) | Patient search under Row-Level Security: leakproof search keys (UD-35) | Accepted | 2026-10-01 |
| [0021](#adr-0021) | Layer 1 API implementation decisions | Adopted (delegated) | 2026-10-01 |
| [0022](#adr-0022) | Layer 1 clients: iOS provider shell and admin web portal | Adopted (delegated) | 2026-10-01 |
| [0023](#adr-0023) | Layer 2 kickoff decisions | Accepted | 2026-10-01 |
| [0024](#adr-0024) | Layer 2 backend implementation decisions | Adopted (delegated) | 2026-10-01 |
| [0025](#adr-0025) | Layer 2 provider app implementation decisions | Adopted (delegated) | 2026-10-01 |
| [0026](#adr-0026) | Layer 3 kickoff decisions | Accepted | 2026-10-04 |
| [0027](#adr-0027) | Layer 3 backend implementation decisions | Adopted (delegated) | 2026-10-04 |

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
  - **Amended 2026-10-01 (ADR-0023 K2-08):** the local AWS emulator is **moto**, not LocalStack. LocalStack now exits at start without an account auth token. moto (Apache-2.0) emulates S3, SQS, EventBridge and KMS, runs from its Docker image in `docker-compose.yml`, and runs from `pip` where there is no Docker (the macOS CI runner).
- **Consequences:** a fresh clone is ready with one command locally, in Codespaces and in Claude Code on the web.

## ADR-0011

**One design-token source for iOS and web**

- **Status:** Adopted (delegated), 2026-09-25.
- **Decision:**
  - `packages/design-tokens/tokens.json` compiles to CSS variables, TypeScript and Swift (`DSColor`, `DSFont`, …).
  - Type styles mirror iOS Dynamic Type text styles.
  - Every colour pair used for text must pass WCAG 4.5:1, and every UI pair 3:1, in light and dark mode; this is enforced by tests in CI.
- **Consequences:** iPhone, iPad and web stay visually identical by construction, and accessibility regressions fail the build.

## ADR-0012

**Layer 0 documentation pack: the spec stays normative**

- **Status:** Adopted (delegated), 2026-09-28.
- **Context:** Bible §31 and §35 require about 27 named documents. Much of their normative content (entity catalog, state machines, permission matrix, endpoint and error catalogs, audit events) already lives in the locked `TECHNICAL_SPECIFICATION.md`, which the traceability checker verifies.
- **Decision:**
  - `TECHNICAL_SPECIFICATION.md`, `schema.prisma` and `constraints.sql` stay the single normative home for those catalogs.
  - Each pack document explains its topic, adds what the spec lacks (diagrams, threat model, flows, operations, test strategy) and **links** to the spec instead of copying catalogs.
  - `SOFTWARE_PRODUCTION_BIBLE.md` is generated verbatim from the PDF by `export_bible.py`. The PDF stays authoritative.
  - `check_docs.py` in CI enforces:
    - the pack is complete
    - every `spec §` and Bible `§` reference resolves
    - every relative link and anchor resolves
    - no placeholder markers remain
- **Consequences:** no two copies of a rule can drift apart. Readers may need two documents open (the topic document and the spec section it links).

## ADR-0013

**API contract tooling and forward-compatible error codes**

- **Status:** Adopted (delegated), 2026-09-28. Implements spec §6.8.
- **Decision:**
  - Zod 4.6.5 with `@asteasolutions/zod-to-openapi` 9.1.0 generates `openapi.json` (OpenAPI 3.1), which is committed. Schemas import `z` from `src/zod.ts`, which extends Zod once.
  - Layer 0 registers only the shared primitives: value formats, error envelope, pagination, headers and reusable error responses. Paths arrive with Layer 1.
  - Error codes are typed as an UPPER_SNAKE **string**, not a closed enum, and clients fall back to the HTTP status for codes they do not know. The catalog grows within v1 (spec §6.1.1), and a closed enum would turn every new code into a breaking change for the iOS decoder.
  - CI gates: the committed document must equal a fresh render, and `oasdiff` v1.32.1 `breaking --fail-on ERR` runs against the base branch.
- **Consequences:** contract changes are visible in review as `openapi.json` diffs. Breaking changes need `/api/v2`.

## ADR-0014

**AWS infrastructure baseline**

- **Status:** Adopted (delegated), 2026-09-28. Details in `INFRASTRUCTURE.md`.
- **Decision:**
  - **Pins:** Terraform 1.16.4 with the AWS provider pinned exactly to 6.66.0, with committed lock files.
  - **Accounts and state:** one AWS account per environment, guarded by `allowed_account_ids`. Remote state lives in a versioned, KMS-encrypted S3 bucket with S3 lock files (no DynamoDB table), created by a bootstrap root.
  - **Keys:** customer-managed KMS keys per purpose (data, media, logs) with yearly rotation.
  - **Account baseline in every environment:** account-level S3 public-access block, EBS encryption by default, multi-region CloudTrail with log-file validation delivered to an Object Lock bucket (compliance mode in staging and production, governance mode in dev), GuardDuty, IAM Access Analyzer, and one access-log bucket. Delivery to a separate security account (spec §7.1) waits for the AWS account structure (Layer 1 kickoff). That bucket uses SSE-S3 because S3 server access logging cannot deliver to SSE-KMS buckets.
  - **Network:** VPC with public, private and isolated subnets across pinned zones; NAT per zone except in dev.
  - **Database:** RDS PostgreSQL 18 in the isolated subnets. TLS is forced, the password is managed by Secrets Manager, statement text is never logged, backups are kept 35 days and deletion protection is on. Multi-AZ in staging and production; dev is single-AZ on synthetic data.
  - **Clinical-media bucket:** versioned, SSE-KMS with its key enforced, TLS-only, and `DeleteObject`/`DeleteObjectVersion` denied to every principal until a retention role is approved (UD-24).
  - **Static checks:** `terraform validate`, tflint (with the AWS ruleset) and checkov. Every checkov suppression is inline with its reason.
  - **Deferred:** services, load balancer, WAF, queues and cross-region backups arrive with the layer that first needs them.
- **Consequences:** every later layer builds on a reviewed and checked baseline. Nothing is applied until account IDs, the BAA and CI-to-AWS authentication are decided (Layer 1 kickoff).

## ADR-0015

**iOS module architecture and project generation**

- **Status:** Adopted (delegated), 2026-09-28. Details in `IOS_ARCHITECTURE.md`.
- **Decision:**
  - **Modules:** the 20 Bible §24.4 modules are local Swift packages under `apps/ios-provider/Modules` (spec §2.2), each on Swift tools 6.2 with iOS 26 as the platform.
  - **Tiers:** foundation → platform → domain → feature → app. Dependencies point only downward, with same-tier dependencies allowed in foundation and domain. Feature modules never depend on each other. The graph must be acyclic.
  - **Enforcement:** `modules.json` records each module's tier and allowed dependencies. `check_module_graph.py` enforces it on Linux CI, with no Swift toolchain needed.
  - **Patient app:** reuses only DesignSystem, CoreNetworking and CoreSecurity.
  - **Project generation:** Tuist 4.209.0 (pinned in `mise.toml`) generates the Xcode projects, which are never committed. CI builds on macOS 26 with Xcode 26.6.
  - **Tokens:** DesignSystem compiles a generated copy of `DesignTokens.swift`, and CI fails if it drifts from the token package.
  - **Layer 0 scope:** no remote Swift packages. The generated API client (swift-openapi-generator) and GRDB + SQLCipher arrive with the first code that uses them.
- **Consequences:** architecture rules are enforced mechanically from day one. Modules other than DesignSystem and AppShell hold only their documented boundary until their layer.

## ADR-0016

**CI supply-chain and security gates**

- **Status:** Adopted (delegated), 2026-09-28. Implements the Bible §28.2 "dependency/security scanning" gate with the tools named in spec §2.3.
- **Decision:**
  - OSV-Scanner v2.6.0 scans `pnpm-lock.yaml` on every push (`security` job, Go 1.27.1).
  - Dependabot opens weekly update pull requests for npm, GitHub Actions and Terraform.
  - Container scanning with Trivy joins when the first image exists (Layer 1).
  - GitHub's native secret scanning covers the public repository. The choice of a dedicated secret scanner, SAST, and pinning third-party actions to commit SHAs are decided at the Layer 1 kickoff.
- **Consequences:** known-vulnerable dependencies fail the build before they reach any environment.

## ADR-0017

**Layer 0 errata to the locked specification**

- **Status:** Accepted, 2026-09-28. Change control for the locked spec (Bible §0): these corrections remove contradictions and change no owner decision.
- **Decision:**
  - **`schema.prisma`:** removed `SimulationParameter.unit`, which contradicted spec §6.6.3 ("no … unit … fields, by construction") and Bible §9.6. A new traceability check keeps any dose, unit, product or technique field out of that model.
  - **Spec §5.3** ER diagram: the photo session link and the photo↔storage-object cardinalities now match the schema.
  - **Spec §1.5** now states the D-01 boundary ("no patient data sharing across organizations") instead of the unqualified "no cross-practice sharing".
  - **Spec §6.1.1** points to §6.8 for contract tooling, not §6.7.
  - **Spec §2.1** no longer calls APNs an AWS service.
  - **Spec §7.5:** the no-enumeration 404 comparison ignores only the per-request `requestId`.
  - **Spec §7.6 context and §11:** the database suite runs on PostgreSQL 18 in CI, and the V7 `MATCH SIMPLE` audit is automated in the behaviour suite, bringing it to 90 checks.
  - **Spec §10.4:** three risks added: human production access, supply chain, malicious image files.
  - **Spec §10.2:** UD-34 added (Apple team and bundle identifier prefix).
  - **Schema comments:** stale remarks corrected (UD-02, UD-13, protocol seeding, how tables move into `packages/database`).
  - **`DESIGN_SYSTEM.md` C13:** exiting signing mode is described as staff re-authentication (UD-31), with Face ID or Touch ID as the means, matching the spec.
  - **Roadmap M1.3** includes passkeys, matching spec §6.3.
- **Consequences:** the locked baseline is internally consistent on these points. Every other Layer 0 finding is carried to the kickoff of the layer that needs it (`ACCEPTANCE_CRITERIA.md` §5).

## ADR-0018

**Layer 1 kickoff decisions**

- **Status:** Accepted, 2026-09-29. The owner confirmed every recommendation in [`LAYER_1_KICKOFF.md`](LAYER_1_KICKOFF.md) ("adopt all") and chose to include the admin web shell in Layer 1. The spec is corrected to match before any Layer 1 code (Bible §0).
- **Context:** the roadmap requires the Layer 1 decisions to be confirmed, and the Layer 0 findings carried to Layer 1 (F-13 to F-33, F-59) to be resolved, before implementation.
- **Decision:** K-01 to K-24 as written in `LAYER_1_KICKOFF.md` §2:
  - **Roles and permissions:**
    - K-01: seed the complete permission catalog and role matrix in M1.1. Layer 1 enforces the 13 Bible §32 keys plus `organization.read`, `organization.manage`, `security.manage` and `configuration.manage`.
    - K-02: system roles only.
    - K-05: separation-of-duties rule 2 covers clinical consent actions only, and an audited platform bootstrap creates an organization's first admin.
    - K-06: platform permissions reach organization metadata only, never patient data.
    - K-07: a practice admin manages only users entirely inside its practice scope.
    - K-08: every Layer 1 model is classified as organization-owned or practice-owned in M1.1.
  - **Sessions and credentials:**
    - K-03: MFA is always required for admin roles and the admin web; the strictest membership policy applies at sign-in.
    - K-09: tokens travel in request bodies.
    - K-11: no PKCE; the admin web keeps its refresh token in an `HttpOnly` `SameSite=Strict` cookie, with an `Origin` check.
    - K-12: session revocation is scoped per organization.
    - K-13: unknown-identifier failures are recorded in `LoginEvent` only.
    - K-15: NIST SP 800-63B passwords, progressive lockout, a 30-minute single-use reset, a password-change endpoint, admin MFA reset, and `MFA_REQUIRED` recorded as a step.
    - K-22: Keychain `WhenPasscodeSetThisDeviceOnly` with `.biometryCurrentSet` and no passcode fallback.
  - **Audit:**
    - K-04: two new actions, `SECURITY_CREDENTIAL_CHANGED` and `ORGANIZATION_SWITCHED`.
    - K-10: `ACCESS_DENIED` on routes that touch patient data, with identical repeats collapsed.
    - K-18: no WORM copy until the Layer 2 outbox.
  - **Platform and data:**
    - K-14: transactional email through Amazon SES, with Mailpit locally.
    - K-16: the Row-Level Security design and its performance gate in M1.1.
    - K-17: patient creation is online-only.
    - K-19: the database suite is split per layer.
    - K-20: patient status changes go through update, except archiving.
    - K-21: CodeQL, gitleaks, SHA-pinned actions and Trivy.
  - **Scope:**
    - K-23: a minimal admin web shell (M1.11) is included in Layer 1.
    - K-24: F-20 is deferred to Layer 5.
  - **Delegated baselines re-confirmed unchanged:** UD-24 (no automated deletion without a customer policy; nothing is deleted automatically in Layer 1) and UD-27 (WAF plus database-backed lockout in Layer 1; a shared counter store only when more than one api task runs).
- **Spec and schema changes made under this ADR:**
  - **Spec §3.5** records the RLS design (K-06, K-16).
  - **Spec §4.2** records:
    - the client token handling (K-11) and the Keychain settings (K-22)
    - the MFA rule (K-03) and a new "Passwords and recovery" row (K-15)
    - scoped revocation (K-12), the organization-switch audit (K-04) and the login-audit rules (K-13, K-15)
  - **Spec §4.5** rewrites separation-of-duties rules 2 and 3 (K-05, K-07).
  - **Spec §4.6** records platform reach (K-06), user management scope (K-07) and `ACCESS_DENIED` collapsing (K-10).
  - **Spec §5.4.10** adds the patient status rule (K-20).
  - **Spec §6.1.8** makes patient creation online-only (K-17). **Spec §6.1.10** adds the no-secrets-in-URLs rule (K-09).
  - **Spec §6.3** adds four endpoints that the confirmed decisions require:
    - `POST /auth/password/change` (K-15)
    - `POST /auth/invitations/accept`, the staff invitation that K-09 and K-14 imply
    - `POST /users/{id}/mfa-reset` (K-15). An organization admin may reset only a user whose sole active membership is in that organization, because credentials are platform-level (K-06, K-12).
    - `POST /organizations/{id}/admin-bootstrap` (K-05)

    It also adds the new audit events to the existing rows.
  - **Spec §6.4** lists the confirmed Layer 1 permissions and events. **Spec §6.5** moves the patient invitation token into the body (K-09).
  - **Spec §7.3** adds the two actions and states the Layer 1 audit tamper-resistance (K-04, K-10, K-18).
  - **Schema:**
    - new supporting table `UserToken` (spec §5.2, §5.8), with its `constraints.sql` rules, holding hashed, single-use, expiring invitation, reset and sign-in challenge tokens (K-09, K-15)
    - `LoginEventType` gains `MFA_CHALLENGE_ISSUED`, and `LoginFailureReason` loses `MFA_REQUIRED`, because K-15 makes the challenge a step, not a failure
    - `AuditAction` gains the two K-04 actions
- **Consequences:**
  - The design schema has 88 tables. Layer 1 creates 21 of them.
  - Findings F-13 to F-31 are resolved or scheduled into a Layer 1 micro-prompt, with F-20 deferred to Layer 5 (`ACCEPTANCE_CRITERIA.md` §5.2). F-32, F-33 and F-59 are owner inputs that do not block Layer 1; K-21 and K-22 resolve their repository-side parts.
  - M1.1 can start.

## ADR-0019

**Layer 1 database foundation: generated schema, roles, Row-Level Security, catalog**

- **Status:** Adopted (delegated), 2026-09-29. Implementation choices inside ADR-0004 and ADR-0018 K-01, K-06, K-08, K-16, K-18 and K-19 (roadmap M1.1). The RLS performance result is not decided here; it is UD-35 and waits for the owner.
- **Decision:**
  - **One source for tables.** `packages/database/prisma/schema.prisma` is generated from `docs/technical-spec/schema.prisma` by `scripts/promote-schema.ts`. It copies the models of the built layers (spec §5.8) verbatim and drops only relations to later layers. Each layer's constraint migration carries that layer's `constraints.sql` fragment verbatim. CI fails on any difference, and on any Prisma drift between migrations and schema.
  - **Migrations per layer:** tables, constraints, security, and for Layer 1 the catalog. They are applied by a migration user with `CREATEROLE`, never a superuser; CI proves this.
  - **Database roles:** `aestara_app`, `aestara_platform` and `aestara_signin`. All three are `NOLOGIN`, not superusers, and not `BYPASSRLS`. Login users are per environment and outside migrations. The platform role has no grant on patient, profile or settings tables, and sees only status columns of credentials.
  - **Tenant context:** `set_config('app.organization_id', …, true)` in every request or job transaction, read by `app_current_organization_id()`. Unset matches nothing; malformed fails.
  - **Policies:**
    - Tenant tables are forced and match `organizationId` to the tenant.
    - Audit reads are tenant-only for the application and platform-level-only for the platform role.
    - Idempotency keys are visible only under the tenant they were stored with.
    - `Role` has RLS without `FORCE`.
    - Identity and catalog tables are platform-level and have no RLS.
  - **Sign-in lookup:** `auth_sign_in_memberships`, a plpgsql `SECURITY DEFINER` function owned by `aestara_signin` and executable only by the application role.
  - **Rule 2 in the database:** a trigger rejects a platform-role grant of any role with clinical permissions (SQLSTATE `AE002`, spec §4.5 rule 2).
  - **Catalog as data:** `src/catalog.ts` defines the 53 permissions, 10 system roles and 139 default grants. A test compares them cell by cell with spec §4.4–§4.5. Identifiers are deterministic UUIDv7 values.
  - **Ownership classification:** `src/ownership.ts` classifies every table. `scripts/check-rls.ts` compares it with the live database's RLS, roles and grants.
  - **Behaviour suite:** split into per-layer fragments. `packages/database` runs the built layers' fragments plus an RLS suite against its migrations.
  - **Shared enums:** `packages/shared-types` generates enum values from the Prisma schema.
  - **Local seed:** synthetic data only; refuses non-local databases.
- **Consequences:**
  - A later layer promotes its tables by raising one constant and adds its own constraints and security migrations. Tables without a classification, a policy or a matching fragment fail CI.
  - The benchmark shows that non-leakproof search predicates cannot use indexes under RLS (UD-35). Layer 1 does not go past M1.1 until the owner decides.

## ADR-0020

**Patient search under Row-Level Security: leakproof search keys (UD-35)**

- **Status:** Accepted, 2026-10-01. The owner chose "the most secure option that supports the narrative of the project", which "must be efficient for the client". The owner also decided that the ADR-0004 gate for requests without a scaling problem is judged end to end in M1.8.
- **Context:** the M1.1 benchmark (ADR-0019) showed that the specified name search cannot use its trigram index under RLS. `LIKE`, `lower()` and the trigram operators are not leakproof, so PostgreSQL may not evaluate them in an index condition ahead of the tenant policy. It scans every patient of the organization: +3.5 to 3.7 ms p95 at 5,000 patients per organization, growing with size. The measured alternatives were:
  - a tenant-bound `SECURITY DEFINER` search function: fast and fuzzy, but it bypasses RLS for its query and amends K-16
  - leakproof prefix search: no bypass
  - accepting the scan
  - dropping RLS
- **Decision:**
  - **No query on patient data bypasses Row-Level Security.** K-16 stands unchanged: the sign-in lookup is the only `SECURITY DEFINER` function.
  - **Search keys:** `Patient` gains `firstNameKey`, `lastNameKey`, `preferredNameKey`, `emailKey` and `phoneKey`. A database trigger maintains them on every insert and update; the application never writes them.
    - Name keys are lower-case, accent-free and alphanumeric only, so "José O'Brien" becomes `jose` and `obrien`.
    - The email key is the trimmed, lower-cased address.
    - The phone key holds the digits only.
  - **Indexes:** B-tree indexes on `(organizationId, key)`, declared in `schema.prisma`, replace the trigram indexes. Name keys hold only `a-z` and `0-9`, whose order is the same in every collation, so a name prefix is the range `key >= k AND key < k′`, where k′ is k with its last character advanced. Ordinary text comparison is leakproof.
  - **Search:** `POST /patients/search` matches:
    - a **prefix** of the last, first or preferred name
    - the exact date of birth
    - the exact MRN
    - the exact email
    - the exact phone digits

    Search uses only leakproof operators on the keys, so every index stays usable under the tenant policy. Its time does not grow with the size of the organization.
  - **Probable duplicates (Bible §4.1):** `POST /patients/duplicate-check` keeps tolerant matching. It narrows candidates with leakproof, indexed predicates (date of birth, email, phone), then compares names within that small set (M1.8).
  - **Extensions:** `pg_trgm` and `btree_gin` are removed from Layer 1; nothing else used them. `unaccent` (a trusted extension) is added.
  - **Gate:** the per-statement cost of RLS (about 0.03 ms per statement plus the tenant setting) is judged end to end at M1.8, for every core request. In M1.1 the RLS suite proves deterministically that a name search uses its index under the tenant policy.
- **Consequences:**
  - Staff search by the start of a name, or by an exact identifier. Typo-tolerant search is not offered; duplicate detection still catches near-matches before a patient is created.
  - Because nothing has been applied to a shared environment, the Layer 1 migrations are amended in place rather than followed by a corrective migration.
  - Spec §2.1, §5.2, §5.6 and §6.3 are corrected. UD-35 is closed.

## ADR-0021

**Layer 1 API implementation decisions**

- **Status:** Adopted (delegated), 2026-10-01. These settle the points that `AUTHENTICATION_ARCHITECTURE.md`, `AUTHORIZATION_RBAC.md` and the spec leave to micro-prompts M1.2 to M1.8, inside ADR-0002, ADR-0004, ADR-0018 and ADR-0020. The owner asked for Layer 1 to be completed before Layer 2.
- **Decision, build and test:**
  - **Runtime:** `services/api` is NestJS 12 on Fastify 5, ES modules, Node 24.
    - Bundling: rolldown, with legacy decorators and emitted decorator metadata.
    - Tests: Vitest 5, whose oxc transformer supports the same.
    - Type-checking: `tsc`.
  - **Test database:** API tests run against a real PostgreSQL.
    - Each test file builds a fresh database from the migrations through a superuser URL (`TEST_ADMIN_DATABASE_URL`) and connects as login users of `aestara_app` and `aestara_platform`.
    - CI provides PostgreSQL 18 as a service container.
    - Testcontainers (spec §2.3) is not used: this repository's CI and cloud sessions have no Docker daemon. The rule it served, a real database and never mocks for authorization, holds.
- **Decision, tokens and keys:**
  - **Access token:** an ES256 JWT with issuer `aestara-api` and audience `aestara`. It carries `sub`, `sid`, `org` (absent when no organization is selected), `app`, `amr` and `kid`, and lasts 10 minutes.
    - Signing: a KMS asymmetric key in AWS; a PEM key from configuration locally and in tests. Both sit behind one signer interface.
    - Public keys are published at `GET /api/v1/.well-known/jwks.json`.
  - **Refresh token:** `<sessionId>.<generation>.<HMAC-SHA256(server refresh key, sessionId.generation)>`.
    - A valid MAC proves the server issued that generation, so presenting an older generation is provable reuse: the session is revoked as `REFRESH_TOKEN_REUSE`.
    - A token with a bad MAC is simply rejected, so a forged token cannot revoke anyone's session.
    - `Session.refreshTokenHash` stores the SHA-256 of the current token.
    - There is no grace window: clients serialize refreshes.
  - **Admin web refresh:**
    - The refresh token lives only in the cookie `aestara_rt`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth/token/refresh`.
    - A cookie refresh needs an allow-listed `Origin`. The response body never carries the token for `ADMIN_WEB`.
  - **Second factors:**
    - TOTP: RFC 6238, SHA-1, 6 digits, 30 s, ±1 step. The seed is sealed with KMS in AWS and AES-256-GCM with a configured key locally. A code's time step can be used only once: `UserCredential.lastUsedAt` records the start of the last accepted step.
    - Passkeys: `@simplewebauthn/server`. Relying-party ID and origins come from configuration.
  - **Factor confirmation:** a new column `UserCredential.confirmedAt`. A TOTP or passkey counts as a factor only once confirmed, by a valid code or a verified registration.
    - The enrollment endpoint gains a confirmation step: `POST /auth/mfa/enrollments/{id}/confirm`.
    - A user who must use MFA but has no confirmed factor receives `MFA_REQUIRED` with `enrollmentRequired`. They enroll TOTP using the sign-in challenge, then complete sign-in with `POST /auth/mfa/verify`.
  - **Challenges:**
    - The sign-in MFA challenge expires in 5 minutes and allows 5 attempts.
    - Step-up means `mfaVerifiedAt` within the last 15 minutes. A user with no confirmed factor can also meet it with a session created in the last 15 minutes. Otherwise the API answers `403 REAUTHENTICATION_REQUIRED` and the client signs in again.
- **Decision, accounts:**
  - **Lockout:**
    - **Keying:** keyed on an HMAC of the normalized identifier, so known and unknown identifiers behave identically.
    - **What counts:** `INVALID_CREDENTIALS` and `MFA_FAILED` failures from the last 24 hours, since the later of the last success and the current password.
    - **Lock periods:** 5 failures lock for 15 minutes, and each further 5 doubles the lock, up to 24 hours.
    - **Response:** while locked, sign-in answers `429 RATE_LIMITED` with `Retry-After`, without checking the password. The attempt is ledgered as `ACCOUNT_LOCKED`.
    - **Status and unlock:** lockout never sets `User.status`. It ends when it expires or on a password reset.
  - **Password reset:**
    - It does not require the second factor, because the next sign-in still does.
    - A forgot-password request answers `202` identically for every input. At most one reset email per account per minute.
  - **Password change:** ends the user's other sessions (`CREDENTIAL_CHANGED`) and keeps the current one.
  - **Email verification:** accepting an invitation, whose token arrives by email, sets `User.emailVerifiedAt`. There is no separate verification flow in Layer 1.
  - **Email links:** invitation and reset emails link to the admin web with the token in the URL fragment (`#token=…`). Fragments never reach a server or a log, and the page posts the token in the request body (K-09).
  - **Platform operators:** their sessions have no organization and use the admin web lifetimes.
  - **Choosing an organization at sign-in:**
    - With exactly one active membership, the session binds to it.
    - With several, the login body may name one of them; otherwise the session starts without an organization and the client calls `PUT /auth/session/organization`.
    - Switching re-applies the target organization's MFA rule: if it requires MFA and the session has none, the switch answers `403 REAUTHENTICATION_REQUIRED`.
  - **Invitations:**
    - The staff invitation token lasts 72 hours.
    - An administrator MFA reset requires the administrator to state how the requester's identity was verified (`IN_PERSON`, `VIDEO_CALL` or `KNOWN_CALLBACK`). The method is audited, and the revoked sessions use `CREDENTIAL_CHANGED`.
  - **Password list:** passwords are checked against a bundled list of common passwords (SecLists, MIT licence), with no external call.
- **Decision, API behaviour:**
  - **Tenant transactions:** every tenant request runs in one Prisma interactive transaction on the `aestara_app` connection.
    - Its first statement is `set_config('app.organization_id', …, true)`.
    - Platform routes use a separate `aestara_platform` connection.
    - Every Prisma query on a tenant table inside a tenant transaction also carries `organizationId = <tenant>`, and every create must name the tenant (spec §4.6 "load resource WITH organizationId = org"). The api therefore isolates tenants even with RLS bypassed, and RLS isolates them even if this filter were missing; a test proves the first with a `BYPASSRLS` login.
    - Sign-in uses the application connection without a tenant, plus `auth_sign_in_memberships`.
  - **Permissions:** `@RequirePermission(key)` on each route.
    - The guard reads the caller's grants in the organization (or platform grants on platform routes) inside the request transaction.
    - Services enforce practice and location scope on practice-owned writes (spec §4.6) and separation-of-duties rule 3 on user management.
    - A new error code, `403 SEPARATION_OF_DUTIES`, reports a rule 1–3 violation.
  - **`ACCESS_DENIED`:** written for denials on patient routes. Identical denials from one actor on one route within 60 seconds are suppressed in memory. The next written event carries `metadata.suppressedRepeats`.
  - **Cursors:** cursor pagination uses an HMAC-signed cursor holding the last sort key and ID, valid 24 hours.
  - **Idempotency:** `Idempotency-Key` records the SHA-256 of the method, route template and canonical body, and replays the stored outcome reference (spec §6.1.8).
- **Decision, settings registered in code (`OrganizationSetting`, spec §5.2):**
  - `security.mfaPolicy`: `ADMINS_ONLY` (default) or `ALL_STAFF`. Admin roles and the admin web always need MFA either way.
  - `security.sessionPolicy`: idle and absolute lifetimes per client, defaulting to spec §4.2.
  - `patients.primaryPracticeRequired`: default `false`.
  - Automatic MRN assignment is not specified, so Layer 1 accepts an MRN from staff and keeps it unique per organization.
- **Decision, contracts (recorded with the Layer 1 contracts, before their implementation):**
  - **Endpoint registry:** `packages/api-contracts/src/endpoints.ts` lists every Layer 1 operation with its permission, scope, step-up, idempotency, If-Match, not-found code and audit actions. It generates the OpenAPI paths, and the api checks at start-up that its routes equal the registry.
  - **Platform reach (K-06):** platform-scope grants work only on `GET/POST /organizations`, `GET/PATCH /organizations/{id}`, `POST /organizations/{id}/admin-bootstrap`, `POST /users/{id}/sessions/revoke`, `POST /users/{id}/mfa-reset`, `GET /roles`, `GET /permissions` and `GET /audit/events` (platform-level events only). Every other route needs an organization in the session.
  - **If-Match:** required on every `PATCH` (organizations, practices, locations, users, patients, contacts), on patient archive and on settings. Create-or-replace profile `PUT`s need it once the profile exists. A setting still at its default has ETag `"v0"`.
  - **Account edits:** `PATCH /users/{id}` changes the person's platform-level account, so an organization may make it only when the person belongs to no other organization (as for the MFA reset); otherwise `403 PERMISSION_DENIED`.
  - **Session policy:** organizations may shorten the spec §4.2 lifetimes, never extend them.
  - **Probable duplicates:** a candidate shares the email, the phone or the MRN, or shares the date of birth and has a similar first or last name (same search key, one key a prefix of the other, or an edit distance of at most 1 per 4 characters, minimum 1). At most 10 candidates. The 409 body carries only IDs and match reasons; the duplicate-check response adds a summary when the caller holds `patient.read`.
  - **Name search:** one word matches the start of the last, first or preferred name. Two or more words match a first (or preferred) name prefix plus a last-name prefix, in either order. Patient search is limited to 60 requests per user per minute (`429 RATE_LIMITED`).
  - **Profile tabs:** `GET /patients/{id}` returns the twelve tabs with `readable` from the tab's read permission in spec §6.3. Counts appear once each domain's layer is built.
- **Consequences:**
  - Spec §6.2 gains `SEPARATION_OF_DUTIES`; spec §6.3 gains the enrollment confirmation endpoint and the `GET /.well-known/jwks.json` path under `/api/v1`. `UserCredential.confirmedAt` is added by a new migration.
  - The open items in `AUTHENTICATION_ARCHITECTURE.md` §14 for M1.3 and M1.6 are closed.
  - The factor-confirmation migration also grants the platform role `SELECT ("confirmedAt")` on `UserCredential` (the step-up check before an MFA reset) and `UPDATE ("consumedAt")` on `UserToken` (a re-invitation supersedes the earlier one).
  - **Slow work outside transactions:** sign-in reads the credential and lock state in one short transaction, checks the password (Argon2id) outside it, then records the outcome in a second transaction that refuses the attempt if the credential changed in between. A saturated database (Prisma cannot start an interactive transaction in time) answers `503 SERVICE_UNAVAILABLE` with `Retry-After`, never 500; every operation documents 503.
  - **RLS gate, end to end (M1.8):** CI runs login, patient search and patient open through the whole api, as the application role and as an identical role with `BYPASSRLS`, 3,000 alternating rounds each (login 600), and fails if any adds more than 10% or 5 ms p95. A p95 rests on the slowest 5% of samples; with 1,000 rounds, write-path tail spikes (patient open writes `PATIENT_VIEWED`) moved it by up to 0.9 ms on a 5 ms request while the medians agreed within 2%, so the gate uses 3,000.
  - Passkey sign-in on iOS needs associated domains, so it waits for UD-34 and the domain names (F-32). The api and the admin web support passkeys in Layer 1.

## ADR-0022

**Layer 1 clients: iOS provider shell and admin web portal**

- **Status:** Adopted (delegated), 2026-10-01. Implementation choices inside ADR-0018 K-22 and K-23 and spec §4.2, §6.8 (roadmap M1.9–M1.11).
- **Decision (both clients):**
  - **Generated clients only.** iOS uses swift-openapi-generator as a build plugin of `CoreNetworking` over a copy of `packages/api-contracts/openapi.json` that `pnpm generate` writes and CI compares. The admin web uses openapi-typescript (`src/api/schema.ts`, also compared by CI) with openapi-fetch. No client hand-writes a request or response type.
  - **Generated types stop at the domain layer.** On iOS, `PatientDomain` and `Authentication` map generated types to domain models; views never see generated types.
  - **Tokens.** The access token is held in memory only. A 401 triggers one serialized refresh and one retry; a refresh that fails ends the session. On iOS the refresh token is stored in the Keychain behind the current biometric set with no passcode fallback (`biometryCurrentSet`); without biometrics it stays in memory and the next launch needs sign-in. The admin web never sees the refresh token: it is the `aestara_rt` HttpOnly cookie (ADR-0021).
  - **Errors.** Both clients read the error envelope into one error type with the request ID shown as a reference, field errors, the MFA challenge, duplicate candidates and the current version. Messages come from the server.
  - **Permissions shape the UI only.** Buttons appear from the session's permissions; the server's 403 or 404 is the answer. A 404 for a patient reads "not available", covering both missing and not visible (spec §4.6).
- **Decision (iOS):**
  - **Navigation.** `TabView` with `.sidebarAdaptable`: a sidebar on iPad and a tab bar on iPhone. Patients is a `NavigationSplitView` (list and profile). Switching organization rebuilds the signed-in shell, so no screen keeps another tenant's data.
  - **Privacy.** A brand cover hides the app whenever the scene is not active, so the app-switcher snapshot shows no patient data (closes THREAT_MODEL.md open item 4, T6.7). Screenshots are not blocked: iOS offers no supported way to prevent them, and the owner of a signed-in device can already see the screen. After 5 minutes in the background the app asks for Face ID or Touch ID again; failure signs out (spec §4.2).
  - **Patients.** Search sends the term in the request body (ADR-0020), after typing pauses. Create checks duplicates first; creating anyway is an explicit choice sent as `confirmNoDuplicate`. One idempotency key per draft: a retry cannot create two patients, and an edited draft gets a new key. The date of birth is the calendar date picked on the device, with no time-zone conversion. Creation is online only (K-17).
  - **Profile.** All twelve tabs in Bible order. The server's `readable` flag decides between the tab's empty state and the permission state. Overview shows demographics; the other tabs' content arrives with their layers.
  - **Server address.** From the build setting `AESTARA_API_BASE_URL` through `Info.plist`. Debug points at `http://localhost:3000`. Release has no address until the domain names are decided (F-32, UD-34); such a build shows that it has no server and does nothing else. The app accepts only HTTPS, except a loopback address. ATS allows plain HTTP to local names only (`NSAllowsLocalNetworking`).
  - **Tests.** Module tests run as package tests on a simulator. The Keychain needs an app's entitlements, so CoreSecurity's tests run hosted in the provider app (`AestaraProviderTests`). UI tests (`AestaraProviderUITests`) run on an iPhone and an iPad against the real api and a fresh database started by `services/api/scripts/local-stack.ts`, which prepares one clinician per device through the api; no test bypasses the server.
  - **Not in Layer 1.** Passkey sign-in on iOS (needs associated domains, F-32). Jailbreak detection: not adopted (closes THREAT_MODEL.md open item 5, T6.9); it is bypassable and gives no server-side guarantee, and the server enforces every rule. App Attest is reconsidered with the patient app (Layer 5), where unattended devices are the norm. Snapshot tests: the tool is chosen with the first clinical screens in Layer 2, to avoid churn on screens that are about to change; Layer 1 screens are covered by the UI tests. The automated accessibility audit (`XCUIApplication.performAccessibilityAudit`) is adopted with the snapshot tool. The encrypted local store (GRDB + SQLCipher) arrives with the offline cache (UD-25, Layer 2).
- **Decision (admin web):**
  - **Shape.** React single-page app on TanStack Router and TanStack Query, as spec §2.2 (D-03) and ADR-0003 fix. Reads are queries keyed by resource and writes invalidate them; the cache is cleared on sign-out, on a session ending and on an organization switch, so no tenant's data outlives its session. Pages for sign-in (password, TOTP, enrollment, organization choice), invitation acceptance, password reset (token in the URL fragment, never sent to a server log), users and roles, and the audit viewer. Patient data is not in the portal in Layer 1.
  - **Content Security Policy** (closes SECURITY_REQUIREMENTS.md open item 9): `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'`, with `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a `Permissions-Policy` that denies camera, microphone, geolocation and payment, and `Cross-Origin-Opener-Policy: same-origin`. No inline script or style is allowed. The headers are defined once (`apps/admin-web/security-headers.ts`); CloudFront serves them when the portal is deployed, `vite preview` serves them locally and in the end-to-end tests, and the build also carries the policy in a meta tag. The end-to-end suite fails on any policy violation.
  - **Origin.** Served from the same site as the api (`/api/v1` through a proxy in development), so the refresh cookie is first-party and the api's Origin check applies.
  - **Tests.** Unit tests (Vitest, jsdom) for the client and session logic, and Playwright end-to-end tests against the real api and database in CI, through the same `local-stack.ts`. The stack only ever runs against a local database and synthetic data. Where a test needs a secret the api emailed, it supersedes that invitation and issues one it knows, as a re-invitation does; tokens stay immutable.
- **Decision (shared code):** `packages/security` stays a placeholder in Layer 1. The api is the only consumer: the permission catalog lives in `packages/database` (it seeds the database), and authorization, step-up and PHI-safe logging live in `services/api`. They move into the package when a second service needs them (the Layer 2 workers).
- **Decision (local stack):** `services/api/scripts/local-stack.ts` starts a throwaway Layer 1 stack against a local PostgreSQL: a fresh database migrated by a non-superuser, the synthetic seed, and the api from `dist/` as login users of the runtime roles. `pnpm dev:stack` uses it for local development (email to Mailpit, which joins `docker-compose.yml` as ADR-0018 K-14 decided); the web and iOS end-to-end tests use it too. It refuses non-local databases and drops its database when it stops.
- **Consequences:** a contract change regenerates both clients and fails CI until they compile. Release builds of the iOS app need F-32 and UD-34 decided before TestFlight.

## ADR-0023

**Layer 2 kickoff decisions**

- **Status:** Accepted, 2026-10-01. The owner accepted Layer 1 and authorized Layer 2, then confirmed every recommendation in [`LAYER_2_KICKOFF.md`](LAYER_2_KICKOFF.md) ("adopt all"), choosing explicitly that every standard view is required (K2-11), that every upload is scanned (K2-04) and that `CLINICAL_USE` does not gate staff capture or viewing (K2-16). The spec is corrected to match before any Layer 2 code (Bible §0).
- **Context:** the roadmap requires the Layer 2 decisions (UD-06, UD-21, UD-22, UD-24, UD-25) to be confirmed, and the findings carried to Layer 2 (F-34, F-35, F-36, F-61, F-63, F-66, F-67) and the documentation pack's Layer 2 open items to be resolved, before implementation.
- **Decision:** K2-01 to K2-22 as written in `LAYER_2_KICKOFF.md` §2:
  - **Services:**
    - K2-01: image-processing is Python 3.13 with pyvips, has no database access, receives presigned per-object URLs per job, and calls only the JPEG and PNG loaders under a pixel limit and a time limit.
    - K2-06: `AIJob` moves to Layer 2 as the generic job record, with job type `IMAGE_DERIVATIVE`; derivatives are a 400 px thumbnail and a 2048 px preview with metadata stripped; output objects are registered before the job runs; transient failures retry three times.
    - K2-07: the worker relays the outbox to EventBridge and SQS with dead-letter queues and de-duplication by event ID, and writes the audit WORM copy to an Object Lock bucket with a daily reconciliation.
    - K2-08: moto replaces LocalStack (ADR-0010 amended).
  - **Photos and storage:**
    - K2-02: JPEG originals; JPEG and PNG accepted; no HEIC until an HEVC decoder licence is reviewed; 50 MiB and 100 megapixels; first bytes must match the declared type.
    - K2-03: one presigned `PUT` with `If-None-Match: *`; replaying the intent renews the URL; completion verifies the stored checksum or computes it.
    - K2-04: every upload is scanned (GuardDuty Malware Protection for S3 if it is in the BAA's scope, else ClamAV); an EICAR-only scanner locally and in CI; an infected or failed scan rejects the photo.
    - K2-05: the photo machine gains the scan step: `UPLOAD_PENDING → QUARANTINED → ACCEPTED | PENDING_REVIEW | REJECTED`, enforced by a trigger.
    - K2-09: bucket placement per object class, the new `audit-archive` bucket, the overwrite denial, VPC-endpoint-only service access and a presigning role for devices.
    - K2-14: archived photos hidden by default and never reusable; quarantined and rejected photos never served; tag rules; a batch access-URL endpoint that audits each photo.
  - **Protocols and capture:**
    - K2-10: protocol machine `DRAFT → ACTIVE → RETIRED` and `DRAFT → RETIRED`, frozen by trigger once not a draft; activating a successor retires its predecessor.
    - K2-11: the Bible §6.2 standard protocols are seeded `ACTIVE` in every organization with the view keys and pose targets listed; every view is required.
    - K2-12: on-device guidance with the 13 Bible codes, one instruction at a time; no check blocks acceptance; the ghost overlay defaults to the latest earlier photo of the same view.
    - K2-13: completing a session with missing required views needs an explicit acknowledgement; a practice is named when the capture grant is practice- or location-scoped.
  - **Permissions:**
    - K2-15: patient-wide permissions with per-photo exceptions; the most specific current row wins; `STAFF_ATTESTATION` is the only evidence until Layer 4; a change that ends a release's effective grant also revokes the release; an hourly expiry job.
    - K2-16: `CLINICAL_USE` does not gate capture or staff viewing.
  - **Platform:**
    - K2-17: the offline cache policy is a practice setting (25 patients, 7 days); offline use ends at the session's absolute expiry; the queue belongs to one user in one organization; the store is CryptoKit AES-GCM with Data Protection *Complete* instead of GRDB with SQLCipher.
    - K2-18: flags and settings are registered in code; practice over organization over the code default; no platform-wide rows in Layer 2.
    - K2-19: retention policies are recorded (`ARCHIVE`, `REVIEW`); `DELETE` is refused until legal hold exists; no retention job runs in Layer 2.
    - K2-20: two new audit actions, `PHOTO_REJECTED` and `PHOTO_ARCHIVED`.
    - K2-21: swift-snapshot-testing and the XCUITest accessibility audit on iOS; pytest, ruff and mypy for Python.
    - K2-22: Node.js 24 stays through Layer 2.
  - **Delegated baselines confirmed:** UD-06 (Python, as K2-01), UD-21 (as K2-15), UD-22 (as K2-04), UD-24 (no automated deletion; K2-19) and UD-25 (as K2-17).
- **Spec and schema changes made under this ADR:**
  - **Spec §2.2, §2.3, §10.3:** the iOS offline store (K2-17) and the local emulator (K2-08).
  - **Spec §5.2, §5.8:** `AIJob` moves to Layer 2 (K2-06).
  - **Spec §5.4.10:** the photo machine (K2-05) and a protocol machine (K2-10).
  - **Spec §5.5:** the protocol freeze, photo transition and audit-feed rules (K2-05, K2-07, K2-10).
  - **Spec §6.1.9:** formats, limits, URL renewal, conditional writes and checksum verification (K2-02, K2-03).
  - **Spec §6.2:** new error code `REQUIRED_VIEWS_MISSING` (K2-13).
  - **Spec §6.3:** the batch access-URL endpoint (K2-14); the session completion rule (K2-13); the archive and scan events (K2-20); the flag precedence (K2-18); the retention rule (K2-19).
  - **Spec §6.6.2, §6.7:** the upload DTO uses JPEG; image jobs carry presigned URLs (K2-01, K2-06).
  - **Spec §7.1, §7.3, §7.4:** the device store, the two audit actions, the WORM copy and the bucket layout (K2-07, K2-09, K2-17, K2-20).
  - **Spec §8:** the offline rules (K2-17).
  - **Spec §10.2:** UD-06, UD-21, UD-22, UD-24 and UD-25 confirmed.
  - **Schema:** `AuditAction` gains `PHOTO_REJECTED` and `PHOTO_ARCHIVED`; `AIJobType` gains `IMAGE_DERIVATIVE`. **`constraints.sql`:** the Layer 2 fragment gains the protocol freeze, the photo transition table and the audit-to-outbox feed (behaviour checks C11–C14 and G5).
- **Consequences:** the Layer 2 tables of spec §5.8, plus `AIJob`, are created by the Layer 2 migrations. `packages/security` stays a placeholder: the worker shares the api's codebase and the image-processing service is Python, so no second TypeScript service needs it yet (ADR-0022). Before the first deployment the owner confirms GuardDuty Malware Protection for S3 is within the BAA (K2-04). HEIC needs an HEVC licence review before Layer 5 (K2-02).

## ADR-0024

**Layer 2 backend implementation decisions**

- **Status:** Adopted (delegated), 2026-10-01. These are the implementation choices inside ADR-0023 for the database, api, worker and image-processing work of M2.1 to M2.4, M2.6, M2.8 and M2.10. They were recorded while that work was in progress on the Layer 2 branch, before its acceptance review, not ahead of the first commits as change control asks. Each item below matches what the code does.
- **Decision, database:**
  - **The worker's role.** `aestara_worker` is a login role without `BYPASSRLS`. Its cross-tenant reach is limited to its duties, through column grants and Row-Level Security policies for that role only:
    - claiming and stamping `OutboxEvent` rows;
    - reading `AuditEvent` rows for the WORM copy;
    - finding the organization of a `StorageObject` (by bucket and key) or of an `AIJob`;
    - listing active organizations for the scheduled jobs.
    Every other change it makes runs in a tenant transaction under `aestara_app`, as a request does.
  - **Seeding standard protocols.** `aestara_protocol_seed` owns the `SECURITY DEFINER` function `app_seed_standard_protocols(organizationId)`. Only `aestara_platform` may execute it, so the organization bootstrap seeds the K2-11 protocols without the platform role holding write grants on tenant tables. The function sets the tenant itself.
  - **Shared IDs.** The audit feed's outbox row reuses the audit event's ID, so the relay and the reconciliation need no mapping.
  - **Generated schema.** The generated schema keeps only the built layers' columns. A foreign key column whose only relation is to a later layer's table is left out until that layer (spec §5.8). The generator refuses a kept index or constraint that uses a dropped column.
- **Decision, api:**
  - **Either-permission endpoints.** An endpoint may accept any one of several permissions (`orPermissions` in the contract metadata). An example is a photo route that serves both clinical viewers and export holders.
  - **Visibility of photo sub-resources.** A path that names a photo, session or release answers `404` when the caller cannot read it, so existence is not disclosed (spec §4.6). A collection under a patient answers `403` when the caller lacks the collection's permission.
  - **Storage object states.** At upload verification the object becomes `QUARANTINED` with `verifiedAt` set, which makes it write-once. A clean scan makes it `AVAILABLE`. An infected or failed scan makes it `REJECTED`, and it is never served. The photo moves with it (K2-05). Spec §3.4 flow A is corrected to match.
  - **Feature flags.** A flag `PUT` replaces the stored boolean without `If-Match`. `FeatureFlag` has no version column, and the request states the complete value, so the last writer's choice is the one recorded and audited. Practice settings keep `If-Match` on their `version`. The spec §6.3 row is corrected to match.
  - **Offline view replay** (spec §8 rule 8):
    - The client's event ID becomes the audit event's ID, so a replay is recorded at most once.
    - The event keeps its original time and is marked `offline`.
    - A replay is refused when the event is older than 7 days, when the patient is not in the organization, or when the caller lacks the view's read permission.
  - **Transactions.** Queries inside one transaction run one at a time: its connection serves one query at a time anyway, and the driver is withdrawing support for queued queries.
- **Decision, worker** (the api codebase as a separate process, K2-07):
  - **Process and credentials.** It starts as a Nest application context with its own configuration. It holds no signing keys and no platform credentials, and connects as `aestara_worker`.
  - **Relay:**
    - Claims committed rows in batches with `FOR UPDATE SKIP LOCKED`.
    - Publishes to the bus in chunks of 10 with source `aestara.api`. A failed entry backs off exponentially, at most 5 minutes, and records `attempts` and `lastErrorCode`.
    - Writes audit rows as one JSON-lines object per UTC day of occurrence and per batch, at `audit/YYYY/MM/DD/<firstId>-<count>-<digest>.jsonl`.
    - Writes each archive object with `If-None-Match: *`, so a batch replayed after a crash is already done. Each write carries its SHA-256, which Object Lock requires.
    - Never counts a batch as archived unless every one of its audit rows was read.
  - **Reconciliation.** Runs daily over the last 8 days, comparing each day's relayed audit IDs with the archived IDs. It logs `audit_worm_divergence` with counts only.
  - **Derivative jobs.**
    - Retries after 1, 5 and 30 minutes.
    - An attempt with no result after 15 minutes is swept and retried.
    - Outputs are verified (size, SHA-256, JPEG signature) before a `PhotoDerivative` is recorded.
  - **Malware scans.** The worker reads the GuardDuty Malware Protection result event. Locally and in CI, an EICAR-only scanner reads the bucket's notifications and sends the same event shape; configuration refuses that scanner in production.
  - **Permission expiry.** An hourly job expires media permissions.
- **Decision, image-processing** (K2-01, K2-06):
  - **Process model.** A single SQS consumer handles one job at a time; capacity comes from running more tasks.
    - Each job decodes in a fresh child process, started from a clean fork server and never forked from the consumer.
    - In the child, libvips is hardened and the data segment is limited to 3 GiB. The limit applies on Linux, where the service runs; on macOS, used only for local development and CI's UI tests, the system allocator reserves more address space at start-up than the limit allows, so it is not applied there and the time limit alone bounds a job.
    - The parent kills the child when the job's 60 seconds run out. The 60 seconds cover the download, rendering and uploads.
  - **Rendering:**
    - The JPEG decoder scales down while loading.
    - Colour is converted to sRGB through the embedded profile.
    - Alpha is flattened onto white, the image is resized with Lanczos and never enlarged, and the orientation is applied.
    - Output is JPEG at quality 85 with no metadata, and the encoded file is checked for any remaining APPn or comment segment.
    - Rendering is deterministic, so a repeated job writes identical bytes.
  - **Transfers:**
    - Redirects are not followed.
    - URLs must be on the emulator's origin locally, and HTTPS on an `amazonaws.com` host in AWS.
    - The source must have the ledger's size and SHA-256.
    - Outputs go through the presigned write-once `PUT`s. A `412` means an earlier delivery of the same attempt wrote the output, and the worker's verification decides.
  - **Results** are `image.derivative.completed` or `image.derivative.failed`, in the worker's `ImageJobResult` shape, with these codes:
    - Retried: `JOB_EXPIRED`, `JOB_TIMEOUT`, `SOURCE_UNREADABLE`, `RENDER_TIMEOUT`, `RENDER_CRASHED`, `OUTPUT_UPLOAD_FAILED`.
    - Failed at once: `INVALID_JOB`, `SOURCE_TOO_LARGE`, `SOURCE_INTEGRITY`, `UNSUPPORTED_FORMAT`, `DECODE_FAILED`, `PIXEL_LIMIT_EXCEEDED`, `METADATA_NOT_STRIPPED`.
    - A message that names no job is not answered; it reaches the dead-letter queue.
  - **Logs** carry job IDs, attempts, codes and durations. They never carry URLs, which hold signatures, or message bodies or exception messages.
  - **Configuration.** `APP_ENV=production` refuses an emulator endpoint and requires HTTPS queue URLs.
  - **Container:**
    - Built on `python:3.13-slim` pinned by digest, with the locked virtual environment installed by uv.
    - Debian's security updates are applied at build time, and pip is removed: the runtime installs nothing, and pip's vendored libraries would add findings.
    - Runs as UID 10001 with a read-only root filesystem and a tmpfs `/tmp`.
    - The health check reads a heartbeat that the consumer loop writes.
- **Decision, infrastructure** (`modules/storage`, `modules/messaging`; K2-04, K2-07, K2-09):
  - **Storage.** The clinical-media policy refuses a `PUT` without `If-None-Match: *`. Only GuardDuty's validation object is exempt.
    - Object reads and writes must come through the VPC's S3 endpoint, except for the presigning role and GuardDuty.
    - An object GuardDuty tagged `THREATS_FOUND` cannot be read.
  - **Presigning role.** It may put and get only `CLINICAL_ORIGINAL/` and `CLINICAL_DERIVATIVE/` objects, with a signature at most 10 minutes old (`s3:signatureAge`). It trusts the task roles named `<prefix>-api-task` and `<prefix>-worker-task`, which the compute module creates with the services.
  - **Audit archive.** It is encrypted with the logs key and Object Locked: compliance for 2190 days in staging and production, governance for 1 day in dev. It also refuses overwrites and allows object access only through the endpoint.
  - **Malware scanning.** The GuardDuty Malware Protection plan scans `CLINICAL_ORIGINAL/` and tags each result. Setting `malware_scanner = "clamav"` removes the plan and its rule.
  - **Messaging:**
    - a custom event bus, and a messaging KMS key that EventBridge and CloudWatch may use;
    - the four work queues of the local layout, each with a dead-letter queue after 5 receives;
    - an undeliverable-events queue for the rules' targets;
    - alarms on every dead-letter queue and on any work-queue message older than 15 minutes, published to an encrypted alerts topic whose subscriptions are set at deployment.
  - **Verification.** The modules are checked by `terraform fmt`, checkov (0 failed), and `validate` and tflint in CI. They are not applied (ADR-0014).
- **Decision, tests and CI:**
  - **api tests:** each api test file provisions its own emulator resources, so parallel files never consume each other's messages.
  - **Python tests:** they run moto in-process, so they need no Docker.
  - **End to end:** the api suite runs the real image-processing service when `TEST_IMAGE_PROCESSING=1`, and CI sets it.
  - **image-processing CI job**, in this order:
    - checks the lockfile, ruff and strict mypy, and runs pytest;
    - builds the image and runs it as a locked-down container;
    - scans it with Trivy, which fails on HIGH or CRITICAL findings that have a fixed version. Findings with no fix yet do not fail the build; each run re-checks them.
  - **OSV-Scanner** covers `uv.lock`.
- **Consequences:**
  - The Layer 3 registration job reuses the sandbox and the job contract.
  - `packages/security` stays a placeholder (ADR-0023 consequences).
  - Deploying the container needs the compute module (stop timeout of at least 120 seconds, so a running job can finish) and the egress limits of K2-01.

## ADR-0025

**Layer 2 provider app implementation decisions**

- **Status:** Adopted (delegated), 2026-10-01. These are the implementation choices inside ADR-0023 for the provider app's guided capture, gallery, media permissions and offline work (M2.5, M2.7 to M2.9). Like ADR-0024, they were recorded while the work was in progress on the Layer 2 branch, before its acceptance review. Each item matches what the code does.
- **Decision, modules** (`modules.json`, ADR-0015):
  - Photography depends on DesignSystem, CoreNetworking, CoreSecurity, Media, PatientDomain and AuditSupport. AppShell adds CoreSecurity for the store scope.
  - Settings stays independent of Photography. AppShell hands it a sign-out check (what would be lost, and the purge) as two closures.
  - One `PhotographyContext` per signed-in user and organization holds the repository, the encrypted store, the upload queue, the derivative cache, the patient summaries, the offline view records, the cache policy and the flags. Switching organization builds a new one; the previous organization's queue stays sealed.
- **Decision, the encrypted store** (K2-17):
  - One store per user and organization, under Application Support, excluded from backups. Records are sealed with AES-GCM; each record's name is the associated data, so a sealed file cannot be swapped for another. Files use Data Protection *Complete*.
  - One key per user and organization in the Keychain (`WhenUnlockedThisDeviceOnly`). Tests use an in-memory key provider.
  - A key is read, or made and stored, once per process under one lock, and kept in memory until its store is destroyed. Making it on first use was not atomic: two first uses at once could each make a key, and the second replaced the first in the Keychain, leaving records sealed with the first unreadable. Holding the key also spares every read and write a Keychain call, which on a loaded device can stall the caller for minutes. While the device is locked the records stay closed by Data Protection *Complete*.
- **Decision, capture** (K2-12):
  - One camera session serves the whole capture screen; moving to the next view changes the target, not the session.
  - The stage keeps the photo's 3:4 frame, so the framing oval and the ghost overlay sit on the subject on every screen. The oval follows the detected face or torso and otherwise shows the view's target.
  - Live guidance names the subject while none is found ("Looking for the face") and says when the position is within every tolerance ("Hold still and take the photo"); neither is a guidance code. Each new instruction is announced to VoiceOver.
  - The review lists every check in words and the position match with its label. Accept and Retake are always both available.
  - The quality chips (lighting, distance, pose) show on iPad only (DESIGN_SYSTEM.md §4).
  - With the ghost overlay on, the reference is the latest earlier accepted photo of the view with a display preview. The photographer may choose another from a menu. The opacity runs from 10% to 90%, 40% by default.
  - The device's yaw convention from Vision is flipped to the protocol's (positive shows the subject's left side). This is checked on a device before the first clinical use, because the simulator has no camera.
- **Decision, the upload queue** (spec §8 rules 1 to 6; K2-03, K2-04):
  - A session started offline gets a client UUIDv7 and is created first on reconnect. Each photo carries its own UUIDv7, and its intent and completion keys (UUIDv7) are fixed when it is queued.
  - Replay stops at the first network failure, `401`, `429` or `5xx`, and continues on the next sync. An upload URL that is refused or has expired is replaced by replaying the intent with the same key. A refusal no retry can fix marks that photo failed, and the others continue.
  - The original stays on the device until the server reports the photo accepted. A rejected photo keeps its original: the photographer can upload it again as a new photo (a new ID; the rejected photo stays on record) or discard it and retake.
  - A session completes only once none of its photos waits to upload, because the server closes a completed session to uploads.
  - Sync runs after sign-in, after each accepted photo, when the app returns to the foreground, when the network path comes back, and every few seconds while a patient's photos are uploading or waiting for derivatives. A sync requested during a run runs once more afterwards.
- **Decision, offline reading** (spec §8 rules 7 and 8):
  - The patient-summary cache keeps the recent-patients list and every profile opened, within the cache policy, so a patient can be reached and photographed without a connection. Search, patient creation, permission changes, releases, archiving and tags need the connection.
  - A patient's photo list and the active protocols are kept with the cache, and thumbnails and previews already viewed are kept in the derivative cache.
  - Online, signed URLs are always requested, even for images already cached, because the server writes `PHOTO_VIEWED` as it issues them. Offline, a cached image is shown and each view is recorded on the device. A profile opened offline records `PATIENT_VIEWED` the same way. The records replay first on reconnect.
- **Decision, sign-out and session end** (K2-17; spec §8 rules 7 and 8):
  - **Sign-out** first tries once more to upload. If photos remain, the confirmation names how many and says they are deleted. Then the queue, the cached images, the patient summaries and the cached lists are deleted.
  - **The offline view records survive the sign-out**, sealed for that user and organization, and replay at that user's next sign-in to it. Deleting them would lose audited views. A device revoked while offline is the security runbook's case (spec §8 rule 8).
  - **The session ending without a sign-out** (absolute expiry, revocation, a failed unlock) deletes the cached images, patient summaries and lists. The queue and the offline view records stay sealed until the same user signs in to that organization again.
- **Decision, gallery, photo and permissions** (K2-14, K2-15):
  - The gallery is one request for thumbnails. Photos being checked or rejected show their state in words, never an image. Archived photos are hidden behind a toggle and carry a badge.
  - Tags are trimmed and lower-cased in the app as on the server, at most 40 characters and 20 per photo. Archiving asks for confirmation, says the original is kept and that it cannot be undone.
  - Permissions are shown per category, patient-wide with the number of exceptions, and per photo with its own exception. The app offers only the transitions of spec §5.4.5 from the current state; a grant is recorded as staff attestation and may end on a date.
  - **Releases** are offered for the outward purposes: patient app, education, website, social media, paid advertising and research. They need a current grant for the photo and no active release for the purpose, and they are confirmed on their own sheet (DESIGN_SYSTEM.md C11). Clinical use needs no release, and AI training and evaluation datasets come from grants plus a governance approval (spec §7.7, Layer 7), not from releases. The api accepts any category; the app does not offer these three.
- **Decision, tests:**
  - Swift Testing covers guidance, the position match, sharpness, the quality chips, the queue (with a fake server and storage), permission precedence and transitions, the derivative and patient caches, the store and the offline view records.
  - The UI test runs a standard Face session end to end on the Debug-only synthetic camera: guidance, capture, review, upload, completion, thumbnails from image-processing, a tag and a permission request and grant. It runs `performAccessibilityAudit()` on the capture, gallery and permission screens and fails on every finding, naming the screen and element. Each finding keeps a picture of its element. Five kinds are left out: the synthetic camera's caption; the clipping, contrast or hit area of an element partly outside the visible area, which the audit judges by its visible part (scrolled past the screen's or a sheet's edge, as in the capture screen's view strip, the profile's tab strip and a sheet's list, or under the bottom tab bar's edge effect); clipping in the system search field, a single-line field whose text scrolls; Dynamic Type on the system bars' own buttons and titles, which the system draws at a fixed size and enlarges with the Large Content Viewer (the app draws no UIKit labels, so an unresolved UIKit label is one of those titles); and, for a sheet, findings without an element, which come from the screen dimmed behind it and hidden from assistive technologies. A contrast finding is confirmed on the element's own pixels with the WCAG 2 formula (the most common colour against the 1% of pixels that differ most, so it can wrongly fail but not wrongly pass) and fails below AA's 4.5:1; on iPad the audit flagged text measured at 7:1 to 16:1, and different elements on identical screens, so the findings it does not confirm are kept with the results instead of failing the test. Every other finding fails when a second audit of the same, unchanged screen reports it again; on the iPad simulator the audit flagged one label of a row and not its identical neighbours, and every text of a screen in one run and none in the next. Findings not confirmed are kept with the results and printed by CI. An audit that cannot complete in time runs once more after a pause; a second failure fails the test. The audit's issue handler only collects the issues, and each element is read after the audit returns: querying the app from inside it while the audit holds the accessibility connection is avoided. The iPad audits that could not complete (F-70) come from the app's main thread staying busy, which CI now samples.
  - In the UI tests, the emulator is addressed as `localhost`, which the Debug build's App Transport Security exception names, because the presigned URLs carry that host.
- **Consequences:**
  - The snapshot tests of K2-21 need reference images recorded on a Mac, or a CI job allowed to record them and commit them to the branch: an owner decision (F-68).
  - The device camera path is confirmed on an iPhone and an iPad before first clinical use (F-69).
  - Layer 3 annotation of cached photos and Layer 4 consent evidence build on the same store and permission screens.

## ADR-0026

**Layer 3 kickoff decisions**

- **Status:** Accepted, 2026-10-04. The owner accepted Layer 2 on 2026-10-03, then confirmed every recommendation in [`LAYER_3_KICKOFF.md`](LAYER_3_KICKOFF.md) ("adopt all"), and chose for F-68 that CI records missing snapshot references into its job log and Claude reviews and commits them (K3-22). The spec is corrected to match before any Layer 3 code (Bible §0).
- **Context:** the roadmap requires the Layer 3 decisions (UD-15, UD-28, UD-33) to be confirmed, and the findings carried to Layer 3 (F-35's compatible-view rule, F-37, F-55's cancellation policy, F-64, F-68, F-70), the documentation pack's Layer 3 open items and the Node.js re-evaluation of ADR-0023 K2-22 to be resolved, before implementation.
- **Decision:** K3-01 to K3-24 as written in `LAYER_3_KICKOFF.md` §2:
  - **Consultations:**
    - K3-01: the proposed transitions of spec §5.4.1 are adopted (`/resume`, `/submit-for-review` from `IN_PROGRESS`, `/return-to-progress`, archiving a cancelled consultation); a trigger enforces the machine.
    - K3-02: in `READY_FOR_REVIEW` the reviewed content (reason, provider, location, concerns, notes) is frozen; a completed consultation changes only by addenda and summary regeneration; cancelled and archived ones are frozen.
    - K3-03: `/complete` checks the five spec §5.4.1 preconditions and names each unmet one (`422 COMPLETION_PRECONDITIONS_NOT_MET`); the summary must postdate the last entry into review; `/submit-for-review` needs no draft note.
    - K3-04: new columns record the release decision; Layer 3 accepts only `NOTHING_TO_RELEASE`; Layer 5's `/release` records `MATERIALS_RELEASED`.
    - K3-05: any non-final state may be cancelled with a required reason; nothing attached is deleted; no configurable policy in Layer 3.
    - K3-06: offline, notes are drafted, cached photos annotated and photos captured into a linked session; every transition, finalization, summary, before/after set, registration, export and document upload is online only.
    - K3-07: final notes are immutable; corrections are addenda (`correctsNoteId`); only the author edits, discards or finalizes a draft; after completion only addenda; a new audit action `CONSULTATION_NOTE_FINALIZED`.
    - K3-08: concern areas come from a list registered in code; medical history is staff-sourced in Layer 3, edited with `If-Match` and never deleted.
    - K3-09: `PhotoSession.consultationId` links sessions started from the workspace.
  - **Imagery:**
    - K3-10: annotations are a versioned JSON layer of shapes in normalized coordinates, with no measurement tools, author-only changes and offline client IDs.
    - K3-11: a before/after set takes two accepted, unarchived photos of the patient with the same view key and pose target, the before one captured earlier; other photos answer the same `404`.
    - K3-12: comparison modes are client rendering of display previews (side by side, swipe, cross-fade, blink at most 3 per second, overlay) with synchronized zoom and pan.
    - K3-13: automatic registration estimates a similarity transform (AKAZE and RANSAC with `opencv-python-headless`) on the display previews, on request only, behind the flag `beforeAfter.autoRegistration`; every alignment change needs `photo.annotate`.
    - K3-14: export purposes and derivative kinds.
    - K3-15: exports need `photo.export` and step-up, check and pin the current grant of every photo, render asynchronously from the original with no text or metadata, and download while the release is active.
  - **Documents and history:**
    - K3-16: documents in Layer 3 are the consultation summary and uploaded clinical PDFs (50 MiB, scanned); the presigning role and the malware scan cover `DOCUMENT/`.
    - K3-17: the summary is a PDF rendered in the api with PDFKit and Inter, with no drafts and no images; a new audit action `DOCUMENT_ADDED`.
    - K3-18: the timeline is built from the domain tables, filtered per item by domain permission, metadata only.
  - **Platform:**
    - K3-19: the Layer 3 audit events, with the two additions above.
    - K3-20: consultations are practice-owned; concerns, history, annotations, before/after sets and uploaded documents are organization-owned patient data.
    - K3-21: the iPad workspace is a stepper of the Bible §5.1 steps that exist; later layers' steps are not shown.
    - K3-22: snapshot references are recorded by CI into its log, reviewed and committed by Claude (F-68); Layer 3 tests.
    - K3-23: F-70 is fixed before the Layer 3 acceptance.
    - K3-24: Node.js 24 stays through Layer 3; Node 26 is re-evaluated at the Layer 4 kickoff.
  - **Delegated baselines confirmed:** UD-15 (as K3-07), UD-28 (as K3-01) and UD-33 (as K3-03).
- **Spec and schema changes made under this ADR:**
  - **Spec §2.1:** Node.js re-evaluation moves to the Layer 4 kickoff; OpenCV's role (K3-13, K3-24).
  - **Spec §5.2:** the Layer 3 entity rules (K3-02, K3-04, K3-07, K3-08, K3-10, K3-11, K3-16, K3-17).
  - **Spec §5.4.1:** the confirmed transitions and preconditions, what each state allows, cancellation (K3-01 to K3-05).
  - **Spec §5.5:** the consultation, note and before/after rules (behaviour checks H2–H28, C15–C17).
  - **Spec §6.1.9, §6.2, §6.3:** document limits and download lifetime; three new error codes; the Layer 3 endpoint rows, including the note discard, the export status and download endpoints, and `photo.annotate` for automatic registration.
  - **Spec §6.7, §7.3, §8, §10.2:** the registration and export job contracts, the two audit actions, offline consultation work, UD-15, UD-28 and UD-33 confirmed.
  - **Schema:** `Consultation` gains `releaseDecision`, `releaseDecidedAt` and `releaseDecidedById` (enum `ConsultationReleaseDecision`); `ConsultationNote` gains `correctsNoteId` with a same-consultation foreign key; `AuditAction` gains `CONSULTATION_NOTE_FINALIZED` and `DOCUMENT_ADDED`. **`constraints.sql`:** the Layer 3 fragment gains the consultation machine and frozen states, the note and addendum rules, the frozen concern links and the before/after order rule.
- **Consequences:** the Layer 3 tables of spec §5.8 are created by the Layer 3 migrations. The image-processing service gains OpenCV and the registration consumer. Terraform's presigning role and malware scan gain the `DOCUMENT/` prefix. The iOS `DocumentsConsent` module starts in Layer 3 with documents. The concern-area list and the summary's contents are reviewed by a clinical lead before first clinical use.

## ADR-0027

**Layer 3 backend implementation decisions**

- **Status:** Adopted (delegated), 2026-10-04. Implementation choices inside ADR-0026, recorded as each Layer 3 micro-prompt lands.
- **Context:** ADR-0026 fixes what Layer 3 does; the api, the worker and the database still need concrete shapes for it.
- **Decision, database (M3.1):**
  - Three migrations, as in Layer 2: `20261004100000_layer3_tables` (generated from the promoted schema), `20261004100100_layer3_constraints` (the LAYER 3 fragment of `constraints.sql`, verbatim) and `20261004100200_layer3_security`.
  - Every Layer 3 table is under forced Row-Level Security. `aestara_app` may delete only a draft note (the trigger refuses a FINAL one) and an open consultation's concern links. No new database role: the worker applies registration results as `aestara_app` in the organization's tenant.
  - Ownership: `Consultation` is practice-owned with an optional location; a LOCATION grant covers only the consultations that name its location (spec §4.6). Its notes and concern links follow it, and the service scopes their writes by its practice. Concerns, medical history, annotations, before/after sets and documents are organization-owned patient data.
- **Decision, consultations API (M3.1):**
  - One transition table in the service mirrors the database's: action, allowed states, target state and permission. Each transition checks, in order, the consultation (404), the caller's practice scope (403), `If-Match` (412) and the state (409), then the preconditions, then writes the change and its audit event in the same transaction.
  - Every consultation carries `unmetCompletionPreconditions`, computed on read, so the workspace can say what is left before `/complete` refuses. `/complete` answers `422 COMPLETION_PRECONDITIONS_NOT_MET` with the same codes in `details.unmet`.
  - `/submit-for-review` with a draft note answers `409 INVALID_STATE_TRANSITION` with `details.unmet` `["NO_DRAFT_NOTES"]`: notes are frozen under review (ADR-0026 K3-02).
  - A summary counts as current when one of the consultation's `CONSULTATION_SUMMARY` document versions was created at or after `readyForReviewAt`.
  - Audit metadata holds the states moved between and, on completion, the release decision; never the reason, the cancellation reason or any other text.
- **Decision, concerns, history and notes (M3.3):**
  - `PatientConcern` gains a `version` column, because every `PATCH` carries `If-Match` (spec §6.1.7). The Layer 3 table migration, not yet applied anywhere outside tests, was regenerated rather than followed by a fourth migration.
  - Concerns and history entries are changed by any `consultation.edit` holder in the organization (organization-owned, K3-20). `PATIENT_UPDATED` records the resource, the kind of change and the field names: a concern's area and a history entry's category are codes, so they may appear; descriptions never do. The api accepts history from staff only (`source` STAFF) and leaves the schema's flexible `details` column unused in Layer 3.
  - `PUT …/concerns` replaces the set while the consultation's content is open, refuses a concern of another patient, and bumps the consultation's version when the set changes.
  - Notes: the service checks the consultation, the caller's practice scope, authorship, `If-Match` and the note's status in that order. A note of another author answers `403`; a final one `409 IMMUTABLE_RECORD`; a note written in the wrong consultation state `409 INVALID_STATE_TRANSITION`, with a message saying what to do. A client UUIDv7 already used answers `409 CONFLICT`. Notes are listed oldest first.
  - `CONSULTATION_NOTE_FINALIZED` carries the consultation's ID and whether the note is an addendum.
- **Decision, before/after sets (M3.5):**
  - The api loads both photos of the path's patient in one query; any that is missing, of another patient or of another tenant answers the same `404 PHOTO_NOT_FOUND` with the same message [B §34.1 #13, #20]. A photo that is not `ACCEPTED`, or is archived, answers `409 INVALID_STATE_TRANSITION`.
  - Compatible views compare the photos' view keys and their protocol views' pose targets (subject and target yaw); two photos without pose targets are compatible when their view keys match. The capture order is checked by the api (`422 BEFORE_AFTER_ORDER`) and again by a database trigger.
  - The registration transform is defined in units of the before image's height with its centre as origin (`RegistrationTransform` in `api-contracts`), so it does not depend on either image's pixel size. Manual alignment accepts a scale of 0.25 to 4, any rotation and a translation of at most two image heights.
  - Changing a set's title or alignment is not audited (spec §6.3); creating one writes `BEFORE_AFTER_CREATED` with the two photo IDs.
- **Decision, automatic registration (M3.6):**
  - `POST …/auto-registration` answers `202` with the set: it creates an `IMAGE_REGISTRATION` job recording the set's new version and both photo IDs, links the job to the set, and queues `image.registration.requested` through the outbox. It refuses (`409`) while the flag `beforeAfter.autoRegistration` is off for the organization, while a job for the set is queued or running, and until both photos have a display preview.
  - The worker hands image-processing presigned `GET`s of the two display previews on the same `image-jobs` queue, marked `"task": "REGISTRATION"`; results return on `image-results` with the same mark, and the worker routes them by it. One queue pair keeps the Terraform messaging module and the local emulator unchanged apart from the routed event type.
  - The worker applies a transform only if the set is still at the recorded version and still names the job; otherwise the job succeeds with `applied: false` and the set is untouched. It re-checks the transform against the contract and the automatic limits, and treats anything outside them as `NO_RELIABLE_ALIGNMENT`. Transient failures retry like derivatives (1, 5 and 30 minutes); the stuck-job sweep covers registration jobs.
  - image-processing decodes with libvips only and passes grey pixel arrays to OpenCV (`opencv-python-headless` 4.14, Apache-2.0). The `Transform` result type lives in the contract module so the consumer process never loads libvips or OpenCV; both run in the sandbox child. The wheel bundles FFmpeg for video input, which the service never calls; OSV-Scanner and Trivy cover the new dependencies.
  - Automatic registration accepts a fit only with at least 12 RANSAC inliers that are at least a quarter of the ratio-tested matches, within the K3-13 limits.
- **Decision, annotations (M3.4):**
  - The design tokens gain a fixed `annotation` palette (red, yellow, green, blue, white, black), the same in light and dark mode because it is drawn on photos; it is generated to CSS, TypeScript and Swift (`DSAnnotationColor`). The contract names the colours (`AnnotationColor`), and the api resolves them to the token values when it renders an export.
  - Stroke widths and text sizes are fractions of the photo's height (`ANNOTATION_STROKE_WIDTHS`, `ANNOTATION_TEXT_SIZES` in `api-contracts`), so a layer draws the same on a thumbnail, a preview and an export.
  - Shapes are `FREEHAND` (2 to 2,000 points), `LINE`, `ARROW`, `ELLIPSE`, `RECTANGLE` and `TEXT`, in coordinates from 0 to 1 on the upright photo; the contract has no shape that measures. A layer is listed oldest first, at most 100 per photo.
  - `PHOTO_ANNOTATED` records the photo, the kind of change and the number of shapes; never a label or a text shape.
- **Decision, exports (M3.7):**
  - Routes: `POST /patients/{patientId}/photos/{photoId}/exports` and `POST /patients/{patientId}/before-after/{setId}/exports` start an export (`202`, `Idempotency-Key` required). `GET /patients/{patientId}/exports/{exportId}` reads its status, and `POST …/exports/{exportId}/access-urls` downloads it. An export's ID is its derivative's. All four need `photo.export`, `photo.view` and step-up. An export is seen with `photo.view`, like a media release: a caller with `photo.view` but without `photo.export` gets `403` for an existing one, and a caller without `photo.view` gets the `404` of a resource it cannot see.
  - Each user may start 30 exports in any 10 minutes per api process (a sliding window); beyond that, `429 RATE_LIMITED` with `Retry-After` (spec §6.1 rate limits).
  - The request transaction is as in K3-15:
    - The output object is registered as `CLINICAL_DERIVATIVE` in the clinical-media bucket. The exports bucket holds Layer 4 data exports only.
    - The derivative records the layout, the 4096 px limit, the version of the annotation layer and the set's transform at the time of the request. The render uses exactly these, so a later re-alignment does not change an export already asked for.
    - A composite names the before photo as its source (the frame the after photo is placed into) and the set.
    - The release pins every distinct permission version that governs a photo it shows.
    - `PHOTO_EXPORTED` is written for each photo, with the purpose, the export, the release and the derivative kind. No `MEDIA_RELEASED`: the release belongs to the export (spec §6.3).
  - The job is an `IMAGE_DERIVATIVE` job keyed `export:{exportId}`, queued as `image.export.requested` and sent to image-processing with `"task": "EXPORT"` on the same queues as derivatives. The derivative worker handles only jobs keyed `derivatives:`.
  - At dispatch the worker re-checks the release, the photos and the annotation layer. A layer changed or deleted since the request fails the export with `SOURCE_CHANGED`, rather than drawing something other than what was asked. A revoked release cancels the job. Colours resolve from the design tokens, and widths and sizes from the contract's constants. The label text is the only free text an image job carries; image-processing draws it and never logs it or reports it back.
  - Every attempt writes the export's one object. The `PUT` is write-once and rendering is deterministic, so an attempt that follows a lost result meets the same bytes. The object becomes `AVAILABLE` only after the worker checks its size, SHA-256 and JPEG signature. A failed export's object is `REJECTED` and never served; in almost every failure nothing was written at all.
  - Status: `PENDING` while queued or running, `READY`, `FAILED` (`SOURCE_CHANGED` or `RENDER_FAILED`), and `REVOKED` once the release is revoked, whatever the job did.
  - Download:
    - It re-checks the current grant of every photo shown. A revoked release or an ended grant answers `403 MEDIA_PERMISSION_NOT_GRANTED`; an export that is not ready or has failed answers `409`.
    - The URL is valid 10 minutes, with a file name that carries no PHI.
    - It writes `PHOTO_VIEWED` for each photo, with the variant `EXPORT`.
  - A permission change now also re-checks releases whose subject is a derivative, against every photo the derivative shows.
  - The registry gains `alsoRequires` (permissions a caller must hold as well as the admitting one). Exports and the Layer 2 release routes (`createMediaRelease`, `revokeMediaRelease`) also require `photo.view`. MARKETING holds `photo.export` for released assets only and sees no patient (spec §4.5 note ¹), but those routes checked `photo.export` alone, so it could create a release (F-71). It now gets the `404` of a patient it cannot see, audited as `ACCESS_DENIED`.
  - The render:
    - A pair is shown at the smaller photo's height, reduced until it fits 4096 px side by side, with the after photo placed by the transform inside a frame the size of the before photo, on a neutral dark grey.
    - No photo is enlarged.
    - Labels are drawn in Inter, bundled with image-processing with its own fontconfig file, so they render the same in every environment.
- **Decision, photography for a consultation (M3.2):** a photo session may name a consultation of the same patient while the consultation is `IN_PROGRESS` or `AWAITING_INFORMATION` (K3-09). It takes the consultation's practice and location, so capture needs a grant covering them (K3-20). A practice that differs from the consultation's answers `400 CONSULTATION_PRACTICE`; a consultation in any other state answers `409`. The session's DTO names its consultation, and the session list filters by it. This is the link the summary reads (K3-17) and the workspace's photography step creates; a session created offline replays with it (K3-06).
- **Decision, documents (M3.8):**
  - Routes under `/patients/{patientId}/documents`: list, read, `POST …/uploads` (an upload intent, `Idempotency-Key`), `POST …/{documentId}/complete-upload` and `POST …/{documentId}/access-urls`. Reading needs `document.read`; uploading `document.manage`.
  - An intent either names an existing `UPLOADED_CLINICAL` document (a new version) or gives a title, at most 200 characters, and optionally a consultation of the same patient within the caller's practice scope (K3-20). It registers a `DOCUMENT` object with the declared size and SHA-256 and returns a presigned write-once `PUT` that carries the checksum, valid 10 minutes.
  - The version is created at completion, after the size, checksum and `%PDF-` check, with the next version number under a lock on the document, and `DOCUMENT_ADDED` is written then. A new document with no completed version is neither listed nor found.
  - A version's status follows its object: `SCANNING` while quarantined, `AVAILABLE` after a clean scan, `REJECTED` after a failed one. Only an available version is downloaded. A rejected version stays in the history and is never served; the security log records it. There is no new audit action: K3-19 lists the Layer 3 additions.
  - A summary document takes versions only from generation: an upload to it answers `409`.
  - A download is an attachment named `document-v{n}.pdf`, valid 10 minutes, and writes `DOCUMENT_VIEWED` with the document and the version number. Audit metadata never holds a title.
  - The `DOCUMENT/` prefix joins the presigning role's prefixes and the malware scan's prefixes in Terraform, and the local scanner's bucket notification.
- **Decision, consultation summary (M3.8):**
  - `POST …/consultations/{consultationId}/summary` needs `consultation.edit` within the consultation's practice and an `Idempotency-Key`, and answers `201` with the summary document. It is allowed in `READY_FOR_REVIEW`, or in `COMPLETED` when a final addendum was finalized after the latest summary version; otherwise `409`.
  - The api renders the PDF with PDFKit 0.20 (MIT) on US Letter, embedding Inter Regular and SemiBold (SIL Open Font License; bundled in `services/api` with the licence). Times are in the practice's time zone.
  - The contents are those of K3-17:
    - concerns by area;
    - final notes in the order they were finalized, each addendum under the note it corrects;
    - the photo sessions linked to the consultation, with the protocol and the views of their accepted photos.
    - No draft and no image is included.
  - Each generation writes a write-once `DOCUMENT` object from the api (available at once, not scanned, its SHA-256 computed) and adds a version to the consultation's one `CONSULTATION_SUMMARY` document, which the first generation creates; a lock on the consultation serializes generations. `DOCUMENT_ADDED` records the document, the version number and that it was generated.
- **Decision, patient timeline (M3.8):**
  - `GET /patients/{patientId}/timeline` needs `patient.read`. It merges items from the domain tables, newest first, ordered by time, then kind, then source ID, with a cursor, and filters by domain: `PATIENT`, `CONSULTATION`, `PHOTOGRAPHY`, `DOCUMENT` and `MEDIA_PERMISSION`.
  - The items of a domain are included only for a caller holding its read permission: `patient.read`, `consultation.create`, `photo.view`, `document.read` and `photo.permission.read`. A caller filtering on a domain it cannot read gets an empty page.
  - An item is its kind, its time, its actor when the table records one, and a link (`resource` type and ID). It never holds text from the record.
- **Decision, the provider app (M3.2–M3.8):**
  - **Workspace:** opened full screen from the Consultations tab. On iPad, a fixed column of the steps beside the chosen step, each leading to the next; a split view is not used, because in portrait it hid the steps behind a sidebar button. On iPhone, the steps in a navigation stack (K3-21). The iPad shell puts the app's sections in a split view's first column; it no longer nests a split view in a sidebar-adaptable tab view (K3-23).
  - **Offline copy (K3-06):** loading a patient's consultations online saves the non-final ones, their notes, and the patient's concerns and history in the encrypted store, under the same cache policy as photos. A load that fails part-way saves nothing.
  - **Note queue:** a draft or an edit of one's own draft written offline (or refused with `412`) waits with its client UUIDv7, Idempotency-Key and base version, and replays after the photography sync re-validated the session. A `412` on replay keeps the draft and shows the saved text beside it; the author keeps one. A draft only on the device is discarded on the device; a draft waiting to be sent is not finalized.
  - **Annotations:** drawn with SwiftUI `Canvas` and drag gestures, which take Apple Pencil and touch alike; PencilKit is not used. Layers travel as the contract's JSON, decoded into the generated types in the repository. A layer drawn offline over a cached preview waits in the encrypted store with its client UUIDv7, and an edit with the version it was based on; a `412` keeps it for the author as notes do. Only the author's own layers are edited; others are shown and can be hidden.
  - **Before/after viewer:** the two display previews, fetched through the batch access-URL endpoint (one `PHOTO_VIEWED` each), drawn with the set's transform in the five K3-12 modes; blink never exceeds 3 per second. Zoom and pan apply to both images unless unlinked. Manual alignment edits the transform with handles and saves it with `If-Match`; reset sets mode `NONE`. Automatic registration shows only when the flag allows it, and polls the set until the job ends.
  - **Exports:** chosen per purpose, with the categories the patient has currently granted marked; the server decides. The export is polled until ready, failed or revoked, downloaded into a temporary file, handed to the share sheet and deleted when the sheet closes. The export models and repository live in `Media` (signed downloads), so both feature modules and the shell can use them.
  - **Step-up:** when the api answers `403 REAUTHENTICATION_REQUIRED`, the app asks for the password and, when the account has one, the second factor, and signs in again as the same user in the same organization (ADR-0021). The new session replaces the old one, which is logged out; the device's queues and copies are kept because the user and organization are unchanged.
  - **Module graph:** `Annotations` gains `CoreNetworking` and `CoreSecurity` (its offline queue); `BeforeAfter` gains `CoreNetworking`; the shell reaches photos and previews through `Photography`.
  - **No full-screen screen over the workspace (F-70):** inside the workspace, which is itself full screen, a photo opened for annotation and a before/after set are pushed onto the workspace's navigation stack; the profile's Before/After tab still opens a set full screen. On iPad, SwiftUI builds a full-screen screen presented from another full-screen screen again whenever its traits change: on every text-size change of an accessibility audit (the lifecycle trace showed the annotation screen rebuilt eight times in one audit, its presenter untouched) and when a sheet opens over it (the export sheet closed as it opened). The workspace itself, presented once, was never rebuilt.
  - **State of an opened photo or set:** the step or list that opens it owns what its screen shows and edits: the photo's layers, its loaded preview and the drawing in progress, or the set, its previews, the viewing mode and an alignment in progress. A screen built again keeps all of it and fetches nothing again. Debug builds record screens appearing and disappearing in the device log for this diagnosis.
- **Consequences:** M3.8's summary generator satisfies `CURRENT_SUMMARY`.

## ADR-0028

**Layer 4 kickoff decisions**

- **Status:** Accepted, 2026-10-08. The owner accepted Layer 3 on 2026-10-07, then confirmed every recommendation in [`LAYER_4_KICKOFF.md`](LAYER_4_KICKOFF.md) ("adopt all"). That includes the minors recommendation: minors are out of scope for the first production build. The spec is corrected to match before any Layer 4 code (Bible §0).
- **Context:** the roadmap requires the Layer 4 decisions (UD-11, UD-14, UD-23, UD-31) to be confirmed before implementation. It also requires resolving the findings carried to Layer 4 (F-38 to F-43, F-65), the documentation pack's Layer 4 open items and the Node.js re-evaluation of ADR-0026 K3-24.
- **Decision:** K4-01 to K4-27 as written in `LAYER_4_KICKOFF.md` §2:
  - **Plans, estimates and procedures:**
    - K4-01: estimates only; `Quote` is not modelled (UD-11).
    - K4-02: `InvoiceReference` moves to Layer 10, created by practice-system adapters; Layer 4 keeps the plan's free-text `financingReference`.
    - K4-03: an organization-wide catalog of categories and treatments. It is managed with `practice.manage` at organization scope and read with `treatmentplan.create`. Codes are optional and unique; treatments are retired, never deleted; nothing is seeded.
    - K4-04: options per consultation take the next free letter. The server computes totals: line = quantity × price, rounded half-up to cents, less a discount that never exceeds it. Amounts are USD decimal strings, and every plan says that accepting a plan is not consent to treatment.
    - K4-05: the Layer 4 plan machine, with `DRAFT → CANCELLED` (discard) and `PROPOSED → DRAFT` (`/revise`) added. `/send`, `VIEWED` and expiry arrive in Layer 5. Only a `DRAFT` changes; a trigger enforces the table and the frozen content.
    - K4-06: the in-clinic response through `POST …/{planId}/record-response` (`treatmentplan.send`), attested by the patient in a hand-off. The plan stores the source `IN_CLINIC`, the attestation text, the typed name and the hand-off (UD-14).
    - K4-07: accepting an option declines the shown options of the same consultation in the same transaction. This is a system transition, `SIBLING_ACCEPTED`; drafts stay drafts (F-40).
    - K4-08: `/schedule` creates one `PLANNED` procedure per item with `procedure.manage`. `/complete` needs every procedure closed and at least one done; `/cancel` takes a reason and cancels open procedures (F-42).
    - K4-09: procedures follow the spec §5.4.10 machine, enforced by a trigger, with `PROCEDURE_STATUS_CHANGED`. They have no dose, product or lot fields. `PhotoSession.procedureId` arrives with them.
    - K4-10: estimates are issued for a `PROPOSED`, `ACCEPTED` or `SCHEDULED` plan. A new one supersedes the previous; a void needs a reason. The PDF is rendered with PDFKit and Inter as a `Document` of type `ESTIMATE`.
  - **Consents:**
    - K4-11: the 13 blocks with their required flags. `IMAGE` and `VIDEO_ACKNOWLEDGMENT` blocks point at published education media. A version has one patient signature block and at most one provider and one witness block. `contentHash` is the SHA-256 of the RFC 8785 canonical blocks and signature flags. No shipped templates.
    - K4-12: the whole spec §5.4.4 table is enforced by a trigger, with `DRAFT → VOIDED` added to discard a draft. Signing without the required responses answers `422 CONSENT_INCOMPLETE` (F-43).
    - K4-13: the staff-assisted hand-off is a hashed token for one consent or one plan response, bound to the staff session and device. It lasts 15 minutes idle and 60 at most. Dedicated `/handoff` routes serve it, and the staff identity confirmation is stored. Audit rows name the staff member who opened it, actor type `USER`, with `metadata.handoffId`. Exit is through the biometric gate or password and code, and revokes the token (UD-31, F-41).
    - K4-14: signatures are vector strokes or a typed name, stored write-once as a JSON `SIGNATURE` object; there is no upload.
    - K4-15: the snapshot is a PDF `Document` of type `SIGNED_CONSENT`. `signedSnapshotHash` equals `DocumentVersion.sha256`, checked by a trigger. `CONSENT_COMPLETED` carries the hash, which the WORM copy anchors (THREAT_MODEL.md item 14). Downloads last 10 minutes and write `DOCUMENT_VIEWED`.
    - K4-16: a void takes a reason of at most 500 characters, which is never audited. Voiding a consent that a current grant cites answers `409 CONSENT_IS_EVIDENCE`. The old consent becomes `SUPERSEDED` when its replacement completes. Minors are out of scope: `422 PATIENT_IS_MINOR`, no `GUARDIAN` role (UD-23, F-38).
  - **Education and instructions:**
    - K4-17: an organization-wide library of the nine types. Each version records its source and licence, which publishing requires. One media file per version: MP4 ≤ 200 MiB, JPEG or PNG ≤ 20 MiB, PDF ≤ 50 MiB, scanned.
    - K4-18: assignments and instructions use only published versions, enforced by a trigger. Instructions use pre-op or post-op content. Release arrives in Layer 5 with `consultation.edit`. The engagement states per content type are decided at the Layer 5 kickoff (F-42, F-65).
    - K4-19: `SIGNED_CONSENT` evidence, and only it, cites a `COMPLETE` consent of the same patient.
  - **Platform:**
    - K4-20: the workspace gains education, treatment plans, consents, instructions and next step. The summary adds plans, consents, education and instructions.
    - K4-21: patient data exports are requested in the admin portal with `data.export`. Each needs a purpose and step-up, and a user may request at most 5 per hour. The worker builds a ZIP into the exports bucket, which expires after 7 days; download URLs last 10 minutes. Organization-wide exports are not in Layer 4.
    - K4-22: plans, estimates and procedures are practice-owned. A consent takes the practice of its linked record, else it is patient-level. The catalog and the library are organization-wide. A LOCATION grant reads plans but never changes them.
    - K4-23: the spec §7.3 Layer 4 events, with the corrections listed under it, and one new action, `PROCEDURE_STATUS_CHANGED` (F-39).
    - K4-24: nothing in Layer 4 works offline.
    - K4-25: four admin-portal modules: catalog, consent templates, education, exports.
    - K4-26: the `TreatmentPlans` and `Education` iOS modules, and the consent half of `DocumentsConsent`, with their tests.
    - K4-27: Node.js 24 stays through Layer 4; Node 26 is re-evaluated at the Layer 5 kickoff.
  - **Delegated baselines confirmed:** UD-11 (as K4-01), UD-14 (as K4-06, K4-07), UD-23 (as K4-16) and UD-31 (as K4-13).
- **Spec and schema changes made under this ADR:**
  - **Spec §2.1:** Node.js re-evaluation moves to the Layer 5 kickoff (K4-27).
  - **Spec §4.4:** `/schedule` maps to `procedure.manage`; the in-clinic response to `treatmentplan.send`.
  - **Spec §5.2:** the Layer 4 entity rules. `Quote` keeps a row saying it is not modelled, so the Bible's entity list stays traceable. `InvoiceReference` moves to Layer 10, and the `PatientHandoff` addition joins.
  - **Spec §5.4.3, §5.4.4, §5.4.10:** the revise, discard, in-clinic and sibling rows; the scheduling and completion rules; the draft-discard row and the hand-off note; the procedure, estimate, export and content-assignment rules. One clarification follows from the table: a patient signature given in `VIEWED` passes through `IN_PROGRESS` in the same transaction [P].
  - **Spec §5.5, §5.8:** the Layer 4 integrity rules (behaviour checks F13–F42, J1–J34); the Layer 4 table list.
  - **Spec §6.2, §6.3:** three error codes (`CONSENT_INCOMPLETE`, `CONSENT_IS_EVIDENCE`, `PATIENT_IS_MINOR`). The endpoint rows add `/revise`, `/record-response`, estimate void, procedure `/schedule`, the hand-off group (`/handoff`, `/handoffs/{id}/end`) and the export patient match. `/send` and instruction `/release` are marked Layer 5, and the corrected audit columns are in place.
  - **Spec §7.3, §8, §9.1, §10.2:** `PROCEDURE_STATUS_CHANGED` and the Layer 4 audit rules; Layer 4 offline; the Layer 4 row; UD-11, UD-14, UD-23 and UD-31 confirmed.
  - **Schema:**
    - `Quote` and `QuoteStatus` removed.
    - `TreatmentPlan` gains the response fields (`responseSource`, enum `TreatmentPlanResponseSource`; `responseHandoffId`, `responseAttestation`, `responseSignerName`, `acceptedSiblingId`) and its cancellation fields.
    - `TreatmentPlanItem.quantity` defaults to 1 and is required.
    - `Procedure` gains its cancellation fields; `Estimate` gains `supersededAt` and its void fields.
    - `ConsentAssignment` gains `replacesAssignmentId`; `ConsentSignature` gains `handoffId`.
    - The new `PatientHandoff` table, with enums `HandoffPurpose` and `HandoffEndReason`.
    - `EducationContentVersion` gains `source` and `license`.
    - `DataExportJob.purpose` becomes enum `DataExportPurpose`, with `purposeNote`.
    - `AuditAction` gains `PROCEDURE_STATUS_CHANGED`.
  - **`constraints.sql`:**
    - The Layer 4 fragment gains the plan, procedure, consent and export machines and the frozen plan content. It adds the line-total and USD checks, one accepted option per consultation, completion after procedures, and the estimate rules.
    - Consents are prepared from published versions of current templates, with their supersession and void rules and the snapshot hash match.
    - It adds the hand-off checks, published-only assignments and instructions, the education publishing check, the export checks and no-delete triggers.
    - `PhotoPermission_evidence_chk` is re-created, with a trigger requiring a `COMPLETE` consent.
    - The Layer 5 fragment re-creates the plan edges with the patient-app rows.
  - **Verification:** `check_traceability.py` records `Quote` as not modelled and excludes the §6.2 error codes from the audit-name check.
- **Consequences:**
  - The Layer 4 tables of spec §5.8 are created by the Layer 4 migrations, starting at M4.1.
  - The admin portal gains four modules, and the iOS `TreatmentPlans` and `Education` modules are built.
  - The worker gains the export job, and Terraform's exports bucket and malware scan are used for the first time.
  - Before first clinical use, three reviews are needed:
    - legal review of the in-clinic electronic signature (ESIGN, UETA, state rules);
    - the practice's own templates and education content;
    - the estimate wording and the export purposes (`LAYER_4_KICKOFF.md` §3).
  - Bringing minors into scope later needs a new ADR and a schema change.
