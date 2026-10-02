# Acceptance criteria

| | |
|---|---|
| Version | 1.0 |
| Status | Layer 0 acceptance review, 2026-09-28: **accepted by the owner on 2026-09-28** (Bible Appendix B #37). Layer 1 acceptance review, 2026-10-01 (§6): **accepted by the owner on 2026-10-01**. Layer 2 acceptance review, 2026-10-02 (§7): **awaiting the owner's sign-off**. |
| Authority | Bible §27.2 (definition of done), §29 (layer exit conditions), §30 (acceptance review and stop), §31 (Layer 0 kickoff and review), §32 (Layer 1 acceptance), §34 (representative criteria), §36 (production readiness), Appendix B |
| Normative sources | [TESTING_STRATEGY.md](TESTING_STRATEGY.md) §17–18 (review format and traceability to tests), spec §9.1 (what each layer must pass), [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) |

This document says what "done" means for each layer, records the Layer 0 kickoff report and the Layer 0, Layer 1 and Layer 2 acceptance reviews, and keeps the register of findings a later layer must resolve.

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
| F-57 | Spec §5.3 ER diagram used cardinalities that contradict the schema (the photo-session link is optional; a storage object is not always a photo) | Diagram corrected |
| F-58 | The Layer 0 CloudTrail bucket had no Object Lock (spec §7.1) | Object Lock added: compliance mode in staging and production, governance mode in dev (ADR-0014). The separate security account is carried as F-59. |

### 5.2 Carried to the Layer 1 kickoff (identity, tenancy, patients, platform)

The owner confirmed the Layer 1 kickoff on 2026-09-29 (ADR-0018, [LAYER_1_KICKOFF.md](LAYER_1_KICKOFF.md)). Each finding's disposition names the decision (K-nn) and where it is built or specified. "Resolved" means the spec now states the rule. "Scheduled" means the named micro-prompt delivers and tests it.

| ID | Finding | Disposition (ADR-0018) |
|---|---|---|
| F-13 | ADR-0002 says MFA is required for admin roles; Bible §21.1 says "according to deployment policy" | **Resolved** (K-03): MFA is always required for admin roles and the admin web; organization policy may only strengthen it (spec §4.2). |
| F-14 | Separation-of-duties rule 2 (spec §4.5) forbids a platform actor granting any role with a `consent.*` key, but ORGANIZATION_ADMIN holds `consent.template.manage`, so the first organization admin cannot be created | **Resolved** (K-05): rule 2 covers clinical consent actions only; an audited platform bootstrap creates the first admin (spec §4.5, §6.3). Built in M1.5. |
| F-15 | SUPER_ADMIN holds `practice.read`, `user.*`, `integration.read`, but spec §4.6 says the platform branch reaches no tenant data | **Resolved** (K-06): platform permissions reach organization metadata only (spec §4.6); the platform database role has no access to patient or clinical tables (spec §3.5). Built in M1.1. |
| F-16 | The patient invitation token travels in a URL path (spec §6.5), against spec §6.1.10 | **Resolved** (K-09): every token travels in a request body (spec §6.1.10, §6.5). |
| F-17 | A practice-scoped PRACTICE_ADMIN can update or disable users of other practices (spec §4.6 else-branch) | **Resolved** (K-07): spec §4.5 rule 3 and §4.6. Built in M1.6. |
| F-18 | Location-scoped writes need a location on the record: TreatmentPlan has none, and it is optional on several models. Models with an optional `practiceId` are not classified as practice-owned or not. | **Resolved for Layer 1** (K-08): M1.1 classified and tested every Layer 1 model (`packages/database/src/ownership.ts`; DATABASE_SCHEMA.md §6.3). Later models are classified in their layer; the plan location question stays with Layer 4. |
| F-19 | Spec §4.6 audits `ACCESS_DENIED` on every denial; spec §7.3 says sensitive endpoints only | **Resolved** (K-10): denials on routes that touch patient data, with identical repeats collapsed (spec §4.6, §7.3). Built in M1.4. |
| F-20 | `PatientUserLink` allows several patient records per login in one organization; spec §4.7 assumes one | **Deferred to Layer 5** (K-24), together with UD-08. |
| F-21 | Admin SPA cookie contents and the "PKCE-style proof" are not defined against the direct `/auth/login` exchange | **Resolved** (K-11): no PKCE; refresh cookie and `Origin` check defined (spec §4.2). Built in M1.3. |
| F-22 | MFA policy is per organization, but sign-in happens before an organization is chosen | **Resolved** (K-03): the strictest policy among active memberships applies (spec §4.2). |
| F-23 | Session revocation is unscoped for users in several organizations | **Resolved** (K-12): spec §4.2 and §6.3. Built in M1.3 and M1.6. |
| F-24 | `LOGIN_FAILURE` for an unknown identifier cannot satisfy the audit actor CHECK | **Resolved** (K-13): recorded in `LoginEvent` only (spec §4.2). |
| F-25 | Staff invites and password reset need email in Layer 1; the notifications service arrives in Layer 5 | **Resolved** (K-14): the api sends templated transactional email (no PHI) through SES; Mailpit joins local compose. Built in M1.3. |
| F-26 | RLS policy design is open: membership lookups before a tenant is chosen, tables with a nullable organization, platform access without `BYPASSRLS`, worker tenant context, `FORCE`, `SET LOCAL` through Prisma | **Built** (K-16) in M1.1 (ADR-0019). Search under RLS decided by ADR-0020: leakproof search keys, no RLS bypass. The ≤ 5 ms limit passes; the 10% limit is judged end to end at M1.8. |
| F-27 | Unspecified: account recovery, lockout thresholds, a password-change endpoint, audit events for MFA changes, password reset and organization switch, and the meaning of the `MFA_REQUIRED` login-failure reason | **Resolved** (K-04, K-15): spec §4.2 "Passwords and recovery", the new endpoints in §6.3, `SECURITY_CREDENTIAL_CHANGED` and `ORGANIZATION_SWITCHED` in §7.3, the `UserToken` table, and `MFA_CHALLENGE_ISSUED` as a sign-in step. Built in M1.3. |
| F-28 | `UserRole.roleId` references `Role(id)` alone, so a custom role (UD-07) could be assigned across organizations | **Resolved for Layer 1** (K-02): system roles only. The composite key arrives when custom roles are enabled. |
| F-29 | Spec §6.1.8 lists patient creation as offline-queueable; Bible §4.1 needs a server duplicate check, and Bible §23.1 does not list it | **Resolved** (K-17): patient creation is online-only (spec §6.1.8). |
| F-30 | Layer 1 has no WORM audit copy until the outbox arrives in Layer 2 (spec §7.3) | **Accepted for Layer 1** (K-18): append-only triggers and insert/select-only grants; the WORM copy arrives with the Layer 2 outbox (spec §7.3). |
| F-31 | The database behaviour suite is one file, but spec §9.1 expects per-layer fragments | **Resolved** (K-19): split into per-layer fragments in M1.1 (`docs/technical-spec/verification/behavior/`). |
| F-32 | Platform prerequisites (see the list after this table) | **Partly resolved** (K-21, K-22). Each remaining item is scheduled in the list after this table. |
| F-33 | Bible §1 names success criteria without measurable targets | **Open, owner input.** Needed before the pilot; does not block Layer 1. |
| F-59 | Spec §7.1 delivers CloudTrail to a bucket in a separate security account; Layer 0 uses the environment's own account | **Open, owner input.** Decided with the AWS account structure before the first deployment; does not block Layer 1. |

F-32 covers these platform prerequisites, each now resolved or scheduled:
- **AWS account IDs, the BAA, domains and certificates:** owner input before the first deployment.
- **CI-to-AWS authentication (GitHub OIDC proposed):** decided with the AWS accounts, before the first deployment.
- **UD-34 (Apple team and bundle IDs):** owner input before the first TestFlight build.
- **Pinning GitHub Actions to commit SHAs:** resolved (K-21); done in M1.2.
- **The secret-scanning and SAST tools:** resolved (K-21): gitleaks and CodeQL, added in M1.2. Trivy arrives with the first container image.
- **The design for human production access:** decided before the first deployment.
- **The iOS Keychain accessibility class and biometric flags:** resolved (K-22, spec §4.2).
- **App-switcher privacy and jailbreak signals:** resolved in M1.9 (ADR-0022): a privacy cover; no jailbreak detection, with App Attest reconsidered in Layer 5.
- **The SwiftUI snapshot tool:** moved to Layer 2 with the first clinical screens (ADR-0022); Layer 1 screens are covered by UI tests.

### 5.3 Carried to later layers

| ID | Layer | Finding | Recommended resolution |
|---|---|---|---|
| F-34 | 2 | The PatientPhoto machine has no path for an infected or failed malware scan; "protocol frozen when ACTIVE" is enforced by the API only | **Resolved** (ADR-0023 K2-05, K2-10): every source passes `QUARANTINED`, a failed scan rejects; triggers enforce the photo machine and the protocol freeze (C11–C14) |
| F-35 | 2 | Unspecified photo details (see the list after this table) | **Resolved** (ADR-0023 K2-02 to K2-04, K2-06, K2-09, K2-11, K2-12, K2-15), except the compatible-view rule, which stays with Layer 3 (M3.5) |
| F-36 | 2, 5 | The effect of revoking a permission on releases that already exist | **Resolved** (ADR-0023 K2-15): a change that ends a release's effective grant revokes the release; every use re-checks at read time |
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
| F-60 | 5 | Spec §6.3/§6.5 have no staff endpoint or permission for inviting a patient, though `PatientUserLink.invitedById` implies one | Add the endpoint and permission in Layer 5 |
| F-61 | 2 | The spec §7.1 VPC-endpoint bucket condition and the spec §7.4 denial of overwriting existing keys are not yet in Terraform | **Resolved** (ADR-0023 K2-09, ADR-0024): the clinical-media policy refuses a `PUT` without `If-None-Match: *` and object access outside the S3 endpoint, except for the presigning role and GuardDuty |
| F-62 | 7 | GPU inference needs a subnet tier with no internet egress (spec §2.1); the Layer 0 private subnets route through NAT | Add the tier in Layer 7 (UD-04) |
| F-63 | 2 | Spec §5.4 has no photography-protocol state machine (the lifecycle is read from `/activate` and `/retire`) | **Resolved** (ADR-0023 K2-10): spec §5.4.10 |
| F-64 | 3 | Whether consultation transitions other than sign-off and release may be queued offline | Decide in Layer 3 |
| F-65 | 4 | Whether education and instruction assignments may reference only PUBLISHED content versions | Decide in Layer 4 |
| F-66 | 2 | How archived photos are shown in lists | **Resolved** (ADR-0023 K2-14) |
| F-67 | 2 | Who manages platform-wide feature-flag defaults (`configuration.manage` is held by organization and practice admins) | **Resolved** (ADR-0023 K2-18): defaults in code; no platform-wide rows in Layer 2 |
| F-68 | Owner, 3 | The K2-21 snapshot tests need reference images. This environment cannot record them: they are rendered on a Mac with Xcode, and the first run of each test records its image and fails by design | The owner chooses one: record the references on a Mac and commit them, or allow a CI job to record missing references and commit them to the branch (a workflow with write access to the repository). The snapshot tests then join the `ios` job (ADR-0025) |
| F-69 | Pre-clinical use | The camera path (AVFoundation capture, Vision face and body detection, Core Motion tilt) runs only on a device; CI exercises capture through the synthetic frame source. The sign of Vision's yaw is flipped to the protocol's convention by reasoning, not by measurement | Before first clinical use, capture each standard view on an iPhone and an iPad and confirm the guidance (in particular PATIENT_TURN_LEFT and RIGHT) and the recorded pose (ADR-0025) |

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

## 6. Layer 1 acceptance review [B §32]

Layer 1 (identity, tenancy, patients) was built in micro-prompts M1.1 to M1.11 on the branch `claude/jolly-keller-qmwt2o` (ADR-0018 to ADR-0022); this review is M1.12. Evidence is the test named and the CI job that runs it on every push, and the final run is [CI run 41](https://github.com/cgibson24/Aestara/actions/runs/36863057081) on commit `c2cd6ec`, green in all seven jobs; the numbers are the Bible's own. Format: [TESTING_STRATEGY.md](TESTING_STRATEGY.md#17-acceptance-review-format); planned locations: [TESTING_STRATEGY.md](TESTING_STRATEGY.md#181-layer-1-acceptance-b-32).

### 6.1 The fifteen criteria

| # | Criterion (Bible §32) | Evidence | Result | Notes |
|---|---|---|---|---|
| 1 | Local database starts | `docker-compose.yml` (PostgreSQL 18 with a health check; Mailpit); CI starts PostgreSQL 18 with a health check in the `database`, `api` and `spec` jobs, and on the macOS runner for the UI tests | PASS | The documented local start is `pnpm services:up` |
| 2 | Migrations execute | `packages/database/scripts/test-database.sh`: the five Layer 1 migrations as a non-superuser migration user on an empty database, then no drift, `check-rls.ts` and 61 database checks (CI `database` job); every api, e2e and UI test run migrates a fresh database the same way | PASS | |
| 3 | Seed creates an organization and admin | `test-database.sh` step 4: one organization, practice and location; the invited ORGANIZATION_ADMIN with a pending invitation; three `SYSTEM` audit rows; the catalog (53 permissions, 10 system roles, 139 grants); a second run changes nothing | PASS | Synthetic data only; refuses non-local databases |
| 4 | Admin can authenticate | `services/api/test/auth.test.ts` (password, TOTP, lockout, refresh rotation and reuse, revocation); `apps/admin-web/e2e/portal.spec.ts` against the real api: the seeded administrator accepts the invitation, enrolls an authenticator and signs in, then adds a passkey and signs in with it (Chromium's virtual authenticator) | PASS | MFA is required for admin roles (K-03) |
| 5 | Authorized staff can create a patient | `services/api/test/patients.test.ts` (duplicate check, `confirmNoDuplicate`, idempotent create, permission and scope); `ProviderFlowTests` creates a patient through the app | PASS | Online only (K-17) |
| 6 | Authorized provider can open an allowed patient | `patients.test.ts` (profile with the twelve tabs and their readability, `PATIENT_VIEWED`); the generated cross-tenant tests answer `404 PATIENT_NOT_FOUND` for another organization's patient (patients are shared across the practices of one organization, D-01); `ProviderFlowTests` opens the new patient | PASS | |
| 7 | Cross-tenant access is rejected server-side | `services/api/test/authorization.test.ts`: tests generated from the endpoint registry for every tenant-scoped operation (other organization → 404 with an identical body, missing permission → 403 or 404); the RLS suite (`packages/database/test/sql/rls.sql`); explicit tenant filter plus forced RLS (ADR-0021) | PASS | 100% of the 62 operations are in the registry the generator reads |
| 8 | Patient search works | `patients.test.ts` (`POST /patients/search`: name prefix, exact date of birth, email, phone, MRN; tenant-scoped; no term in the URL); RLS check S21 (the index is used under the tenant policy); `ProviderFlowTests` finds the new patient by name | PASS | ADR-0020 leakproof keys; RLS gate passes end to end |
| 9 | Patient profile shell opens | `ProviderFlowTests` on iPhone and iPad: all twelve tabs present, the Photos tab shows its empty state | PASS | CI `ios` job, UI tests against the real api (run 41) |
| 10 | Audit events are written | `services/api/test/audit-events.test.ts`: each of the 11 Bible §32 events and the Layer 1 additions (`ROLE_REVOKED`, `ORGANIZATION_SWITCHED`, `SECURITY_SESSION_REVOKED`) with actor, organization, resource and outcome, and no demographics in patient events; `ACCESS_DENIED`, `CONFIGURATION_CHANGED` and `SECURITY_CREDENTIAL_CHANGED` in the authorization and administration tests; append-only enforced by the database | PASS | |
| 11 | Provider iOS app builds | CI `ios` job: Tuist generate, the provider app for iPhone and iPad and the patient app, Xcode 26.6, Swift 6 strict concurrency | PASS | |
| 12 | Login UI works | `ProviderFlowTests`: a wrong password shows the server's message, then password and TOTP sign in, on iPhone and iPad; `portal.spec.ts`: wrong password, enrollment, TOTP sign-in, cookie restore, sign-out | PASS | |
| 13 | Patient list, search and create work | `ProviderFlowTests` on iPhone and iPad: create with the duplicate check, search by name prefix | PASS | |
| 14 | Required tests pass | CI green on the final commit ([run 41](https://github.com/cgibson24/Aestara/actions/runs/36863057081), `c2cd6ec`): lint, typecheck, unit and HTTP tests (api 219, database 45 plus 61 database checks and the seed check, contracts 36, admin web 11, tokens 63, prototype 173), the end-to-end RLS gate, Playwright (7), iOS module tests, hosted Keychain tests and UI tests (iPhone, iPad), Terraform checks, OSV-Scanner, gitleaks, Trivy and CodeQL | PASS | No test is skipped to get green; the RLS gate runs as its own CI step |
| 15 | Run, test and migration commands are documented | `README.md` ("Run Layer 1 locally", "Verification"), `CLAUDE.md` (Commands), `services/api/README.md`, `apps/admin-web/README.md`, `apps/ios-provider/README.md`; the commands are the ones CI runs | PASS | |

### 6.2 What Layer 1 delivers

**Features.**
- Authentication: password sign-in, TOTP and passkey second factors, authenticator enrollment during sign-in, refresh-token rotation with reuse detection, sign-out, own sessions and devices, lockout, password reset and change, staff invitations, step-up for sensitive actions, transactional email (SES; Mailpit locally) (ADR-0021).
- Tenancy and authorization: tenant transactions with forced Row-Level Security and an explicit tenant filter, the permission guard with scope rules and separation of duties, `ACCESS_DENIED` auditing on patient routes, cursor pagination, idempotency, optimistic concurrency.
- Organizations, practices, locations; users, memberships, role assignments, provider and staff profiles, session revocation and MFA reset; roles and permissions; organization settings.
- Patients: duplicate check, create, search (ADR-0020), profile with twelve tabs, update, archive, contacts.
- Audit: writer, query API with filters, the per-patient access report.
- Provider iOS app: sign-in with TOTP, Face ID unlock, background relock, privacy cover; adaptive shell; patient list, search, create and profile shell; settings (ADR-0022).
- Admin web portal: sign-in with TOTP or passkey, invitations and resets, users and roles, audit log, account; Content Security Policy (ADR-0022).

**Files.** 224 files changed against the Layer 0 acceptance commit: 157 added, 63 modified, 4 removed (the Layer 0 placeholders of four iOS modules and the old router). By area: `services/api` (66 new), `packages/database` (26), `apps/admin-web` (25), `apps/ios-provider` (16), `packages/api-contracts` (8), `packages/shared-types` (5), `docs` and `.github`. `git diff --stat 5731563` lists them.

**Migrations** (`packages/database/prisma/migrations`): `20260929000000_layer1_tables`, `20260929000100_layer1_constraints`, `20260929000200_layer1_security`, `20260929000300_layer1_catalog`, `20261001000000_layer1_factor_confirmation`.

**APIs.** 62 operations under `/api/v1` (`packages/api-contracts/openapi.json`): authentication 16, organizations, practices and locations 13, users 13, roles and permissions 3, patients 11, audit 2, settings 2, health 2. [API_CONTRACTS.md](API_CONTRACTS.md) gives the conventions.

**Permissions.** The 13 Bible §32 initial permissions and the rest of the spec §4.4 catalog: 53 permissions, 10 system roles, 139 default grants, checked cell by cell against spec §4.4–4.5 (`packages/database/test/catalog.test.ts`).

**Audit events.** The 11 Bible §32 events plus `ROLE_REVOKED`, `ACCESS_DENIED`, `CONFIGURATION_CHANGED`, `SECURITY_SESSION_REVOKED`, `SECURITY_CREDENTIAL_CHANGED` and `ORGANIZATION_SWITCHED` (spec §6.4, §7.3). Sign-in steps are also ledgered in `LoginEvent`.

**Tests.** As in row 14. The api tests run as the runtime database roles, never a superuser; the cross-tenant and authorization tests are generated from the endpoint registry, so a new endpoint is tested by construction.

**Fixed during the review.** The UI tests on a loaded macOS runner found two real defects, both fixed with regression tests:
- The patient-search rate limit used a fixed minute, so 60 searches could be followed by 60 more across the minute boundary. It is now a sliding 60-second window (`patients.test.ts` pins the clock before the boundary).
- Sign-in verified the password (Argon2id) inside a database transaction, so a saturated pool timed out with a 500. The check now runs between two short transactions, and a pool timeout (Prisma `P2028`) answers `503 SERVICE_UNAVAILABLE` with `Retry-After`, documented on every operation (ADR-0021).

**Security considerations.**
- Tenancy: forced RLS on every tenant table, an explicit tenant filter in the api, a platform role without access to patient tables, identical 404s across tenants (SR-TEN; T1.x).
- Identity: Argon2id, a common-password list, lockout, MFA required for admin roles, refresh-token reuse revokes the session, step-up within 15 minutes for credential changes (SR-IDN; T2.x).
- PHI: no PHI in URLs (search in bodies, tokens in fragments and bodies), logs carry route templates only, patient audit metadata carries no demographics (SR-PHI).
- Clients: access tokens in memory only; the iOS refresh token in the Keychain bound to the current biometric set; the web refresh token an `HttpOnly`, `SameSite=Strict` cookie limited to the refresh path with an `Origin` check; the admin CSP; the iOS privacy cover (T6.7, T8.1).
- Supply chain: actions pinned to commit SHAs, OSV-Scanner, gitleaks, Trivy, CodeQL (K-21).

**Known limitations.**
- Nothing is deployed: Terraform is checked, not applied (ADR-0014); AWS accounts, the BAA, domains and certificates are owner inputs (F-32).
- The iOS Release build has no server address, and passkey sign-in on iOS waits for associated domains (F-32, UD-34). The bundle identifier prefix is provisional (UD-34).
- The patient app is a skeleton until Layer 5. The admin portal covers sign-in, users and roles, audit and the account; practices, locations and settings are API-only in Layer 1.
- Snapshot tests and the automated accessibility audit arrive with Layer 2 (ADR-0022); the WORM audit copy arrives with the Layer 2 outbox (K-18).
- `packages/security` stays a placeholder until a second service shares its code (ADR-0022).
- Open owner items: F-33 (success metrics), F-56 (repository visibility), F-59 (CloudTrail account).

**Commands.**

```bash
pnpm install && pnpm check                                   # lint, typecheck, tests, build
pnpm services:up                                             # PostgreSQL 18 and Mailpit
ADMIN_DATABASE_URL=… pnpm --filter @aestara/database db:test # migrations as a non-superuser, RLS, 61 checks, seed
TEST_ADMIN_DATABASE_URL=… pnpm --filter @aestara/api test    # api tests against real PostgreSQL
TEST_ADMIN_DATABASE_URL=… pnpm --filter @aestara/admin-web e2e   # Playwright (after pnpm build)
ADMIN_DATABASE_URL=… pnpm dev:stack                          # local api; prints the admin invitation link
pnpm dev:admin                                               # admin portal on http://localhost:5174
cd apps/ios-provider && tuist generate                       # Xcode workspace (macOS)
```

## 7. Layer 2 acceptance review [B §29; spec §9.1 row 2]

Layer 2 (photography core) was built in micro-prompts M2.1 to M2.10 on the branch `claude/jolly-keller-qmwt2o` (ADR-0023 to ADR-0025); this review is M2.11. The exit condition is the Bible §29 one, "standard photo session works end to end", and the must-pass tests are those of spec §9.1 row 2. Evidence is the test named and the CI job that runs it on every push; the final run is [CI run 75](https://github.com/cgibson24/Aestara/actions/runs/37044116142) on commit `1608e4b`, green in all nine jobs. Format: [TESTING_STRATEGY.md](TESTING_STRATEGY.md#17-acceptance-review-format).

### 7.1 Criteria

| # | Criterion (source) | Evidence | Result | Notes |
|---|---|---|---|---|
| 1 | A standard photo session works end to end [B §29] | `ProviderFlowTests` on iPhone and iPad against the real api, worker, image-processing and AWS emulator: a new patient, the Face protocol, all five views captured with live guidance and reviewed, uploaded write-once, the session completed, the thumbnails rendered by image-processing shown in the gallery, a tag, and a media permission requested and then granted. `photos.test.ts` "captures, verifies, scans, derives and serves every required view" covers the same flow through the api | PASS | The simulator has no camera, so the Debug-only synthetic frame source stands in (K2-12) |
| 2 | Original immutability [spec §9.1] | Database checks C1, C3, C4 and C9 (an original is never re-pointed, its checksum and key never change, derivatives are immutable) and C11 (the photo machine); `photos.test.ts` "never overwrites an uploaded original (If-None-Match)"; `derivatives-e2e.test.ts` reads the original back unchanged after rendering; the clinical-media bucket policy refuses a `PUT` without `If-None-Match: *` (K2-09) | PASS | Originals are never edited; derivatives are new objects |
| 3 | Checksum verification [spec §9.1] | `photos.test.ts` "rejects a checksum or size mismatch, a missing upload and a mislabelled file"; the worker checks each derivative's size, SHA-256 and JPEG signature before recording it; the app sends the SHA-256 with the upload intent | PASS | The emulator does not verify S3 checksums, so the api reads the object to check (K2-03) |
| 4 | Permission independence [spec §9.1; B §7.2] | `media-permissions.test.ts` "starts every category at NOT_REQUESTED and keeps categories independent"; database checks D1 to D9 (append-only versions, one current row, no category implies another, a photo exception names a photo of the same patient) | PASS | `CLINICAL_USE` gates no staff capture or viewing (K2-16) |
| 5 | Release pinning [spec §9.1; B §7.3] | `media-permissions.test.ts` "pins the permission version a release relied on", "revokes the releases a revocation leaves without a grant, and a re-grant never revives them" and "expires a grant at expiresAt"; database checks R15 to R17 | PASS | F-36 resolved |
| 6 | The standard protocols equal Bible §6.2 | `photos.test.ts` "are the Bible's three, ACTIVE, organization-wide, every view required, in Bible order" and "are seeded for every new organization" | PASS | K2-11 |
| 7 | Every upload is scanned; a rejected photo is never served | `photos.test.ts` "rejects an infected upload, never serves it, and audits PHOTO_REJECTED" and "accepts at completion when the scan finished first"; `UploadQueueTests` keeps a rejected photo's original so it can go again as a new photo | PASS | GuardDuty Malware Protection in AWS, an EICAR-only scanner locally (K2-04) |
| 8 | Derivatives are upright, sRGB and free of metadata | `derivatives-e2e.test.ts` through the real service; 47 image-processing tests (pytest); the locked-down container test; Trivy on the image | PASS | K2-06 |
| 9 | Guided capture: only the 13 Bible codes, one at a time, never blocking; a photographic, labelled position match [B §6.3–6.5] | `GuidanceTests` (the codes, their priority order, live checks, quality chips, the position match and its label, sharpness); the UI test waits for "Hold still" on every view, checks the review's checks and the "No reference photo available" state | PASS | The yaw sign of the device camera is confirmed on hardware before first clinical use (F-69) |
| 10 | Viewing is audited; archived photos stay out of the way [B §4.3, §22.1] | The batch access-URL endpoint writes one `PHOTO_VIEWED` per photo; `ORIGINAL` needs `photo.export` ("serves ORIGINAL only with photo.export, and audits it"); "archives: hidden by default, listed on request, still viewable, never archived twice"; the UI test shows the thumbnails | PASS | K2-14 |
| 11 | Offline capture, the encrypted store and audit replay [B §23; spec §8] | `UploadQueueTests` (write-once upload, offline stop and replay with the same keys, an expired URL, a refused intent, a rejected photo uploaded again, re-validation before replay), `EncryptedStoreTests`, `OfflineAuditQueueTests`, `MediaCacheTests`, `PatientCacheTests`; `configuration-and-worker.test.ts` "records each offline view once, at its original time, marked offline" | PASS | [TESTING_STRATEGY.md](TESTING_STRATEGY.md) §11 maps each spec §8 rule to its test |
| 12 | Feature flags, practice settings and retention policies | `configuration-and-worker.test.ts` (resolution order, practice scope, the cache policy, retention without deletion); `portal.spec.ts` changes a flag and a practice's offline policy and records a retention policy | PASS | K2-17 to K2-19 |
| 13 | Outbox and the WORM audit copy | `configuration-and-worker.test.ts` "archives every committed audit row, publishes events to the bus, and reconciles" and "publishes domain events to the bus without PHI"; database check G5 | PASS | K2-07 |
| 14 | Cross-tenant access is still rejected server-side | `authorization.test.ts`, generated from the registry for all 95 operations; the RLS suite; the RLS gate | PASS | |
| 15 | Accessibility audits on the capture, gallery and permission screens (K2-21) | `performAccessibilityAudit()` in `ProviderFlowTests` on iPhone and iPad: every finding fails the test with its screen and element, except the exclusions ADR-0025 lists (elements partly scrolled out of view or under the tab bar, the system bars' titles and buttons, the system search field, the screen dimmed behind a sheet); contrast findings are confirmed on the element's pixels against WCAG AA | PASS | The snapshot half of K2-21 is open (F-68) |
| 16 | Required tests pass | CI green on the final commit: lint, typecheck, unit and HTTP tests (api 351 against PostgreSQL 18 and moto, database 60 plus 125 database checks and the seed check, contracts 45, admin web 11, tokens 63, prototype 173, shared types 2), the end-to-end RLS gate, Playwright (9), image-processing (47 pytest tests and the container test), the iOS module tests (62 across seven modules), the hosted Keychain tests (2) and the UI test on iPhone and iPad, Terraform checks, OSV-Scanner, gitleaks, Trivy and CodeQL ([run 52](https://github.com/cgibson24/Aestara/actions/runs/37044116226)) | PASS | No test is skipped to get green; the RLS gate runs as its own CI step |

### 7.2 What Layer 2 delivers

**Features.**
- Storage ledger and media: upload intents with presigned write-once `PUT`s, verification of size, checksum and first bytes, malware scanning of every upload, signed viewing URLs (single and batch), the original only with `photo.export` (ADR-0023 K2-02 to K2-05, K2-09, K2-14; ADR-0024).
- Photography protocols: the Bible's three standard protocols seeded per organization, the draft, activate and retire lifecycle with database-enforced freezing, and the admin editor (K2-10, K2-11).
- Photo sessions and photos: sessions under active protocols, uploads, required views stated in words, completion with an acknowledgement when required views are missing, tags, archiving (K2-13, K2-14).
- Derivatives: the worker's jobs and the image-processing service (thumbnail and display preview, upright, sRGB, metadata removed), with retries, a sweep and output verification (K2-06; ADR-0024).
- Media permissions and releases: nine independent categories, append-only versions, patient-wide and per-photo, expiry, releases that pin their permission versions and end with the grant (K2-15, K2-16).
- Outbox and events: the relay to EventBridge, SQS queues with dead-letter queues, and the WORM audit copy with a daily reconciliation (K2-07).
- Configuration: feature flags, practice settings including the offline cache policy, retention policies, and the admin configuration page (K2-17 to K2-19).
- Provider iOS app: guided capture with live guidance, ghost overlay and position match; sessions; the gallery and photo detail; media permissions and releases; the encrypted offline store, upload queue, derivative and patient-summary caches, and offline view replay (ADR-0025).

**Files.** 191 files changed between the Layer 1 acceptance commit `a2dffbe` and `1608e4b`: 89 added, 99 modified, 3 removed (the Layer 0 placeholders of three iOS modules). By area: `services/api` (29 new, including the worker), `apps/ios-provider` (26), `services/image-processing` (22, a new service), `packages/database` (4 migrations), `infrastructure/terraform` (the messaging module), `packages/api-contracts`, `apps/admin-web`, `docs` and `.github`. `git diff --stat a2dffbe` lists them.

**Migrations** (`packages/database/prisma/migrations`): `20261001100000_layer2_tables`, `20261001100100_layer2_constraints`, `20261001100200_layer2_security`, `20261001100300_layer2_protocols`. 36 tables in all.

**APIs.** 95 operations under `/api/v1`, 33 of them new: photography 24 (protocols, sessions, uploads, photos, viewing, tags, archive, permissions, releases), settings 8 (feature flags, practice settings, the offline cache policy, retention policies) and the offline view replay. Both clients are generated from `openapi.json`.

**Permissions.** No new permissions: Layer 2 uses the catalog's `photo.capture`, `photo.view`, `photo.annotate`, `photo.export`, `photo.permission.read`, `photo.permission.manage`, `practice.manage`, `configuration.manage` and, for patient-app releases, `consultation.complete`. Two database roles join: `aestara_worker` and `aestara_protocol_seed` (ADR-0024).

**Audit events.** The spec's Layer 2 events `PHOTO_CAPTURED`, `PHOTO_VIEWED` (including `ORIGINAL` and replayed offline views), `PHOTO_PERMISSION_CHANGED`, `MEDIA_RELEASED`, `MEDIA_RELEASE_REVOKED`, `CONFIGURATION_CHANGED` and `ACCESS_DENIED` on photo routes, plus `PHOTO_REJECTED` and `PHOTO_ARCHIVED` (K2-20).

**Tests.** As in row 16. The api and worker tests run as the runtime database roles against PostgreSQL 18 and moto; the derivative test runs the real image-processing service; the UI test runs the whole stack.

**Fixed during the review.** The UI tests on iPhone and iPad found:
- The relay's transaction waited at most 2 seconds for one of the worker's four connections and failed (`P2028`) on a loaded runner; it now waits up to 10 seconds.
- image-processing crashed every render on macOS, where the 3 GiB data limit is smaller than the allocator's start-up reservation; the limit now applies on Linux, where the service runs (ADR-0024).
- On iPhone, a newly created patient could stay on "Opening patient": the profile screen can be pushed twice, and a pushed copy keeps the values it was pushed with. Each patient now has one profile model, shared by every copy of the screen and never replaced, and a new patient opens only once the creation sheet has closed: a profile pushed during the sheet's closing animation stopped updating.
- The admin portal's "Saved." notice disappeared in the reload that a save causes; it now sits above the per-version form.
- The accessibility audit found: profile tabs whose tap area was only their label; capture guidance that large text would cut off; gallery actions whose labels wrapped in half-width buttons; and a search prompt too long for its field. Each is fixed.
- A completed session's Complete button could be pressed again while its screen closed, and a reviewed photo's Accept while the photo was being saved; both now wait.
- The api's end-to-end photo test checked a job message for patient data with a pattern that also matched digits in random identifiers; it now looks for the fixture patient's exact values.
- CI: the UI tests run in their own job, beside the module tests, once both simulators have finished their first boot (data migration included), and with one simulator running at a time: two beside the whole stack slowed the iPhone's run threefold, which dropped taps and timed out audits.

**Security considerations.**
- Originals: write-once at the bucket and in the database, never edited, scanned before use, never served while quarantined or rejected (SR-MED; T4.x).
- Tenancy: every new table under forced RLS and the explicit tenant filter; the worker's cross-tenant reach limited to its duties; generated cross-tenant tests for every new operation (SR-TEN).
- Permissions: nine independent categories, no category implied by another, clinical consent never implies marketing, research or AI-training permission; releases pin and end with their grants (Bible §7; Bible §30).
- PHI: no PHI in URLs, logs or events; image-processing logs no URLs; derivatives carry no metadata (SR-PHI).
- Devices: the offline store sealed per user and organization with AES-GCM and a Keychain key; caches limited by the practice policy and purged on sign-out and at the end of the session; offline views audited and replayed first (K2-17).
- Supply chain: the image-processing container is pinned by digest, runs as a non-root user with a read-only root filesystem, and is scanned by Trivy; OSV-Scanner covers `uv.lock`.

**Known limitations.**
- Nothing is deployed: Terraform is checked, not applied (ADR-0014). GuardDuty Malware Protection must be confirmed within the BAA before the first deployment, or K2-04 uses ClamAV.
- The camera path (AVFoundation, Vision, Core Motion) runs only on a device; CI exercises capture through the synthetic frame source. The device check is F-69.
- The snapshot tests of K2-21 are not in place (F-68).
- Patient-app visibility of released photos arrives in Layer 5; patient photo requests arrive in Layer 5; before/after and registration arrive in Layer 3.
- Retention policies are recorded, not enforced; deletion waits for legal holds (K2-19).
- Open owner items: F-33 (success metrics), F-56 (repository visibility), F-59 (CloudTrail account), F-68, F-69.

**Commands.**

```bash
pnpm install && pnpm check                                   # lint, typecheck, tests, build
pnpm services:up                                             # PostgreSQL 18, Mailpit and moto
ADMIN_DATABASE_URL=… pnpm --filter @aestara/database db:test # migrations as a non-superuser, RLS, 125 checks, seed
TEST_ADMIN_DATABASE_URL=… TEST_AWS_ENDPOINT_URL=http://localhost:4566 TEST_IMAGE_PROCESSING=1 pnpm --filter @aestara/api test
cd services/image-processing && uv sync && uv run pytest     # image-processing
TEST_ADMIN_DATABASE_URL=… pnpm --filter @aestara/admin-web e2e   # Playwright (after pnpm build)
ADMIN_DATABASE_URL=… pnpm dev:stack                          # api, worker and image-processing on a fresh database
cd apps/ios-provider && tuist generate                       # Xcode workspace (macOS)
```

## 8. Sign-off

**Layer 0: accepted by the owner on 2026-09-28.**

The owner authorized Layer 1 (Bible Appendix B #38). Its kickoff, confirmed on 2026-09-29 (ADR-0018), resolved or scheduled the Layer 1 findings in §5.2 (F-13 to F-33, F-59) together with the decisions the roadmap lists for Layer 1.

**Layer 1: accepted by the owner on 2026-10-01**, with the go-ahead for Layer 2. The owner confirmed the Layer 2 kickoff the same day ([LAYER_2_KICKOFF.md](LAYER_2_KICKOFF.md), ADR-0023), resolving the Layer 2 findings in §5.3.

**Layer 2: awaiting the owner's sign-off.** The review is §7. Two owner items stay open: F-68 (how the snapshot references are recorded) and F-69 (the device camera check before first clinical use).
