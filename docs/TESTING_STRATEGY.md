# Testing strategy

| | |
|---|---|
| Version | 1.0 |
| Status | Layer 0 baseline, 2026-09-28 |
| Authority | Production Bible §27 (testing and acceptance, definition of done), §28 (environments and CI gates; §28.1 no production data in lower environments), §31 (acceptance review format), §32 (Layer 1 acceptance), §34 (representative acceptance criteria), §36 (production readiness). ADR-0004 (RLS performance gate), ADR-0010 (tooling), ADR-0011 (contrast gate). |
| Normative sources | [`TECHNICAL_SPECIFICATION.md`](TECHNICAL_SPECIFICATION.md) §2.3 (test tooling), §7.5 (security and isolation testing), §9.1 (per-layer must-pass tests), §11 (verification report); [`technical-spec/verification/`](technical-spec/verification/README.md); [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §5 (accessibility) and §6 (view states) |

This document says how Aestara proves that every Bible rule holds: which test levels exist and with what tools, what each micro-prompt must show before it is done, which CI gates block a merge, and how each layer's acceptance review traces back to tests. The security requirements it verifies are in [`SECURITY_REQUIREMENTS.md`](SECURITY_REQUIREMENTS.md) and the threats behind them in [`THREAT_MODEL.md`](THREAT_MODEL.md).

---

## 1. Principles

1. **Tests arrive with the feature.** A micro-prompt is not done until its tests exist and pass [B §27.2].
2. **The hardest rules are proven twice.** Tenancy, original-photo immutability, consent immutability, append-only audit and release rules are enforced in the database and in the API (spec §1.4), and each enforcement point has its own test.
3. **Authorization and tenancy are tested against real PostgreSQL, never mocks** (spec §2.3).
4. **Suites are generated where the spec gives a table.** Cross-tenant tests come from the route table, authorization tests from the role matrix, state-machine tests from the transition tables (spec §4.5, §5.4, §6.8, §7.5). A new route or transition is covered without anyone remembering to add a test.
5. **Synthetic data only** (§15).
6. **Red is never turned green by skipping** (§16).
7. **Every acceptance criterion names its test** (§18).

## 2. Test levels and tools

Rows are the Bible §27.1 test layers. Tools come from spec §2.3 unless noted. Planned locations follow [`REPOSITORY_STRUCTURE.md`](REPOSITORY_STRUCTURE.md); if they differ, that document wins, and the micro-prompt that creates a suite fixes its final path.

| Bible §27.1 test layer | Tool | Planned location | From |
|---|---|---|---|
| Unit tests | Vitest | Co-located `*.test.ts` in each TypeScript package and service | L0 (`packages/design-tokens`, `packages/api-contracts`, `apps/design-prototype` today) |
| Domain and state-machine tests | Vitest for transition tables; Testcontainers PostgreSQL for persisted transitions | `services/api/test/state-machines/` | L2 (photo permission), then every layer (§8) |
| API contract tests | Vitest over the OpenAPI 3.1 document from `packages/api-contracts`; `oasdiff` | `services/api/test/contract/`, `packages/api-contracts` | L0 (drift), L1 |
| Database and migration tests | SQL behaviour suite on PostgreSQL 18; Prisma migrations applied to an empty database | `docs/technical-spec/verification/` today; migration test stage from M1.1 | L0 |
| Authorization tests | Generated role × endpoint suite, Vitest + Testcontainers | `services/api/test/authz/` | L1 |
| Tenant-isolation tests | Generated cross-tenant suite and RLS tests, Vitest + Testcontainers | `services/api/test/cross-tenant/` | L1 |
| Media permission tests | Vitest + Testcontainers + LocalStack S3 (spec §2.3) | `services/api/test/integration/media/` | L2 |
| iOS ViewModel and domain tests | Swift Testing | Each Bible §24.4 module's test target in the Tuist workspace | L0 (skeleton), L1 |
| UI automation for critical flows | XCUITest (iOS); Playwright (admin web) | Each app's UI test target; `apps/admin-web/e2e/` | L1 |
| Integration-adapter tests | Vitest with synthetic canonical resources | `services/integration-service` | L10 |
| AI regression and identity-preservation tests | Layer 7 validation harness | `services/ai-gateway` | L7 |
| Security tests | spec §7.5 suites, CI scanners, external penetration test | CI and external | L1 to Pre-prod |
| Performance and load tests | RLS benchmark (ADR-0004); k6 (spec §7.6) | `services/api/test/perf/` | L1 |
| Backup, restore and DR tests | Restore drill and DR exercise (spec §7.6) | Runbooks in [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md) | Pre-prod; DR before enterprise rollout |

The Python services (`image-processing`, inference; UD-06) have no named test runner yet (open item 1).

## 3. Definition of done per micro-prompt

Each micro-prompt ends with evidence for all eleven Bible §27.2 items. The evidence goes into the micro-prompt's completion summary.

| # | Bible §27.2 item | Evidence required |
|---|---|---|
| 1 | Functional requirements implemented | Endpoints, screens and jobs listed against the feature prompt [B §33] |
| 2 | Acceptance criteria satisfied | Each numbered criterion with its test ID and result, in the §17 format |
| 3 | Authorization implemented server-side | Every new route declares a permission; new role × endpoint cells and cross-tenant cases run green (§5) |
| 4 | Validation implemented | Zod schemas in `packages/api-contracts`; invalid-input and unknown-field tests |
| 5 | Audit events implemented | An audit assertion (§9) for each event the feature writes |
| 6 | Loading, empty, error, permission-denied, offline states | Each state rendered in a snapshot or UI test for every data-backed view (DESIGN_SYSTEM.md §6) |
| 7 | Migrations created and tested | Migration applies to an empty database and on top of the previous layer; new constraints have behaviour checks (§6) |
| 8 | Tests added and passing | CI green on the feature branch |
| 9 | Documentation and API contracts updated | `openapi.json` regenerated (drift check passes); affected docs and `CHANGELOG.md` updated |
| 10 | Architecture decisions recorded | ADR and changelog entry written before the code (CLAUDE.md) |
| 11 | No hidden placeholder | The acceptance review confirms no `TODO` or stub remains in the feature's files [B §30] |

The summary also lists the SR IDs the micro-prompt satisfies and any threat-model change (THREAT_MODEL.md §10).

## 4. CI gates

### 4.1 Jobs

| Job | Runs | Notes |
|---|---|---|
| `workspace` | Biome lint and format, typecheck, Vitest unit tests, build, generated-file drift (design tokens, OpenAPI), `oasdiff` breaking-change gate, iOS module architecture rules (`check_module_graph.py`) | Node 24, frozen lockfile |
| `spec` | Bible → spec traceability, Bible export drift, documentation pack and reference check (`check_docs.py`), schema validity plus database behaviour suite on PostgreSQL 18 | `run_schema_checks.sh` on an empty database |
| `terraform` | `fmt`, `validate`, `tflint` (Terraform and AWS rulesets), `checkov` | The bootstrap root and the dev, staging and production roots |
| `security` | OSV-Scanner on `pnpm-lock.yaml` (ADR-0016) | Dependabot update pull requests run through the same jobs |
| `ios` | Module architecture rules, Tuist generate, build of both apps for the simulator, DesignSystem tests on an iPhone simulator | macOS 26 runner, Xcode 26.6; each layer adds its module tests |

Every job must be green before the owner approves a merge to `main` (DEVELOPMENT_ROADMAP.md §2).

### 4.2 Bible §28.2 gates

| Bible §28.2 gate | Where | Status |
|---|---|---|
| Formatting and linting | `workspace` | In place |
| Type checking | `workspace` | In place |
| Unit, API and database tests | `workspace` (unit), `spec` (database) | API tests arrive with the M1.2 contract-test harness; their job placement is decided then (open item 4) |
| Migration validation | `spec` | Today the draft schema plus `constraints.sql`; real per-layer migrations from M1.1 (§6) |
| Dependency and security scanning | `security` (OSV-Scanner); Dependabot weekly updates (`.github/dependabot.yml`) | In place (ADR-0016); SAST and a dedicated secret scanner are open item 3 |
| Container scanning | None yet | Trivy from the first container image in Layer 1 (spec §2.3, §7.1) |
| Terraform validation and plan review | `terraform` (validation) | Plan review is a human step before apply ([`DEPLOYMENT.md`](DEPLOYMENT.md)) |
| iOS build and tests | `ios` | In place |
| No deployment when required gates fail | Deployment pipeline | Defined in [`DEPLOYMENT.md`](DEPLOYMENT.md); SR-SCI-01 |

## 5. Isolation and authorization suites

### 5.1 Generated cross-tenant suite (spec §7.5)

- **Source:** the route table. Every route carries a tenancy class: tenant-scoped, portal, platform or public. The generator fails the build if a route has no class, so a new route cannot escape the suite.
- **Fixtures:** organization A with two practices and a patient in each; organization B with users holding every staff role; a patient-app user in each organization. All data is synthetic.
- **Assertions for each tenant-scoped route:**
  1. A user of B holding the route's permission, requesting A's resource ID, gets `404 <RESOURCE>_NOT_FOUND`.
  2. That body is identical to the body for a random UUID, apart from the per-request `requestId` (spec §7.5).
  3. There is no timing difference; the measurement method is fixed in M1.4 (open item 7).
  4. Mixed nested IDs (`/patients/{A}/photos/{B}` and the reverse) and IDs inside request bodies (`sourcePhotoIds`, before/after photo IDs, `practiceId`) are swapped as well [B §34.1 #13].
  5. List and search routes never return B's rows to A or A's to B.
- **Inside one organization (ADR-0001):** a user scoped to practice A1 can read A2's patient, and creating a practice-owned record at A2 returns `403 PERMISSION_DENIED` (spec §4.6).
- **Portal routes:** patient 1 against patient 2's IDs in the same organization, and a patient of B against A, both return 404.
- **RLS tests (ADR-0004):** the application role has no `BYPASSRLS`; a transaction without `app.organization_id` sees no tenant rows; with B's setting, direct SQL through the application role cannot read A's rows.
- **When:** every pull request from Layer 1, against PostgreSQL 18 in Testcontainers with RLS enabled.

### 5.2 Other suites from spec §7.5

| Suite | What it asserts | From |
|---|---|---|
| Authorization (role × endpoint) | Generated from spec §4.5: every role and route pair is allowed or denied as the matrix says | L1 |
| Separation of duties | Self-assignment, a platform actor granting a clinical role, and a practice admin exceeding its scope are rejected (spec §4.5) | L1 |
| Session revocation | A revoked session's access and refresh tokens fail on the next request; refresh-token reuse revokes the whole session | L1 |
| PHI log canary | Canary strings sent through every endpoint never appear in captured logs | L1, every layer |
| Media permissions | Export and release with a missing, revoked or expired grant fail with `403 MEDIA_PERMISSION_NOT_GRANTED` | L2, L3 |
| Portal visibility | For every portal endpoint, drafts, rejected or failed simulations, unreleased documents, planned procedures and internal notes never appear (spec §4.7) | L5, L8 |

## 6. Database behaviour suite

`schema_behavior_tests.sql` holds 90 checks today: groups A–H and R, plus the automated V7 `MATCH SIMPLE` audit (spec §7.5, §11.2). Each labelled check attempts a forbidden operation or the legitimate operation next to it (spec §11.1). The `spec` job applies `schema.prisma` and all of `constraints.sql` to an empty PostgreSQL 18 database and runs the suite; the first failure aborts the run.

**How it grows with each layer:**

1. The layer's migration creates its tables (spec §5.8) and carries its `constraints.sql` fragment.
2. From M1.1 the suite runs against the real migrations up to the current layer, as the migration test stage (spec §7.5). A check runs once every table it touches exists.
3. Every new constraint or trigger gets a violation check and an adjacent legitimate check. A constraint that a later fragment drops and re-creates is re-tested.
4. Regression checks (the R series) are never removed; a defect found later adds a new R check.
5. Layer 1 adds RLS checks (§5.1).
6. The spec §11.1 V7 audit (composite foreign keys with two or more nullable columns must be covered by a CHECK) is already automated in the suite; it reads the live catalog, so every new table is audited.

**Where today's checks become live (by the tables they touch, spec §5.8):**

| Layer | Checks |
|---|---|
| 1 | A2, A5, B1–B8, G1–G4, R4; the V7 audit from Layer 1 on |
| 2 | C1–C4, C8–C10, D1–D10, H4–H6, R1–R3, R15–R17 |
| 3 | A1, C5–C7, F11, H2, H3 |
| 4 | F1–F10, F12, R5–R9 |
| 6 | A3, A4, H1 |
| 7 | E1–E5, R10–R13 |
| 8 | E6–E15, R14, R18 |

How the single file is split so each layer runs only its live checks is decided in M1.1 (open item 8).

## 7. Contract tests

| Check | Rule | Where |
|---|---|---|
| OpenAPI drift | `openapi.json` is regenerated from the Zod schemas and must match the committed file | `workspace` (L0) |
| Breaking changes | `oasdiff` against `main`; a breaking change fails unless the path version is bumped; `v1` is additive only | spec §6.1.1, §6.8 |
| Declared permission | Every route declares one; the test fails on a route without it | spec §6.8 |
| Error envelope | Shape per B §20.4; `requestId` equals the `X-Request-Id` header; no stack traces, SQL or storage keys | spec §6.1.5 |
| Pagination | Cursor paging, `limit` capped at 100, unknown query parameters return `400 VALIDATION_FAILED` | spec §6.1.6 |
| Idempotency | Replay returns the original status; in-progress returns 409; a reused key with a different body returns 409 | spec §6.1.8 |
| Concurrency | Stale `If-Match` returns 412; missing returns 428 | spec §6.1.7 |
| PHI hygiene | `Cache-Control: no-store` on PHI responses; no PHI-bearing path or query parameters; unknown body fields rejected | spec §3.3, §6.1.10 |
| Enum sync | API enums are generated from the Prisma enums; Appendix A states equal the schema enums (traceability check) | spec §6.8, §11.2 |
| Generated clients | The Swift and TypeScript clients generate from `openapi.json` and compile | `ios`, `workspace` |
| Internal contracts | Queue message schemas carry identifiers only; `notification.requested` has no content field | spec §6.7 |

## 8. State-machine tests

- **Source:** the transition tables in spec §5.4. The suite is generated from the same table the server uses (one per aggregate), so the two cannot drift.
- **Exhaustive matrix:** for each machine, every state × action pair is tried.
  - An allowed pair succeeds for a caller with the declared permission, sets the required timestamps and actors, and writes the declared audit event (actor `SERVICE` for system transitions).
  - Every other pair returns `409 INVALID_STATE_TRANSITION` with `currentStatus` and `allowedActions` (spec §6.6.5), and writes no state change, audit row or outbox row.
  - An allowed pair called without the permission is denied.
- **Database backstops:** status and timestamp CHECKs and forward-only triggers are covered by the behaviour suite (H3, E12, F4, F8, R5–R9, R11–R13).
- **Proposed rows:** transitions tagged P or UD in spec §5.4 are tested as adopted. If a kickoff changes one through an ADR, its test changes in the same micro-prompt.

| Machine (spec §5.4) | Layer |
|---|---|
| Photo permission; PatientPhoto (proposed) | 2 |
| Consultation | 3 |
| Treatment plan, consent, estimate, template and content versions | 4 |
| Message, photo request | 5 |
| Appointment, telehealth | 6 |
| AIJob | 3 (registration), 7 |
| Simulation | 8 |
| Integration sync | 10 |

## 9. Audit assertions

Every audited action has a test that asserts:

1. Exactly one `AuditEvent` with the expected action, actor type and outcome.
2. The Bible §22.2 contents: actor, organization, resource type and ID, action, timestamp, request ID equal to the response's `X-Request-Id`, and session and device where applicable; `patientId` for patient-related events.
3. **Same transaction:** when the request fails after the domain write (fault injection), neither the change nor the audit row persists (spec §3.3).
4. **No clinical content:** canary values from the request never appear in `metadata` (spec §7.2 rule 7).
5. Denied access writes `ACCESS_DENIED` with outcome `DENIED`, once UD-19 is approved.
6. View events are written on signed-URL issuance; offline replays carry their original timestamp and `metadata.offline = true` (spec §8).
7. The application role cannot update or delete audit rows (grant test); the triggers are covered by DB G1–G4.
8. From Layer 2, the WORM reconciliation job detects a planted divergence in a test environment (spec §7.3).

A coverage check lists every `AuditAction` value whose layer exists and fails if no test emits it. The catalog itself is spec §7.3.

## 10. iOS tests and accessibility

| Kind | Tool | What it covers |
|---|---|---|
| Unit and domain | Swift Testing | ViewModels, domain rules, the generated client against a stub transport, Keychain and session service, the offline queue |
| Snapshot | Tool not yet chosen (open item 2) | Every data-backed view in all six states (DESIGN_SYSTEM.md §6), light and dark, iPad landscape and iPhone portrait, default and accessibility text sizes |
| UI | XCUITest | Critical flows per layer, deep-link re-authorization [B §24.5], the consent hand-off lock (DESIGN_SYSTEM.md §2, C13), offline banners and disabled actions |

**Accessibility (DESIGN_SYSTEM.md §5):**

| Rule | How it is tested |
|---|---|
| Contrast: text 4.5:1, UI 3:1, both themes | `packages/design-tokens` contrast test (63 pair checks) in the `workspace` job (ADR-0011) |
| Dynamic Type | Snapshots at accessibility sizes; nothing truncates a patient name |
| VoiceOver | UI tests find controls by accessibility label, so an unlabeled control fails the test; an automated accessibility audit on critical screens is decided in M1.9 (open item 2) |
| 44 pt targets, Reduce Motion | UI and snapshot tests on critical screens |
| Admin web semantics | Biome's recommended rules, which include its accessibility group, run repo-wide (`pnpm lint`); Playwright checks labels on critical flows |

The `ios` CI job generates both Tuist projects, builds both apps for the simulator and runs the DesignSystem tests on an iPhone simulator (Xcode 26.6). Each layer adds its module tests to the job.

## 11. Offline and sync tests

Each rule of the offline contract (spec §8) has a test.

| Spec §8 rule | Test | Level | Layer |
|---|---|---|---|
| 1. Queued operations store operation ID, client ID, version and payload in the encrypted store | Queue persistence test; the store file is unreadable without the key | iOS unit | 2 |
| 2. In-order replay per aggregate; a failed dependency pauses dependents | Queue ordering test with a stub server | iOS unit | 2 |
| 3. Retries reuse the key and never duplicate | Same `Idempotency-Key` replayed returns the original resource; no second row | API integration | 2 |
| 4. Version conflicts surfaced; no newest-timestamp resolution | 412 path shows both versions to the user | API integration, XCUITest | 2, 3 |
| 5. Session re-validated before replay; deep links re-authorize | Revoked session before reconnect blocks replay | iOS unit, XCUITest | 2 |
| 6. Offline originals encrypted with SHA-256; purged after the server confirms | Purge happens only after `complete-upload` succeeds | iOS unit | 2 |
| 7. Cache policy (maximum patients, age, purge on sign-out or revocation) | Policy limits enforced; sign-out empties the store | iOS unit | 2 |
| 8. Offline views audited and replayed first | Replay order and `metadata.offline` | iOS unit, API integration | 2 |

The Bible §23.2 operations (AI generation, EMR sync, release, export, consent completion) are disabled offline with a visible reason, checked by XCUITest.

## 12. AI validation

- **Harness (Layer 7, roadmap M7.5):** input quality, landmarks, segmentation, outside-region identity similarity, artifact detection and output validation. Every check writes an `AIValidationRecord` [B §9.2, §9.5].
- **Model admission:** each `AIModelVersion` carries its thresholds and validation evidence and is immutable (spec §5.2). A category ships only after its model version passes the harness (spec §10.4; roadmap M8.5). Threshold values are set per model version with validation evidence at Layers 7–8; none are defined yet (open item 10).
- **Regression:** every new model version runs the regression set and is compared with the thresholds recorded in that version. A version that does not meet them is not rolled out. Rollback (activating the previous version through a new rollout row) is tested and audited.
- **Pipeline tests:** outputs crossing a threshold never reach `READY_FOR_PROVIDER_REVIEW` unflagged; poor inputs fail with `INPUT_QUALITY_INSUFFICIENT` and actionable reasons; unknown or dosage-like parameters are rejected; provenance is complete [B §34.2 #23–25, #31].
- **Data:** CI uses synthetic or non-patient images only. Governed evaluation sets may include only assets with a current `INTERNAL_AI_EVALUATION` (evaluation) or `AI_TRAINING` (training) grant plus a governance approval (spec §7.7). Where those sets are processed is decided with UD-04 at the Layer 7 kickoff (open item 10).

## 13. Performance

| Test | Rule | When |
|---|---|---|
| RLS gate (ADR-0004) | Benchmark login, patient search and patient open with RLS on and off, same data and environment. Pass: added p95 at most 10% **and** at most 5 ms absolute. A miss means the policy design is revised; RLS is never dropped. The result is recorded in the Layer 1 acceptance review. | M1.1 |
| Load tests (spec §7.6) | k6 on login, patient search, upload intent and completion, and simulation generate | Before each production release that touches them |
| Scale tiers [B §25.4] | Load profiles for ~10, ~100 and ~1,000 practices | As each tier approaches |

The benchmark dataset size and environment (open item 11) and the load-test targets (open item 12) are not specified yet. Load tests use synthetic tenants only.

## 14. Security testing

| Activity | Tool | When | Status |
|---|---|---|---|
| Isolation and authorization suites | §5 | Every PR from L1 | Planned |
| PHI log canary, media permission, session revocation | §5.2 | Every PR from their layer | Planned |
| Database behaviour suite | §6 | Every PR | In place |
| Infrastructure scanning | `checkov`, `tflint` | Every PR | In place (`terraform` job) |
| Dependency scanning | OSV-Scanner (`security` job) and Dependabot (spec §2.3, ADR-0016) | Every push; weekly updates | In place |
| Container scanning | Trivy; block high or critical findings without an approved exception (spec §7.1) | Every image build from L1 | Planned |
| Static analysis (SAST) | Deferred by ADR-0016 | Every PR | Open item 3 |
| Secret scanning | GitHub's native secret scanning (ADR-0016); a dedicated scanner is deferred | Every push | In place (native); open item 3 |
| Penetration test | External, covering the identity module (ADR-0002) and every trust boundary in THREAT_MODEL.md | Before production | Planned; findings become regression tests |

## 15. Test data

- **Synthetic only; never real PHI** [B §28.1; spec §7.2 rule 8]. People are fictional, as in the design prototype.
- Contact data uses reserved example domains and fictional numbers, as the existing fixtures do (`example.test` in the database suite, `example.com` in the design prototype).
- Clinical images in tests are synthetic or non-patient images whose licence permits the use; never patient photographs.
- Canary PHI values are distinctive synthetic strings so the log test can search for them.
- The Layer 1 seed (organization and admin, B §32 #3) is synthetic.
- Production synthetic checks run against a synthetic tenant [B §26; spec §7.6].
- Production data never enters a lower environment without an approved de-identification process [B §28.1]. Governed AI evaluation sets are the only real-image datasets and stay under §12.

## 16. Flaky-test policy

- A failing test is never skipped, quarantined, disabled, deleted or marked "allowed to fail" to get CI green. No `.skip`, `.only`, `XCTSkip` or `continue-on-error` is used for that purpose.
- An intermittent failure is a defect. Its cause (in the test or the product) is fixed before the merge; CI stays red until then.
- Runner-level automatic retries are not used to hide failures. A job may be re-run only for a recorded infrastructure failure (runner or registry outage), never for a test failure.
- A test is removed only when the requirement it proves is removed by an ADR.

## 17. Acceptance review format

Each layer ends with a table and a stop [B §30, §31; DEVELOPMENT_ROADMAP.md §2].

| # | Criterion (source) | Evidence | Result | Notes |
|---|---|---|---|---|
| 7 | Cross-tenant access is rejected server-side [B §32] | Cross-tenant suite, CI run link | PASS | 100% of tenant-scoped routes |
| … | … | … | … | … |

- **PASS:** the evidence (test ID, CI run or command) is cited and reproducible.
- **FAIL:** the criterion is not met; the layer is not accepted.
- **DEFERRED BY SPECIFICATION:** a higher source explicitly defers the item (cite the Bible section, ADR or UD). Never used for convenience.

After the table, the review lists what Bible §32 asks for: features, new and modified files, migrations, APIs, permissions, audit events, tests, security considerations (SR IDs and threat IDs), known limitations and exact run, test and migration commands. Then work **stops** until the owner approves [B Appendix B].

## 18. Traceability to acceptance criteria

Planned locations follow §2. Numbers are the Bible's own.

### 18.1 Layer 1 acceptance [B §32]

| # | Criterion | Test | Planned location |
|---|---|---|---|
| 1 | Local database starts | `pnpm services:up` health check; Testcontainers starts PostgreSQL 18 | `docker-compose.yml`; CI |
| 2 | Migrations execute | Layer 1 migrations on an empty database, then the Layer 1 behaviour checks | `packages/database`; `spec` job |
| 3 | Seed creates an organization and admin | Seed test asserts the organization, the first ORGANIZATION_ADMIN and its audit rows | `packages/database` |
| 4 | Admin can authenticate | Login and MFA integration tests; Playwright login | `services/api/test/integration/auth/`; `apps/admin-web/e2e/` |
| 5 | Authorized staff can create a patient | Duplicate check, idempotent create, `PATIENT_CREATED` | `services/api/test/integration/patients/` |
| 6 | Authorized provider can open an allowed patient | Profile read writes `PATIENT_VIEWED`; demographics only | `services/api/test/integration/patients/` |
| 7 | Cross-tenant access is rejected server-side | Generated cross-tenant suite; RLS tests | `services/api/test/cross-tenant/` |
| 8 | Patient search works | `POST /patients/search`: tenant-scoped, trigram, no PHI in the URL | `services/api/test/integration/patients/` |
| 9 | Patient profile shell opens | XCUITest: profile with all 12 tabs in empty state | Provider app UI test target |
| 10 | Audit events are written | Audit assertions for the 11 Bible §32 events | `services/api/test/audit/` |
| 11 | Provider iOS app builds | `ios` job | CI |
| 12 | Login UI works | XCUITest login, MFA and error states | Provider app UI test target |
| 13 | Patient list, search and create work | XCUITest on iPad and iPhone | Provider app UI test target |
| 14 | Required tests pass | All CI jobs green | CI |
| 15 | Run, test and migration commands are documented | The documented commands are the ones CI runs; reviewed in the acceptance table | `CLAUDE.md`, README |

### 18.2 Before/after [B §34.1]

| # | Criterion | Test | Planned location |
|---|---|---|---|
| 12 | Exactly two images of the same patient | Create-set tests; DB C6–C7 | `services/api/test/integration/before-after/`; behaviour suite |
| 13 | Server rejects another tenant's or patient's image IDs | Cross-tenant suite with body IDs; DB C5, A-series | `services/api/test/cross-tenant/`; behaviour suite |
| 14 | Original assets remain untouched | Original checksum unchanged after every operation; DB C1–C4 | `services/api/test/integration/before-after/`; behaviour suite |
| 15 | Side-by-side, slider, cross-fade, blink and overlay work | Snapshot and UI tests of each mode | BeforeAfter module tests; provider UI tests |
| 16 | Zoom and pan can be synchronized | ViewModel test | BeforeAfter module tests |
| 17 | Automatic registration can be disabled or reset | Reset API test; UI test | `services/api/test/integration/before-after/`; provider UI tests |
| 18 | Export verifies purpose-specific permission | Missing, revoked and expired grants return 403 | `services/api/test/integration/media/` |
| 19 | Export creates `PHOTO_EXPORTED` | Audit assertion | `services/api/test/audit/` |
| 20 | Invalid or unauthorized images do not reveal existence | Identical 404 bodies | `services/api/test/cross-tenant/` |
| 21 | Tests cover success, invalid IDs, permission denial and export failure | Acceptance review checks the test list for all four | Layer 3 acceptance review |

### 18.3 AI simulation [B §34.2]

| # | Criterion | Test | Planned location |
|---|---|---|---|
| 22 | Only authorized users create or generate | Role × endpoint cells for create and generate | `services/api/test/authz/` |
| 23 | Every generation references sources and model version | Provenance test; DB E7–E10 | `services/api/test/integration/simulations/`; behaviour suite |
| 24 | Poor or unsupported inputs fail with a safe, actionable status | Synthetic poor-quality inputs return `INPUT_QUALITY_INSUFFICIENT` or `UNSUPPORTED_SIMULATION_INPUT` | `services/ai-gateway` harness; API integration |
| 25 | Outside-region identity validation runs per the model specification | Every version has an identity-similarity record; a breach never reaches review unflagged | `services/ai-gateway` harness |
| 26 | Patient cannot see review, rejected or failed outputs | Portal visibility suite | `services/api/test/portal/` |
| 27 | Only an authorized provider can approve | Role × endpoint cells; DB R18 | `services/api/test/authz/`; behaviour suite |
| 28 | Release is a separate action after approval | State-machine matrix (release before approval returns 409); DB E12–E13 | `services/api/test/state-machines/` |
| 29 | Patient-facing release includes the disclaimer | Portal DTO schema test; patient app UI test | `services/api/test/contract/`; patient app UI test target |
| 30 | All lifecycle events are audited | Audit assertions for every simulation transition, including `SERVICE` actors | `services/api/test/audit/` |
| 31 | No dosage, product, drug, technique or guarantee output | Parameter allow-list tests; DTO field check; copy checks | `services/api/test/contract/`; provider and patient UI tests |

### 18.4 Bible §36 readiness → suites

| §36 area | Proven by |
|---|---|
| Tenancy | §5.1 cross-tenant suite on every sensitive domain |
| Authentication | §5.2 session revocation; penetration test |
| Authorization | §5.2 role × endpoint suite; §7 declared-permission check |
| Photos | §6 checks C and D; media permission tests |
| AI | §12 harness; §8 simulation machine; §18.3 |
| Consents | §6 checks F and R5–R6; §9 consent audit assertions |
| Messaging | §7 internal-contract check (no push content); attachment tests |
| Audit | §9 assertions and coverage check |
| Logging | §5.2 PHI log canary |
| Backups | Restore drill (spec §7.6) |
| CI/CD | §4 gates; §16 policy |
| Monitoring | Alert-fire exercise (SECURITY_REQUIREMENTS.md SR-MON-03) |
| Legal/compliance | Not testable by software [B §21.3]; review |

## 19. Open items

| # | Item | Decide at |
|---|---|---|
| 1 | Test runner for the Python services (`image-processing`, inference) | Layer 2 kickoff (UD-06) |
| 2 | iOS snapshot-testing tool and automated accessibility audit | M1.9 |
| 3 | Tools for SAST and a dedicated secret scanner (ADR-0016 defers both; dependency scanning is in place) | Layer 1 kickoff |
| 4 | Which CI job runs the Testcontainers API suites | M1.2 |
| 5 | Lint rules that reject focused or skipped tests | Layer 1 kickoff |
| 6 | Closed by ADR-0017: spec §7.5 now excludes the per-request `requestId` from the 404 comparison | Closed |
| 7 | How "no timing difference" for cross-tenant 404s is measured | M1.4 |
| 8 | Splitting the behaviour suite so each layer runs only its live checks against real migrations | M1.1 |
| 9 | Closed by ADR-0017: the V7 `MATCH SIMPLE` audit is automated in the behaviour suite | Closed |
| 10 | AI regression threshold values, and where governed evaluation sets are processed | Layer 7 kickoff (UD-04) |
| 11 | RLS benchmark dataset size and environment | M1.1 |
| 12 | Load-test targets and SLOs | INFRASTRUCTURE.md; before production |
