# Changelog

All material changes to the architecture, contracts and repository. Newest first. Entries reference ADRs in `ARCHITECTURE_DECISIONS.md`.

## 2026-10-01: Layer 2 provider app: capture, gallery, permissions, offline (ADR-0025)

- **ADR-0025** records the implementation decisions of the provider app's Layer 2 work. Like ADR-0024, it was written while the work was in progress, not ahead of it.
- **Guided capture** (M2.5): the camera behind a frame source (AVFoundation, Vision and Core Motion on a device; a Debug-only synthetic source in the simulator and the UI tests), the framing oval, one instruction at a time from the 13 Bible codes, the ghost overlay with adjustable opacity and a choice of reference, the position-match score with its fixed label, a shutter that never moves, and the review with every check in words. No check blocks acceptance.
- **Sessions:** start from the active protocols (offline too), the required views left in words, completion with the acknowledgement when required views are missing, and the photos of the session still on the device.
- **Gallery and photo** (M2.7): thumbnails in one request, states in words for photos being checked or rejected, archived photos behind a toggle, the display preview, tags and archiving.
- **Media permissions and releases** (M2.8): per category, patient-wide and per photo, with only the spec §5.4.5 transitions offered and grants recorded as staff attestation; the full history; releases for the outward purposes confirmed on their own sheet, and revocation with a reason.
- **Offline** (M2.9): the encrypted store per user and organization, the upload queue, the derivative cache, the patient-summary cache, and offline view records that replay first. Sign-out asks before deleting photos that have not uploaded.
- **Shell:** the Photos tab of the patient profile, sync after sign-in, on returning to the foreground and on reconnect, the offline copies of the recent patients and opened profiles, and the camera usage description.
- **Tests:** module tests for CoreSecurity, AuditSupport, Media, PatientDomain and Photography in CI. The UI test runs a standard Face session end to end with accessibility audits. The snapshot tests of K2-21 wait for reference images recorded on a Mac (Layer 2 acceptance review).
- **Patients on iPhone:** a newly created patient could stay on "Opening patient", because a pushed copy of the profile screen keeps the values it was pushed with. Each copy now takes its patient's model when it is built and loads it if needed; a new selection still always loads, and so audits, the profile.
- **Admin portal:** the offline-policy "Saved." notice now survives the reload a save causes.
- **Screenshots:** the iOS UI test keeps a screenshot of each screen on iPhone and iPad, and CI publishes them as the `ios-ui-screenshots` artifact.
- **CI:** the iOS UI tests run in their own job (`ios-ui`) beside the module tests, so their result arrives in about half the time. Both devices run even when the first fails. Each accessibility-audit finding names its screen and element, and audit element screenshots no longer overwrite one another. The audit's findings are fixed: the profile tabs take the tap across their whole capsule, the capture guidance wraps instead of being cut at large text sizes, the gallery's two actions sit side by side only on a regular-width screen at the standard text size, and the patient search uses the system's short prompt, naming the search formats when nothing matches. The UI test job builds once and waits for both simulators to finish their first boot, data migration included, before the first test, and runs one simulator at a time. Contrast findings are confirmed on the element's own pixels (WCAG 2, AA). A completed session's Complete button stays disabled while its screen closes, and a reviewed photo's Accept waits while the photo is saved, so neither can be sent twice.
- **image-processing on macOS:** the render child's 3 GiB data limit now applies on Linux only. On macOS (local development and CI's UI tests) the allocator's start-up reservations exceed it and every render crashed (ADR-0024).

## 2026-10-01: Layer 2 backend and image-processing (ADR-0024)

- **ADR-0024** records the implementation decisions of the Layer 2 backend: the worker and protocol-seed database roles, either-permission endpoints, photo sub-resource visibility, storage object states, the flag `PUT`, offline view replay, the relay and WORM copy, derivative jobs, malware scan results, and the image-processing service. It was written while the work was in progress, not ahead of it as change control asks.
- **Database** (M2.1–M2.4, M2.8, M2.10):
  - the Layer 2 tables and `AIJob`, with constraints, triggers, Row-Level Security and the two new roles;
  - the standard protocols seeded in every organization;
  - 36 tables in all.
