# Development Roadmap

**Aesthetic Platform: from locked specification to production**

| | |
|---|---|
| Baseline | `TECHNICAL_SPECIFICATION.md` v1.0 (locked 2026-09-25) · decisions in `ARCHITECTURE_DECISIONS.md` |
| Governing rules | Production Bible §29 (layers), §30 (constitution), §33 (feature prompt template), §27.2 (definition of done) |
| Working style | One step at a time. Each step ends with an acceptance review and a **stop**. Feature work is done by **micro-prompts**: one small, testable feature per prompt |

---

## 1. The path at a glance

| Step | Name | Bible | What you get | Status |
|---|---|---|---|---|
| 0 | Technical specification | §31 (inputs) | Locked spec: tech stack, schema, API contracts, decisions | ✅ Done (v1.0, on `main`) |
| 1 | Environment & repository | Layer 0 (part) | Initialized monorepo, local development, cloud IDE, Claude Code web setup, CI | ✅ Done |
| 2 | Design prototype | Owner request (ADR-0009) | Static, clickable front-end shell with hard-coded data for the core scenes on iPad, iPhone, patient app and admin web | ✅ Built; awaiting your review |
| 3 | Layer 0 completion | Layer 0 | Full documentation pack, threat model, Terraform skeleton, iOS project skeleton building in CI, Layer 0 acceptance table | ✅ Accepted 2026-09-28 |
| 4 | Layer 1: Identity, tenancy, patients | Layer 1 | Real login, organizations, users/roles, patient search/create/profile, audit; provider iOS shell; admin web shell | ✅ Accepted 2026-10-01 (`ACCEPTANCE_CRITERIA.md` §6) |
| 5 | Layer 2: Photography core | Layer 2 | Guided capture, immutable originals, derivatives, media permissions | Kickoff confirmed 2026-10-01 (ADR-0023); in progress |
| 6 | Layer 3: Consultations & before/after | Layer 3 | Consultation lifecycle, annotations, comparison viewer, timeline | — |
| 7 | Layer 4: Documents, consent, education, plans | Layer 4 | Plans A/B/C + estimates, consent builder + signing, education, instructions | — |
| 8 | Layer 5: Patient app & messaging | Layer 5 | Patient iOS app, released content, secure messaging, notifications | — |
| 9 | Layer 6: Scheduling & telehealth | Layer 6 | Appointments, virtual consultations | — |
| 10 | Layer 7: AI infrastructure | Layer 7 | AI gateway, model registry, quality/landmarks/segmentation, validation harness | — |
| 11 | Layer 8: Outcome simulation | Layer 8 | Procedure visualizations with provider review and explicit release | — |
| 12 | Layer 9: Similar cases & outcomes | Layer 9 | Consented case library, similar-case search, measurements | — |
| 13 | Layer 10: Integrations | Layer 10 | FHIR/vendor adapters, sync monitoring | — |
| 14 | Production readiness | §36 | Readiness checklist: pen test, restore drill, BAAs, monitoring | — |
| 15 | Layer 11: 3D digital patient | Layer 11 | **Separate approved expansion only** | Not planned |

Steps 4–13 follow the Bible's layer order exactly. Nothing from a later layer is built early [B §0.1, §30].

---

## 2. How every step runs

1. **Kickoff.** Confirm the decisions listed for the layer (§4 below) and resolve the Layer 0 findings carried to it (`ACCEPTANCE_CRITERIA.md` §5). Anything changed becomes an ADR *before* code [B §0].
2. **Micro-prompts.** Each micro-prompt implements one feature using the Bible §33 template (purpose, authorized users, data, state machine, workflow, API, UI, security, audit, failure behavior, acceptance criteria, tests, boundary). The technical spec already supplies the DATA / STATE MACHINE / API / SECURITY / AUDIT parts. Each prompt is sized for one working session.
3. **Definition of done for every micro-prompt** [B §27.2]:
   - functional requirements
   - acceptance criteria
   - server-side authorization
   - validation
   - audit events
   - loading/empty/error/permission-denied/offline states
   - tested migrations
   - passing tests
   - updated docs and contracts
   - ADRs for material decisions
   - no hidden placeholders
4. **Branch → CI → review → merge.**
   - Work happens on a feature branch.
   - CI must be green: lint, typecheck, tests, migration + DB behaviour suite, traceability check, dependency/container scans, iOS build.
   - The owner approves the merge to `main`.
