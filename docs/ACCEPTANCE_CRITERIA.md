# Acceptance criteria

| | |
|---|---|
| Version | 1.0 |
| Status | Layer 0 acceptance review, 2026-09-28. **Awaiting the owner's acceptance** (Bible Appendix B #37). |
| Authority | Bible §27.2 (definition of done), §29 (layer exit conditions), §30 (acceptance review and stop), §31 (Layer 0 kickoff and review), §32 (Layer 1 acceptance), §34 (representative criteria), §36 (production readiness), Appendix B |
| Normative sources | [TESTING_STRATEGY.md](TESTING_STRATEGY.md) §17–18 (review format and traceability to tests), spec §9.1 (what each layer must pass), [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) |

This document says what "done" means for each layer, records the Layer 0 kickoff report and acceptance review, and keeps the register of everything Layer 0 found that a later layer must resolve.

## 1. How acceptance works

1. **Every micro-prompt** meets the Bible §27.2 definition of done:
   - functional requirements and acceptance criteria met
   - server-side authorization and validation
   - audit events
   - the five non-normal view states (loading, empty, error, permission-denied, offline)
   - tested migrations and passing tests
   - updated docs and contracts
   - ADRs for material decisions
   - no hidden placeholders

   See [TESTING_STRATEGY.md](TESTING_STRATEGY.md#3-definition-of-done-per-micro-prompt).
2. **Every layer** ends with an acceptance review: a table with **PASS / FAIL / DEFERRED BY SPECIFICATION** for each exit criterion, with the evidence ([TESTING_STRATEGY.md](TESTING_STRATEGY.md#17-acceptance-review-format)).
3. **Then work stops.** The next layer starts only when the owner accepts the review (Bible §30, Appendix B #37–38).
4. **Before production**, every row of the Bible §36 readiness checklist must be true. It is mapped to requirements in [SECURITY_REQUIREMENTS.md](SECURITY_REQUIREMENTS.md).

## 2. Exit conditions by layer [B §29]

| Layer | Exit condition (Bible §29) | Detailed criteria | Tests |
|---|---|---|---|
| 0 Architecture foundation | Architecture pack accepted; repo can be initialized reproducibly | §4 below | CI: all jobs |
| 1 Identity, tenancy, patients | Cross-tenant tests pass; iOS login and patients work | Bible §32 acceptance #1–15 | Cross-tenant, authorization, separation-of-duties and DB suites; iOS UI tests |
| 2 Photography core | Standard photo session works end to end | spec §9.1 row 2 | Original immutability, checksum verification, permission independence, release pinning |
| 3 Consultations and before/after | Consultation with standardized imagery is functional | Bible §34.1 #12–21 | Before/after and consultation state-machine tests |
| 4 Documents, consent, education, plans | Patient-facing plan/document workflow is testable | spec §9.1 row 4 | Consent snapshot and hash, template versioning, plan state machine |
| 5 Patient app and messaging | Patient can securely access assigned/released records | spec §4.7 | Portal visibility tests; no PHI in push |
| 6 Telehealth and scheduling | Scheduled virtual consultation lifecycle works | spec §5.4.6, §5.4.8 | Appointment and telehealth state machines |
| 7 AI infrastructure | Versioned AI jobs with provenance | spec §9.1 row 7 | Provenance, rollback, validation harness |
| 8 Outcome simulation | Initial validated simulation categories | Bible §34.2 #22–31, [AI_SIMULATION_RULES.md](AI_SIMULATION_RULES.md) | Simulation review/release, disclaimer, identity preservation |
| 9 Similar cases | Permission-safe similar-case workflow | spec §9.1 row 9 | Permission-safe library |
| 10 Integrations | Selected partner integrations stable | spec §5.4.9 | Idempotent upsert, conflict surfacing, no silent loss |
| 11 3D digital patient | Separate approved product expansion | Not planned | — |

Each Bible §32 and §34 item is traced to a planned test location in [TESTING_STRATEGY.md](TESTING_STRATEGY.md#18-traceability-to-acceptance-criteria).

## 3. Layer 0 kickoff report [B §31 A–E]

Bible §31 asks for this report before files are created. The specification phase (steps 0–2) produced most of it; Layer 0 completes it.

**A. Assumptions.**
- The spec §10.1 assumptions still hold:
  - US-only AWS under a BAA
  - English UI with externalized strings
  - pilot at about 10 practices, not blocking about 1,000
  - one shared multi-tenant deployment
  - photographs only as clinical media
  - commercially licensable, privately run AI
- Layer 0 adds these:
  - Each environment runs in its own AWS account.
  - The code is hosted on GitHub and CI runs on GitHub Actions, with macOS 26 runners for iOS.
  - Nothing is applied to AWS and nothing is released to Apple until the open items in §5 are decided.

**B. Unresolved decisions.**
- The owner decided D-01 to D-07.
- The 26 delegated decisions keep their working baselines in spec §10.2 and are re-confirmed at the kickoff of their layer.
- Layer 0 added UD-34 (Apple team and bundle identifier prefix).
- Every Layer 0 finding that needs a decision is in the register in §5, with the layer that decides it.

**C. Final architecture choices.**
- The tech stack is in spec §2.
- The decisions are ADR-0001 to ADR-0017. Layer 0 added:
  - ADR-0012: documentation pack
  - ADR-0013: API contract tooling
  - ADR-0014: AWS baseline
  - ADR-0015: iOS modules
  - ADR-0016: CI security gates
  - ADR-0017: errata

**D. Files created.** Summarized in §4; the tree and the state of each part are in [REPOSITORY_STRUCTURE.md](REPOSITORY_STRUCTURE.md).

**E. Risks.**
- The spec §10.4 risk register now has three more rows: human production access, supply chain, and malicious image files.
- Layer 0 adds three risks of its own:
  - The Terraform has only been checked statically. The first `apply` may surface account-specific issues, so it is planned and reviewed in dev first.
  - Apple toolchain drift. Tuist and Xcode versions are pinned, and CI shows any break.
  - The repository is public while the Bible is marked confidential (F-56).

## 4. Layer 0 acceptance review [B §31]

### 4.1 Deliverables

| # | Deliverable | Result | Evidence |
|---|---|---|---|
| 1 | SYSTEM_ARCHITECTURE.md | PASS | [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md); references checked by `check_docs.py` |
| 2 | ARCHITECTURE_DECISIONS.md | PASS | 17 ADRs, the six Layer 0 decisions included |
| 3 | REPOSITORY_STRUCTURE.md | PASS | Matches the Bible §31/§35 tree |
| 4 | DATABASE_SCHEMA.md | PASS | ER diagrams per domain; RLS approach; migration workflow |
| 5 | Initial Prisma schema | PASS | `docs/technical-spec/schema.prisma`: 87 models, validated by Prisma 7.10. Tables move into `packages/database` layer by layer (spec §5.8). The database behaviour suite passes 90/90 on PostgreSQL 18 in CI. |
| 6 | API_CONTRACTS.md | PASS | Plus `packages/api-contracts`: Zod → OpenAPI 3.1, 18 tests, drift and oasdiff gates |
| 7 | AUTHENTICATION_ARCHITECTURE.md | PASS | Flows as sequence diagrams; open items listed |
| 8 | AUTHORIZATION_RBAC.md | PASS | Spec §4.6 algorithm reproduced verbatim; defence-in-depth layers |
| 9 | PHOTO_ARCHITECTURE.md | PASS | Capture → upload → verify → derive; permissions; release pinning |
| 10 | AI_ARCHITECTURE.md | PASS | Isolation, registry, provenance, governance |
| 11 | SECURITY_REQUIREMENTS.md | PASS | 173 testable requirements; Bible §36 mapping |
| 12 | THREAT_MODEL.md | PASS | STRIDE across 14 trust boundaries; 10 abuse cases |
| 13 | IOS_ARCHITECTURE.md | PASS | Plus the Tuist projects and the 20-module graph |
| 14 | DESIGN_SYSTEM.md | PASS | Intuitive-controls rules C1–C15; tokens; view states |
| 15 | TESTING_STRATEGY.md | PASS | Test levels, CI gates, traceability tables |
| 16 | DEPLOYMENT.md | PASS | Release paths, migrations, runbooks |
| 17 | INFRASTRUCTURE.md | PASS | Plus `infrastructure/terraform` (validate, tflint and checkov clean) |
| 18 | ACCEPTANCE_CRITERIA.md | PASS | This document |
| 19 | CHANGELOG.md | PASS | Entries for every step |
| 20 | Monorepo skeleton, no fake business implementation | PASS | [REPOSITORY_STRUCTURE.md](REPOSITORY_STRUCTURE.md) §2. Services hold only READMEs naming their layer. iOS modules hold documented boundaries only. |
| §35 | SOFTWARE_PRODUCTION_BIBLE.md, PRODUCT_REQUIREMENTS.md, USER_ROLES_AND_PERMISSIONS.md, WORKFLOWS.md, AI_SIMULATION_RULES.md, PHOTO_PROTOCOLS.md, CONSENT_ARCHITECTURE.md, EMR_INTEGRATIONS.md | PASS | Bible export generated from the PDF and drift-checked; the others are checked by `check_docs.py` |

Nothing is FAIL or DEFERRED BY SPECIFICATION among the deliverables.

### 4.2 Architecture requirements [B §31]

In Layer 0 each requirement is met *by design*; each is built and tested in the layer named.

| Requirement | How it is met | Built in | Result |
|---|---|---|---|
| Multi-tenant organization/practice/location model | Token-bound tenant, composite tenant foreign keys, RLS (ADR-0004), D-01 boundary | L1 | PASS (design; DB behaviour suite already proves the foreign-key isolation) |
| Server-side permission authorization | Spec §4.6 algorithm in the request pipeline; generated cross-tenant and role-matrix tests | L1 | PASS (design) |
| PostgreSQL plus migrations | Prisma Migrate with per-layer constraint fragments; fresh-database CI check | L1 | PASS |
| Immutable original photo architecture | Database triggers (AE001), versioned buckets, deletes denied on clinical media | L2 | PASS (triggers tested; bucket policy in Terraform) |
| Secure object storage and signed access | Private buckets, SSE-KMS, presigned URLs of 10 minutes / 120 seconds, opaque keys | L2 | PASS (design and Terraform) |
| Versioned APIs | `/api/v1`, additive-only changes, oasdiff gate in CI | L1 | PASS (gate live) |
| AI services isolated behind authenticated internal APIs | `/internal/v1`, private subnets, opaque object references, no database access | L7 | PASS (design) |
| Audit/event architecture | Append-only `AuditEvent`, transactional outbox, WORM copy | L1–L2 | PASS (design; append-only proven in the DB suite) |
| Offline-safe iOS architecture | Encrypted store, mutation queue with idempotency keys, conflict surfacing (spec §8) | L1–L2 | PASS (design) |
| IaC | Terraform for three environments plus bootstrap; CI static checks | L0 | PASS |
| DTO/persistence separation | `packages/api-contracts` holds all DTOs; Prisma types never cross the API boundary | L0 onward | PASS |

### 4.3 Reproducible initialization [B §29, §31]

Prerequisites:
- **Everything:** Git.
- **The workspace:** Node 24.21.0 and corepack (pnpm 12.6.0 comes from the `packageManager` field).
- **The database checks:** Python 3 with `pypdf`, and Docker (or any PostgreSQL ≥ 15).
- **The iOS projects:** macOS with Xcode 26.6 and mise (Tuist 4.209.0).
- **Infrastructure checks:** Terraform 1.16.4, tflint 0.64.0 and checkov 3.3.20.

Codespaces and Claude Code on the web install the workspace prerequisites automatically (`.devcontainer/`, `.claude/hooks/session-start.sh`).

```bash
git clone https://github.com/cgibson24/Aestara.git && cd Aestara
corepack enable && pnpm install --frozen-lockfile
pnpm check                                      # lint, typecheck, 254 tests, build
pip install pypdf && pnpm verify:spec           # 58/58 Bible → spec traceability checks
python3 docs/technical-spec/verification/check_docs.py
pnpm services:up && DATABASE_URL=postgresql://aestara:aestara_local_only@localhost:5432/aestara pnpm verify:schema   # on an empty database: 90/90
python3 apps/ios-provider/scripts/check_module_graph.py
# macOS only:
mise install && (cd apps/ios-provider && tuist generate) && (cd apps/ios-patient && tuist generate)
```

CI runs these same steps on every push: jobs `workspace`, `spec`, `terraform`, `security` and `ios`. A green run on a fresh checkout is the evidence that the repository initializes reproducibly.

**Layer 0 exit condition:** the repository initializes reproducibly (PASS: CI green on a fresh checkout). The architecture pack is complete and awaits the owner's acceptance.

## 5. Layer 0 findings register

Writing and cross-checking the pack against the Bible, the spec and the schema surfaced these findings. Clear errors were fixed in Layer 0 under ADR-0017. Everything that needs a design decision is carried to the kickoff of the layer that first needs it, with a recommended resolution. The recommendation is **not** adopted until that kickoff confirms it (Bible §0.1).

### 5.1 Fixed in Layer 0

| ID | Finding | Resolution |
|---|---|---|
| F-01 | `SimulationParameter.unit` contradicted spec §6.6.3 and Bible §9.6 (no units by construction) | Field removed; new traceability check forbids dose, unit, product or technique fields |
| F-02 | Spec §1.5 said "no cross-practice sharing" without the D-01 boundary | Now "no sharing across organizations" (D-01) |
| F-03 | Spec §6.1.1 pointed to §6.7 for contract tooling | Now §6.8 |
| F-04 | Spec §2.1 called APNs an AWS service | Corrected |
| F-05 | "Byte-identical" 404 bodies are impossible with a per-request `requestId` | Spec §7.5 compares bodies apart from `requestId` |
| F-06 | V7 `MATCH SIMPLE` audit was manual; spec §11 said the suite ran on PostgreSQL 16 | V7 automated in the suite (90 checks); CI runs PostgreSQL 18 |
| F-07 | Stale schema comments (UD-02, UD-13, protocol seeding, "Layer 0 promotes the schema") | Corrected |
| F-08 | Broken contents link to spec §8 | Fixed (found by `check_docs.py`) |
| F-09 | DESIGN_SYSTEM C13 said "staff Face ID"; spec says staff re-authentication | Aligned (UD-31) |
| F-10 | Roadmap M1.3 omitted passkeys, which spec §6.3 puts in Layer 1 | Roadmap aligned to the spec |
| F-11 | Spec §10.4 lacked the risks of human production access, supply-chain compromise and malicious images | Rows added |
| F-12 | No dependency scanning in CI (Bible §28.2) | OSV-Scanner job and Dependabot added (ADR-0016) |

### 5.2 Carried to the Layer 1 kickoff (identity, tenancy, patients, platform)

| ID | Finding | Recommended resolution |
|---|---|---|
| F-13 | ADR-0002 says MFA is required for admin roles; Bible §21.1 says "according to deployment policy" | MFA is always required for admin roles; organization policy may only strengthen it (UD-18) |
| F-14 | Separation-of-duties rule 2 (spec §4.5) forbids a platform actor granting any role with a `consent.*` key, but ORGANIZATION_ADMIN holds `consent.template.manage`, so the first organization admin cannot be created | Limit rule 2 to clinical consent actions (signing, voiding); create the first admin through an audited platform bootstrap action |
| F-15 | SUPER_ADMIN holds `practice.read`, `user.*`, `integration.read`, but spec §4.6 says the platform branch reaches no tenant data | Platform permissions return organization metadata only, never patient data |
| F-16 | The patient invitation token travels in a URL path (spec §6.5), against spec §6.1.10 | Send the token in the request body |
| F-17 | A practice-scoped PRACTICE_ADMIN can update or disable users of other practices (spec §4.6 else-branch) | User management is limited to users whose memberships fall inside the admin's scope |
| F-18 | Location-scoped writes need a location on the record: TreatmentPlan has none, and it is optional on several models. Models with an optional `practiceId` are not classified as practice-owned or not. | Classify every model; add `locationId` where location scoping must apply |
| F-19 | Spec §4.6 audits `ACCESS_DENIED` on every denial; spec §7.3 says sensitive endpoints only | Audit denials on all PHI routes, with rate limiting |
| F-20 | `PatientUserLink` allows several patient records per login in one organization; spec §4.7 assumes one | One patient per login per organization, or an explicit patient picker (with UD-08) |
| F-21 | Admin SPA cookie contents and the "PKCE-style proof" are not defined against the direct `/auth/login` exchange | Define both in M1.3 |
| F-22 | MFA policy is per organization, but sign-in happens before an organization is chosen | Apply the strictest policy across the user's active memberships |
| F-23 | Session revocation is unscoped for users in several organizations | An organization admin revokes only sessions bound to that organization |
| F-24 | `LOGIN_FAILURE` for an unknown identifier cannot satisfy the audit actor CHECK | Record it as an anonymous actor, with the hashed identifier kept in `LoginEvent` only |
| F-25 | Staff invites and password reset need email in Layer 1; the notifications service arrives in Layer 5 | The api sends templated transactional email (no PHI) through SES from Layer 1; Mailpit joins local compose in Layer 1 |
| F-26 | RLS policy design is open: membership lookups before a tenant is chosen, tables with a nullable organization, platform access without `BYPASSRLS`, worker tenant context, `FORCE`, `SET LOCAL` through Prisma | Designed in M1.1 together with the performance gate (ADR-0004) |
| F-27 | Account recovery, lockout thresholds, a password-change endpoint, and audit events for MFA changes, password reset and organization switch are unspecified | Specify in M1.3 |
| F-28 | `UserRole.roleId` references `Role(id)` alone, so a custom role (UD-07) could be assigned across organizations | Composite key when custom roles are enabled |
| F-29 | Spec §6.1.8 lists patient creation as offline-queueable; Bible §4.1 needs a server duplicate check, and Bible §23.1 does not list it | Patient creation is online-only |
| F-30 | Layer 1 has no WORM audit copy until the outbox arrives in Layer 2 (spec §7.3) | Accept for Layer 1 (append-only triggers and grants), or bring the outbox forward |
| F-31 | The database behaviour suite is one file, but spec §9.1 expects per-layer fragments | Split it by layer in M1.1 |
| F-32 | Platform prerequisites (see the list after this table) | Decide at the Layer 1 kickoff |
| F-33 | Bible §1 names success criteria without measurable targets | The owner sets pilot success metrics |

F-32 covers these platform prerequisites:
- AWS account IDs, the BAA, domains and certificates
- CI-to-AWS authentication (GitHub OIDC proposed)
- UD-34 (Apple team and bundle IDs)
- pinning GitHub Actions to commit SHAs
- the secret-scanning and SAST tools
- the container-scan threshold
- the design for human production access
- the iOS Keychain accessibility class, app-switcher privacy and jailbreak signals
- the SwiftUI snapshot tool

### 5.3 Carried to later layers

| ID | Layer | Finding | Recommended resolution |
|---|---|---|---|
| F-34 | 2 | The PatientPhoto machine has no path for an infected or failed malware scan; "protocol frozen when ACTIVE" is enforced by the API only | Add a quarantine path; add a freeze trigger |
| F-35 | 2 | Unspecified photo details (see the list after this table) | Specify in the Layer 2 micro-prompts |
| F-36 | 2, 5 | The effect of revoking a permission on releases that already exist | Revocation hides released items at read time (Bible §7.3) |
| F-37 | 3 | Consultation completion requires "release decision recorded", but there is no column for it, and `/release` arrives in Layer 5 while `/complete` arrives in Layer 3 | Model the decision explicitly in Layer 3 |
| F-38 | 4 | The UD-23 baseline names a GUARDIAN signer, but `SignerRole` has no such value | Add it if minors are in scope |
| F-39 | 4 | Consent "prepare"/"supersede" and snapshot access URLs have no audit event in spec §6.3 | Add them |
| F-40 | 4 | UD-14 sibling auto-decline has no transition in spec §5.4.3 | Add a system transition |
| F-41 | 4 | The actor of staff-assisted signing and `ConsentSignature.signerUserId` for patients without an account | Define in Layer 4 (UD-31) |
| F-42 | 4 | The instruction-release permission is ambiguous; plan `/schedule` links appointments that arrive in Layer 6 | Clarify in Layer 4 |
| F-43 | 4 | Consent details are unspecified: block requiredness, signature transfer, hash canonicalization, snapshot layout, hand-off lifetime, void policy, discarding an unused draft | Specify in the Layer 4 micro-prompts |
| F-44 | 5, 8 | Spec §4.7 shows released simulations without checking the current PATIENT_APP grant at read time; Bible §7.3 and UD-20 require the check | The Bible wins: check the grant at read time, as for photos |
| F-45 | 5 | Message DELIVERED, READ and FAILED have no audit events, and what marks a message DELIVERED is undefined | Define in Layer 5 |
| F-46 | 6 | The action that moves telehealth from SCHEDULED to WAITING is undefined | Define in Layer 6 |
| F-47 | 7 | The AI job contract passes `modelKey`, but the version is fixed at `/generate`; progress events are missing | Pass `modelVersionId`; add started/validating events |
| F-48 | 7 | Dataset and governance-approval entities (spec §7.7) are not in the spec §5.8 Layer 7 row | Add them to the Layer 7 schema |
| F-49 | 7 | The model registry has no status transition table, no registration endpoint, and no database check that a version is VALIDATED before activation | Add all three in Layer 7 |
| F-50 | 7 | Where evaluation datasets with real images are processed, given synthetic-only lower environments | Decide with UD-04 |
| F-51 | 7–9 | Rollout precedence, TIMED_OUT/CANCELLED mapping, embedding store, de-identification method, whether FLAG results can be approved, pinned grants for a simulation release | Decide at the Layer 7–9 kickoffs |
| F-52 | 10 | HL7 is missing from `IntegrationKind`; no decision exists for the first EMR vendors; sync and dead-letter transitions, a resolve endpoint and retry backoff are unspecified | Decide at the Layer 10 kickoff |
| F-53 | Pre-prod | The second US region for backups, RPO/RTO, SLO and load targets, DDoS protection beyond WAF | Production readiness (roadmap step 14) |
| F-54 | 5, 10 | The runtime language of the notifications and integration services | Decide at their layer's kickoff |
| F-55 | 1, 3, 5 | Patient INACTIVE/DECEASED transitions, the consultation cancellation policy, patient-app offline caching | Decide at the kickoff of each layer |
| F-56 | Owner | The repository is public, but the Bible is marked "Confidential Product Specification" | The owner decides the repository's visibility |

F-35 covers these photo details:
- resumable upload and upload-URL renewal
- size limits
- derivative retry
- which bucket holds each object class
- the compatible-view rule
- UD-21 precedence
- scanning of provider captures
- protocol view keys and required flags
- quality thresholds
- the source image for the ghost overlay

Each carried finding also appears in the relevant document's open items. The layer kickoff in [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) reviews this register.

## 6. Sign-off

Layer 0 is complete when the owner accepts §4 and has read §5. Until then no Layer 1 work starts (Bible §30, Appendix B #37–38).