- **api:** protocols, photo sessions, uploads with verification, photos, tags, archive and signed viewing (including the batch endpoint), media permissions and releases, feature flags, practice settings, the offline cache policy, retention policies and offline view replay. There are 33 new operations in `openapi.json`, and both clients are regenerated.
- **Worker** (`services/api/src/worker`, a separate process):
  - the outbox relay to EventBridge;
  - the audit WORM copy in an Object Lock bucket, with a daily reconciliation;
  - malware scan results, with an EICAR-only local scanner;
  - derivative jobs with retries and a stuck-job sweep;
  - hourly permission expiry.
- **image-processing** (M2.6): Python 3.13, pyvips and uv.
  - It renders the thumbnail and display preview as JPEG in sRGB, with the orientation applied and every metadata block removed.
  - Rendering runs in a disposable child process, with only the JPEG and PNG loaders, under the 100-megapixel and 60-second limits.
  - Outputs are written through write-once presigned URLs.
  - It has no database access and logs no URLs.
  - It ships as a non-root container that runs with a read-only root filesystem.
- **Spec corrected (ADR-0024):**
  - §3.4 flow A: the storage object is `QUARANTINED` at verification and becomes `AVAILABLE` on a clean scan.
  - §6.3: a flag `PUT` is a replace; practice settings keep `If-Match`.
- **Infrastructure (not applied, ADR-0014):** `modules/storage` gains the K2-09 controls (overwrite denial, endpoint-only object access, the presigning role, unreadable infected objects), the Object Lock `audit-archive` bucket and the GuardDuty Malware Protection plan. The new `modules/messaging` adds the event bus, the work queues with dead-letter queues, the routing rules, alarms and an alerts topic. `modules/kms` adds a messaging key.
- **Local and CI:**
  - moto joins `docker-compose.yml`.
  - `local-stack.ts` provisions its own emulator resources and starts the worker and image-processing, for `pnpm dev:stack`, the admin portal end-to-end tests and the iOS UI tests (moto from pip on the macOS runner).
  - A new CI job runs image-processing's ruff, strict mypy, pytest, a container test and a Trivy image scan. This is the first container scan.
  - OSV-Scanner now covers `uv.lock`.
  - The api job runs derivatives through the real service.
- **Fixed on the way:**
  - The audit archive `PUT` lacked the checksum-algorithm header that Object Lock requires.
  - A batch whose audit rows could not all be read could have been counted as archived.

## 2026-10-01: Layer 2 kickoff confirmed (ADR-0023)

- The owner confirmed every recommendation in `LAYER_2_KICKOFF.md` (K2-01 to K2-22), choosing explicitly that every standard view is required, every upload is scanned and `CLINICAL_USE` does not gate staff capture or viewing. Recorded as ADR-0023; ADR-0010 amended (moto replaces LocalStack).
- **Spec corrected before any Layer 2 code:**
  - §2: image-processing on pyvips, malware scanning, the CryptoKit offline store, moto
  - §5.2, §5.8: `AIJob` moves to Layer 2 for image derivatives
  - §5.4.10: the photo machine gains the scan step for every source; a protocol machine
  - §5.5: photo transition, protocol freeze and audit-feed rules
  - §6.1.9: JPEG and PNG only, 50 MiB and 100 megapixels, conditional writes, URL renewal, checksum verification
  - §6.2: `REQUIRED_VIEWS_MISSING`
  - §6.3: batch thumbnail URLs, session completion, `PHOTO_ARCHIVED` and `PHOTO_REJECTED`, flag precedence, retention rule
  - §6.6.2, §6.7: JPEG in the upload example; image jobs carry presigned URLs
  - §7.1, §7.3, §7.4, §8, §10.2: storage controls, the WORM copy, offline rules, confirmed baselines
- **Schema:** `AuditAction` gains `PHOTO_REJECTED` and `PHOTO_ARCHIVED`; `AIJobType` gains `IMAGE_DERIVATIVE`. **`constraints.sql` Layer 2:** the photo transition table, the protocol freeze and the audit-to-outbox feed, with behaviour checks C11–C14 and G5.
- **Documentation pack:** PHOTO_ARCHITECTURE, PHOTO_PROTOCOLS, SECURITY_REQUIREMENTS, THREAT_MODEL (open items 3, 6, 7 and 19 closed or narrowed), AUTHENTICATION_ARCHITECTURE §9, IOS_ARCHITECTURE, TESTING_STRATEGY (open items 1 and 2 closed), SYSTEM_ARCHITECTURE, INFRASTRUCTURE, DATABASE_SCHEMA, DEPLOYMENT, WORKFLOWS, PRODUCT_REQUIREMENTS and the findings register (F-34, F-35, F-36, F-63, F-66 and F-67 resolved; F-61 scheduled in M2.1).