5. **Layer acceptance review.** A PASS / FAIL / DEFERRED-BY-SPECIFICATION table for every exit criterion, then **STOP** until the owner says go [B §30, Appendix B].

---

## 3. Steps 1–3: Foundation

### Step 1: Environment & repository (done)

| Deliverable | Detail |
|---|---|
| Monorepo skeleton | Bible §35 tree: `apps/` (ios-provider, ios-patient, admin-web, design-prototype), `services/` (api, ai-gateway, image-processing, notifications, integration-service), `packages/` (api-contracts, database, security, design-tokens, shared-types), `infrastructure/terraform`, `docs/`. Placeholders carry a README naming the layer that builds them; there is no fake business code. |
| Toolchain | Node.js 24 LTS, pnpm workspaces, Turborepo, TypeScript 6.0, Biome (lint + format), Vitest |
| Design tokens | `packages/design-tokens`: one JSON source compiled to CSS variables (web), TypeScript and Swift, with an automated colour-contrast test. This keeps iPhone, iPad and web visually identical. |
| Local development | `docker compose` with PostgreSQL 18 now. moto (S3/SQS/EventBridge/KMS) arrives with Layer 2 in place of LocalStack, which now needs an account token (ADR-0023 K2-08), and Mailpit arrived with Layer 1 (ADR-0018 K-14), each when it can first be exercised (ADR-0010). `.env.example`; one-command scripts. |
| Cloud IDE | GitHub Codespaces / VS Code Dev Container (`.devcontainer/`) with Node 24, pnpm and Docker; Claude Code on the web via a SessionStart hook that installs dependencies automatically |
| AI guardrails | `CLAUDE.md` with the Bible §30 Development Constitution, so every Claude session starts with the rules |
| CI | GitHub Actions: install, lint, typecheck, test, build, spec traceability, schema + DB behaviour suite on PostgreSQL 18 |
| **Exit** | A fresh clone installs and passes every check with one command locally, in Codespaces and in CI |

### Step 2: Design prototype (built; awaiting review)

| Deliverable | Detail |
|---|---|
| `apps/design-prototype` | React + Vite static prototype rendering the **core scenes** at true device sizes: provider iPad (landscape, sidebar), provider iPhone (tabs), patient iPhone, admin web. Hard-coded data only. |
| Core scenes | Sign-in · patient list/search · patient profile · consultation workspace · guided photo capture · before/after comparison · AI visualization review · treatment plan A/B/C · consent signing · messages · patient home · patient simulation view · patient plan · admin users & roles · admin audit |
| States | Loading, empty, error, permission-denied and offline variants [B §24.1] |
| `DESIGN_SYSTEM.md` | Principles, tokens, components, **interaction rules for intuitive controls** (§2, ADR-0005), adaptive iPad/iPhone layout, accessibility, view states, per-feature UI checklist |
| Guardrails | Clearly labelled *prototype*: no backend, no auth, never deployed as the product; original design only (no vendor trade dress) [B §0.1] |
| **Exit** | Owner reviews the scenes on iPad/iPhone-sized screens and approves the look, or lists changes |

### Step 3: Layer 0 completion (accepted 2026-09-28)

| Deliverable | Detail |
|---|---|
| Documentation pack | The Bible §31/§35 documents, explaining and linking the spec, which stays normative (ADR-0012): SYSTEM_ARCHITECTURE, REPOSITORY_STRUCTURE, DATABASE_SCHEMA, API_CONTRACTS, AUTHENTICATION_ARCHITECTURE, AUTHORIZATION_RBAC, PHOTO_ARCHITECTURE, AI_ARCHITECTURE, SECURITY_REQUIREMENTS, THREAT_MODEL (STRIDE per trust boundary), IOS_ARCHITECTURE, TESTING_STRATEGY, DEPLOYMENT, INFRASTRUCTURE, ACCEPTANCE_CRITERIA, plus the §35 extras |
| IaC skeleton | Terraform root modules per environment (dev/staging/prod), remote-state bootstrap, and minimal real modules for KMS, account baseline, network, storage, database and compute (not applied yet); `terraform validate` + `tflint` + `checkov` in CI (ADR-0014) |
| iOS skeleton | Tuist projects for ios-provider and ios-patient with the 20 Bible §24.4 modules as Swift packages and a checked tier graph, `DesignTokens.swift` from the token package, a macOS CI job that generates, builds and tests (ADR-0015) |
| API contracts skeleton | `packages/api-contracts` (Zod → OpenAPI 3.1 pipeline, `oasdiff` gate) with the error envelope and pagination primitives only |
| **Exit** | Bible §31 acceptance table: every Layer 0 deliverable PASS or DEFERRED BY SPECIFICATION; the repo initializes reproducibly. Result: `ACCEPTANCE_CRITERIA.md` §4 (all PASS), with 67 findings in §5 (14 fixed, the rest carried to their layer). |

