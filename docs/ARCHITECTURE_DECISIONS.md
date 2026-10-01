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
