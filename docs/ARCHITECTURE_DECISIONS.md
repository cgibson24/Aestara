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
  - **RLS gate, end to end (M1.8):** CI runs login, patient search and patient open through the whole api, as the application role and as an identical role with `BYPASSRLS`, 1,000 alternating rounds each (login 200), and fails if any adds more than 10% or 5 ms p95. Fewer rounds are dominated by noise at p95.
  - Passkey sign-in on iOS needs associated domains, so it waits for UD-34 and the domain names (F-32). The api and the admin web support passkeys in Layer 1.