---

## 4. Steps 4–13: Feature layers and their micro-prompts

Each row is one micro-prompt (M-number = layer.sequence). **Kickoff** lists the delegated decisions to re-confirm first.

### Step 4: Layer 1, Identity, Tenancy, Patients [B §32]

**Kickoff:** UD-16/17 permission keys & role matrix · UD-07 custom roles · UD-18 session/MFA defaults · UD-19 audit events · UD-24 retention · UD-27 rate limits · admin-web shell in this layer (the Bible's §32 list names only the iOS shell). **Confirmed by the owner on 2026-09-29:** every recommendation in [LAYER_1_KICKOFF.md](LAYER_1_KICKOFF.md), with the admin web shell included (ADR-0018).

| # | Micro-prompt | Proves |
|---|---|---|
| M1.1 | Database foundation: Layer 1 tables + constraint fragment + migrations, seed (permission catalog, role matrix, organization + admin), database roles, **RLS policies + performance benchmark** (ADR-0004 gate), per-layer split of the DB behaviour suite, model ownership classification (K-08, K-16, K-19) | Migrations run; seed works; RLS ≤ 10% / 5 ms. **Built 2026-09-29.** Search under RLS decided by ADR-0020 (leakproof search keys); every request is under 5 ms added; the 10% limit is judged end to end at M1.8 |
| M1.2 | API skeleton: NestJS/Fastify, config, request IDs, error envelope, PHI-safe logging, health endpoints, OpenAPI generation, contract-test harness; CodeQL, gitleaks and SHA-pinned actions in CI (K-21) | Error model and contract tests. **Built 2026-10-01** (ADR-0021) |
| M1.3 | Authentication: login, TOTP and passkey MFA (spec §6.3), rotating refresh, logout, sessions/devices, LoginEvent + audit, lockout, password reset and change, transactional email (SES; Mailpit locally) (K-11 to K-15) | Session revocation is immediate. **Built 2026-10-01** |
| M1.4 | Tenancy & authorization core: tenant context, permission guard, scoped repositories, `SET LOCAL`, cross-tenant test generator, ACCESS_DENIED | Cross-tenant access rejected. **Built 2026-10-01** |
| M1.5 | Organizations, practices, locations APIs | **Built 2026-10-01** |
| M1.6 | Users, memberships, invitations, roles, scoped assignments, separation-of-duties rules, admin session revocation and MFA reset, provider/staff profiles (K-05, K-07, K-12) | No self-grant; scope limits. **Built 2026-10-01** |
| M1.7 | Audit foundation: writer, query API, per-patient access report | Required audit events written. **Built 2026-10-01** |
| M1.8 | Patients: duplicate check, create (idempotent), POST search (name prefix, exact identifiers; ADR-0020), profile (PATIENT_VIEWED), update (If-Match), archive, contacts | Search and create work; ETag conflicts; **RLS gate end to end** on login, patient search and patient open (≤ 10% and ≤ 5 ms added p95; ADR-0004, ADR-0020). **Built 2026-10-01**; the gate passes in CI |
| M1.9 | iOS provider shell: Tuist app, DesignSystem module, generated API client, Keychain + Face ID, iPad split view / iPhone tabs, login UI | iOS builds; login works. **Built 2026-10-01** (ADR-0022) |
| M1.10 | iOS patients: list/search/create, profile shell with all 12 tabs (empty states) | Patient flows on device. **Built 2026-10-01**; UI tests on iPhone and iPad against the real api |
| M1.11 | Admin web shell (K-23): login, users & roles, audit viewer | Admin flows run against the Layer 1 API. **Built 2026-10-01**; Playwright against the real api |
| M1.12 | **Layer 1 acceptance:** the 15 Bible §32 criteria, then STOP | `ACCEPTANCE_CRITERIA.md` §6; **accepted by the owner 2026-10-01** |

### Step 5: Layer 2, Photography Core

**Kickoff:** UD-06 image-processing language · UD-21 permission granularity · UD-22 malware scanning · UD-25 offline cache. **Confirmed by the owner on 2026-10-01:** every recommendation in [LAYER_2_KICKOFF.md](LAYER_2_KICKOFF.md) (K2-01 to K2-22), recorded as ADR-0023.

| # | Micro-prompt |
|---|---|
| M2.1 | Storage ledger + media module: upload intents, checksum verification, signed URLs, write-once objects |
| M2.2 | Outbox relay + SQS/EventBridge wiring (moto locally), the audit WORM copy |
| M2.3 | Photography protocols: standard Face/Breast/Body protocols seeded per org; admin protocol editor |
| M2.4 | Photo sessions + uploads API (offline-capable client IDs) |
| M2.5 | iOS guided capture: AVFoundation camera, Vision pose/framing/blur/lighting checks, guidance codes, ghost overlay + position-match score |
| M2.6 | image-processing service: thumbnails and display previews as immutable derivatives |
| M2.7 | Photo gallery/viewer (iPad + iPhone), tags, PHOTO_VIEWED |
| M2.8 | Media permissions (versioned, per category) + media releases with permission pins |
| M2.9 | Offline capture queue, encrypted local store, offline audit replay |
| M2.10 | Feature flags, practice settings, retention policies |
| M2.11 | **Layer 2 acceptance:** standard photo session works end to end, then STOP |

### Step 6: Layer 3, Consultations & Before/After

**Kickoff:** UD-15 final notes · UD-28 consultation transitions · UD-33 completion preconditions.

| # | Micro-prompt |
|---|---|
| M3.1 | Consultation lifecycle + state machine + transition audit |
| M3.2 | Consultation workspace UI (iPad-first stepper following Bible §5.1) |
| M3.3 | Concerns, medical history, notes (offline drafts, FINAL immutability) |
| M3.4 | Annotations (vector layers; Apple Pencil on iPad) |
| M3.5 | Before/after sets (same-patient rule) + comparison viewer: side-by-side, swipe, cross-fade, blink, overlay, synced zoom/pan |
| M3.6 | Automatic registration job + manual alignment/reset |
| M3.7 | Export with purpose-specific permission (PHOTO_EXPORTED) |
| M3.8 | Documents + consultation summary generation; patient timeline |
| M3.9 | **Layer 3 acceptance** (incl. Bible §34.1 #12–21), then STOP |

### Step 7: Layer 4, Documents, Consent, Education, Treatment Plans

**Kickoff:** UD-11 estimate vs quote · UD-14 in-clinic acceptance · UD-23 void/minors · UD-31 staff-assisted signing.

| # | Micro-prompt |
|---|---|
| M4.1 | Treatment catalog (categories, treatments) + admin UI |
| M4.2 | Treatment plans A/B/C, items, server totals, state machine |
| M4.3 | Estimates (frozen snapshot + PDF), invoice references |
| M4.4 | Procedures |
| M4.5 | Consent template builder (admin web; the 13 block types) + versioning/publishing |
| M4.6 | Consent assignment + staff-assisted in-clinic signing + immutable snapshot + SHA-256 |
| M4.7 | Education CMS (versioned content) + assignment tracking |
| M4.8 | Instructions by procedure/consultation (acknowledgement vs clinical completion) |
| M4.9 | Patient data export jobs (async, audited, visible status) |
| M4.10 | **Layer 4 acceptance:** patient-facing plan/document workflow testable, then STOP |

### Step 8: Layer 5, Patient App & Messaging

**Kickoff:** UD-08 patient identity across organizations · UD-20 PATIENT_APP grant · UD-30 portal visibility.

| # | Micro-prompt |
|---|---|
| M5.1 | Patient invitations, account linking, patient authentication |
| M5.2 | Portal API namespace + deny-by-default visibility repositories |
| M5.3 | Patient iOS shell (Home + navigation, Bible §13.1) |
| M5.4 | Released consultations, photos/before-after, documents, instructions, procedures |
| M5.5 | Plans (view/accept/decline) and consent review/signing in the app |
| M5.6 | Secure messaging (threads, attachments with scanning, read state) staff + patient |
| M5.7 | Push/email/SMS notifications with generic text only |
| M5.8 | Photo requests + patient upload into quarantine + staff intake review |
| M5.9 | **Layer 5 acceptance:** patient securely sees only assigned/released records, then STOP |

### Step 9: Layer 6, Scheduling & Telehealth

**Kickoff:** UD-05 telehealth vendor (BAA).

| # | Micro-prompt |
|---|---|
| M6.1 | Appointment types + scheduling + state machine (iPad calendar, iPhone agenda) |
| M6.2 | Patient appointment view/propose |
| M6.3 | Telehealth vendor adapter + session lifecycle |
| M6.4 | Waiting room + in-call UI (mute, camera switch, share, consultation context) |
| M6.5 | **Layer 6 acceptance:** scheduled virtual consultation lifecycle works, then STOP |

### Step 10: Layer 7, AI Infrastructure

**Kickoff:** UD-04 inference hosting & model licensing.

| # | Micro-prompt |
|---|---|
| M7.1 | ai-gateway service + internal job contract + service authentication |
| M7.2 | Model registry, immutable versions, rollouts/rollback + admin UI |
| M7.3 | Private inference environment (GPU, no egress) + job runner |
| M7.4 | Input-quality, landmark and segmentation models with validation records |
| M7.5 | Validation harness: identity-similarity and artifact checks, regression datasets (governed, §7.7) |
| M7.6 | **Layer 7 acceptance:** versioned AI jobs with provenance, then STOP |

### Step 11: Layer 8, Outcome Simulation

**Kickoff:** UD-32 simulation-source grant · UD-29 transitions.

| # | Micro-prompt |
|---|---|
| M8.1 | Simulation lifecycle, parameters allow-list, provenance, audit |
| M8.2 | First category: **lip filler** visualization engine + identity-preservation tests |
| M8.3 | Provider review UI (approve / reject / regenerate) + separate release |
| M8.4 | Patient simulation view with the mandatory disclaimer |
| M8.5 | Next categories, one micro-prompt each, **only once validated**: rhinoplasty, neurotoxin, cheek/chin/jaw, facial lifts, breast/body, skin |
| M8.6 | **Layer 8 acceptance** (Bible §34.2 #22–31), then STOP |

### Step 12: Layer 9, Similar Cases & Outcome Analysis

**Kickoff:** UD-10 library permission & de-identification.

| # | Micro-prompt |
|---|---|
| M9.1 | Case library curation (release-authorized, de-identified display) |
| M9.2 | Similar-case search + "Similar Historical Cases" presentation + shown-case records |
| M9.3 | Outcome measurements on before/after sets |
| M9.4 | **Layer 9 acceptance**, then STOP |

### Step 13: Layer 10, Integrations

| # | Micro-prompt |
|---|---|
| M10.1 | Integration service + adapter interface + mappings + provenance |
| M10.2 | FHIR R4 adapter (patients, practitioners, appointments first) |
| M10.3 | Sync engine: idempotent upserts, conflicts, retries, dead letters |
| M10.4 | Admin integration monitoring UI |
| M10.5 | First partner vendor adapter |
| M10.6 | **Layer 10 acceptance:** selected integrations stable, then STOP |

---

## 5. Step 14: Production readiness [B §36]

Nothing goes live until every row is true:

- automated cross-tenant tests for every sensitive domain
- session expiry and revocation tested
- server-side permission checks on every sensitive endpoint
- immutable originals and private storage
- AI provenance and regression validation
- consent snapshots and hashes
- no sensitive push payloads
- critical audit events queryable
- PHI log filtering verified
- encrypted backups with a **tested restore**
- mandatory CI security gates
- operational and security alerting
- **BAAs, policies, retention and intended-use review completed for the actual deployment**

It also requires an external penetration test (required by ADR-0002) and the six Bible §26 runbooks.

---

## 6. What the owner does at each stop

1. Review the acceptance table (and, for UI steps, the screens).
2. Approve, or list changes.
3. Say "go" to start the next step.

Claude never proceeds automatically past a stop [B Appendix B].