## 2026-10-01: Layer 1 accepted; Layer 2 kickoff proposed

- The owner accepted the Layer 1 acceptance review (`ACCEPTANCE_CRITERIA.md` §6) and authorized Layer 2.
- `LAYER_2_KICKOFF.md` proposes K2-01 to K2-22: one recommendation for each Layer 2 decision (UD-06, UD-21, UD-22, UD-24, UD-25), each carried finding (F-34, F-35, F-36, F-61, F-63, F-66, F-67) and each Layer 2 open item in the documentation pack. Nothing is adopted until the owner confirms it; no Layer 2 code exists yet.
- Found while preparing it: LocalStack no longer starts without an account token, so K2-08 proposes moto for the local AWS emulators (amending ADR-0010).

## 2026-10-01: Layer 1 clients (ADR-0022)

- **iOS provider app** (M1.9–M1.10):
  - generated API client in `CoreNetworking` (swift-openapi-generator build plugin), with correlation, token refresh and error-envelope middleware
  - sign-in with password and TOTP, authenticator enrollment, organization choice, Face ID unlock of the saved sign-in, relock after 5 minutes in the background, privacy cover
  - adaptive shell (iPad sidebar, iPhone tabs), patient list and search, create with the duplicate check, profile with all twelve tabs, settings
  - server address per build; Release has none until F-32 and UD-34 are decided
  - CI builds both apps and runs the DesignSystem, CoreNetworking, CoreSecurity and PatientDomain tests on a simulator
- **Admin web portal** (M1.11): sign-in (TOTP or passkey), invitation acceptance, password reset, users and roles, audit viewer, account (devices, password, passkeys), on TanStack Router and Query as spec §2.2 fixes; the cache is cleared whenever the session or organization changes.
- **Admin portal Content Security Policy** decided and enforced (closes SECURITY_REQUIREMENTS.md open item 9); the end-to-end suite fails on any violation.
- **App-switcher privacy and jailbreak signals** decided (THREAT_MODEL.md open items 4 and 5); the snapshot tool and accessibility audit move to Layer 2.
- **End-to-end tests:** Playwright against the real api; iOS UI tests on iPhone and iPad against the real api on the macOS runner; CoreSecurity's Keychain tests run hosted in the app.
- **Acceptance evidence:** the database tests now check the development seed (Bible §32 #3); a new api test asserts every Layer 1 audit event and that patient events carry no demographics (#10).
- **Local development:** `pnpm dev:stack` and `pnpm dev:admin` run Layer 1 locally; Mailpit joins `docker-compose.yml` (ADR-0018 K-14).
- `packages/security` stays a placeholder until a second service shares its code (ADR-0022).
- **Sign-in under load:** the password check (Argon2id) no longer runs inside a database transaction, and a saturated database answers 503 with Retry-After instead of 500; every operation in `openapi.json` documents 503. Found by the iOS UI tests on a loaded CI runner.
- **Patient search rate limit:** a sliding 60-second window replaces the per-calendar-minute counter, which reset at each minute boundary and allowed a burst of up to 120 searches across it.
- **Layer 1 acceptance review (M1.12):** all fifteen Bible §32 criteria pass (`ACCEPTANCE_CRITERIA.md` §6), with CI run 41 on `c2cd6ec` green in every job. Layer 1 awaits the owner's sign-off; Layer 2 has not started.
- **RLS gate:** 3,000 alternating rounds (login 600) instead of 1,000 (200), so that write-path tail noise cannot decide the p95 (ADR-0021).

## 2026-10-01: Layer 1 API implementation decisions (ADR-0021)

- The owner asked for Layer 1 (M1.2 to M1.12) to be completed before Layer 2. ADR-0021 records the decisions the documentation leaves to those micro-prompts:
  - token formats and keys
  - TOTP and passkeys, factor confirmation, step-up
  - lockout, reset, change and invitation rules
  - tenant transactions, the permission guard, `ACCESS_DENIED` collapsing, cursors and idempotency
  - the organization settings registered in code
- **Spec additions:**
  - error code `SEPARATION_OF_DUTIES`
  - `POST /auth/mfa/enrollments/{id}/confirm`
  - the JWKS path
  - `UserCredential.confirmedAt`
- **Defence in depth:** the api adds an explicit tenant filter to every tenant query, on top of Row-Level Security.
- **RLS gate, end to end:** measured through the api, as ADR-0020 decided. Locally on PostgreSQL 16, with 1,500 rounds, patient open adds 0.1 to 0.7 ms p95 (0.8% to 5.8%); login and patient search add nothing measurable. CI runs the gate on PostgreSQL 18 and publishes the table.
- **Layer 1 contracts:** `packages/api-contracts` now defines every Layer 1 request and response, and an endpoint registry that generates the 62 OpenAPI operations. ADR-0021 records the contract rules: platform reach, If-Match coverage, account edits, shorter-only session policies, probable-duplicate matching, name search and profile tabs.

## 2026-10-01: Patient search under RLS decided (ADR-0020)

- The owner's decision on UD-35. No patient query bypasses Row-Level Security.
- **Search keys:** `Patient` gains five keys maintained by a database trigger. Search matches name prefixes and exact date of birth, MRN, email and phone through leakproof operators, so its indexes work under the tenant policy.
- **Indexes and extensions:** the trigram indexes, `pg_trgm` and `btree_gin` are removed; `unaccent` is added.
- **Gate:** the RLS gate for fixed per-statement cost is judged end to end at M1.8.
  - Measured on the database work: patient search now adds about 0.4 ms p95 (it was 3.5 to 3.7 ms), and the cost no longer grows with organization size.
  - Every request is under the 5 ms limit, and CI now fails on that limit.
  - RLS check S21 proves the search index is used under the tenant policy.
- **Database checks:** 101 on the full design (`K1`–`K2` added); 61 against the Layer 1 migrations.
- **Dependencies:** pnpm overrides patch two of Prisma's transitive dependencies flagged by OSV-Scanner: `deepmerge-ts` 8.0.2 (GHSA-ggr8-5vv4-36mx) and `mysql2` 3.24.5 (GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3).

## 2026-09-29: Layer 1 database foundation (M1.1)

- **`packages/database`** (ADR-0019):
  - the 21 Layer 1 tables, with `prisma/schema.prisma` generated from the design schema
  - four migrations: tables, the Layer 1 `constraints.sql` fragment, security (roles, forced RLS, sign-in lookup, platform grant guard, grants) and the permission catalog (53 permissions, 10 system roles, 139 default grants)
  - table ownership classification (K-08)
  - Prisma client
  - local synthetic seed
- **Checks:**
  - 45 unit tests, including the catalog proven equal to spec §4.4–§4.5
  - `schema:check` drift gate
  - `db:test`: migrations as a non-superuser, no Prisma drift, `check-rls.ts`, and 57 database checks (the Layer 1 fragment plus the new RLS suite)
- **Behaviour suite split per layer** (K-19): `docs/technical-spec/verification/behavior/`. It holds 99 checks over the full design, 9 of them new: one-time tokens, the MFA sign-in step, archived patients.
- **`packages/shared-types`:** enum values generated from the Prisma schema.
- **CI:** a new `database` job on PostgreSQL 18; schema and enum drift checks in `workspace`.
- **RLS performance (ADR-0004 gate), measured on the database work of each request:**
  - login: passes
  - patient open: +0.5 to 0.7 ms p95
  - patient search as specified: fails (+3.5 to 3.7 ms), because its predicates are not leakproof
  - Recorded as UD-35 (spec §10.2) for the owner.
- **Spec count corrections:** 281 foreign keys; 18 supporting tables; §10.2 confirmation note; §10.4 SHA pinning and production-access timing; §11.2 results.
- **Documentation pack aligned with ADR-0018** across 15 documents.

## 2026-09-29: Layer 1 kickoff confirmed

- The owner adopted every Layer 1 kickoff recommendation (K-01 to K-24) and included the admin web shell (M1.11). Recorded as ADR-0018; `LAYER_1_KICKOFF.md` is marked confirmed.
- **Spec corrections under change control** (ADR-0018):
  - §3.5: Row-Level Security design
  - §4.2: client token handling without PKCE, Keychain settings without a passcode fallback, the MFA rule, passwords and recovery, scoped revocation, login audit
  - §4.5 and §4.6: separation-of-duties rules 2 and 3, platform reach, `ACCESS_DENIED` collapsing
  - §5.4.10: patient status rule
  - §6.1.8: patient creation is online-only
  - §6.1.10: no secrets in URLs
  - §6.3 to §6.5: four new Layer 1 endpoints (password change, staff invitation acceptance, admin MFA reset, organization admin bootstrap); the patient invitation token moves into the body
  - §7.3: `SECURITY_CREDENTIAL_CHANGED` and `ORGANIZATION_SWITCHED`, and the Layer 1 audit tamper-resistance
- **Schema:**
  - new supporting table `UserToken`, with its constraints (88 tables)
  - `LoginEventType.MFA_CHALLENGE_ISSUED` replaces `LoginFailureReason.MFA_REQUIRED`
  - two `AuditAction` values
- **Findings:** F-13 to F-33 and F-59 are resolved, scheduled or deferred in `ACCEPTANCE_CRITERIA.md` §5.2. The roadmap marks Step 4 in progress.

## 2026-09-28: Layer 0 accepted

- The owner accepted the Layer 0 acceptance review (`ACCEPTANCE_CRITERIA.md` §4) and read the findings register (§5). Layer 1 waits for the owner's go-ahead (Bible Appendix B #38).

## 2026-09-28: Layer 0 architecture foundation

- **Documentation pack** (Bible §31, §35): all 27 documents are present. The spec stays normative and the pack explains and links it (ADR-0012). `SOFTWARE_PRODUCTION_BIBLE.md` is a verbatim export generated from the PDF. `check_docs.py` checks completeness, references, links and placeholders in CI.
- **`packages/api-contracts`**: Zod 4 → OpenAPI 3.1 with the shared primitives. The committed document is drift-checked and an oasdiff breaking-change gate runs in CI (ADR-0013).
- **`infrastructure/terraform`**: bootstrap, dev/staging/production roots, and modules for KMS, account baseline (CloudTrail delivered to an Object Lock bucket), network, storage, database and compute. validate, tflint and checkov are clean. Nothing is applied yet (ADR-0014).
- **iOS**: Tuist projects for both apps and 20 module packages with a checked tier graph. DesignSystem ships the generated tokens and 4 tests. CI builds and tests on macOS 26 with Xcode 26.6 (ADR-0015).
- **CI**: new `terraform`, `security` (OSV-Scanner) and `ios` jobs; OpenAPI and iOS-architecture gates; Dependabot (ADR-0016).
- **Errata to the locked spec and schema**: `SimulationParameter.unit` removed; §1.5, §2.1, §6.1.1, §7.5, §10.4, §11 corrected; UD-34 added. The V7 `MATCH SIMPLE` audit is now automated (90 database checks, 58 traceability checks) (ADR-0017).
- **Findings register**: 67 Layer 0 findings are recorded in `ACCEPTANCE_CRITERIA.md` §5; 14 are fixed and the rest are carried to the kickoff of the layer that needs them. Two independent accuracy reviews of the pack corrected the documents against the Bible, spec, schema and repository.

## 2026-09-25: Roadmap, environment and design prototype

- `docs/DEVELOPMENT_ROADMAP.md`: steps 0–15, with micro-prompt breakdowns for Layers 1–10.
- Repository initialized:
  - monorepo skeleton (Bible §35) with placeholders naming their layer
  - pnpm/Turborepo/TypeScript/Biome/Vitest
  - PostgreSQL 18 via docker compose
  - Codespaces dev container
  - Claude Code on the web SessionStart hook
  - GitHub Actions CI
  - `CLAUDE.md` (ADR-0010)
- `packages/design-tokens`: shared tokens for iOS and web with a WCAG contrast gate (ADR-0011).
- `apps/design-prototype`: static design prototype of the core scenes (ADR-0009); `docs/DESIGN_SYSTEM.md`.

## 2026-09-25: Technical Specification v1.0 locked

- The owner decided D-01…D-07 (ADR-0001 … ADR-0007):
  - patient data shared within an organization, never across organizations
  - first-party identity
  - React admin SPA
  - RLS with a performance gate
  - iOS/iPadOS 26 with intuitive controls
  - US only
  - default DB naming
- The remaining proposals were adopted by delegation (ADR-0008).
- The spec version moved from 0.1 (draft) to 1.0 (locked).

## 2026-09-25: Independent review resolved

- 30 review findings resolved across the spec, `schema.prisma` and `constraints.sql`. See spec §11.3.
- Verification: 57/57 traceability checks, 89/89 database behaviour tests.

## 2026-09-25: Technical Specification v0.1

- Initial pre-Layer-0 specification derived from the Software Production Bible v1.0: tech stack, draft schema (87 tables), database constraints, API contracts, verification suite.
