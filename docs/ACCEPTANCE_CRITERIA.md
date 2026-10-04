# Acceptance criteria

| | |
|---|---|
| Version | 1.0 |
| Status | Layer 0 acceptance review, 2026-09-28: **accepted by the owner on 2026-09-28** (Bible Appendix B #37). Layer 1 acceptance review, 2026-10-01 (§6): **accepted by the owner on 2026-10-01**. Layer 2 acceptance review, 2026-10-02 (§7): **accepted by the owner on 2026-10-03**. Layer 3 acceptance review, 2026-10-04 (§8): **awaiting the owner's sign-off**. |
| Authority | Bible §27.2 (definition of done), §29 (layer exit conditions), §30 (acceptance review and stop), §31 (Layer 0 kickoff and review), §32 (Layer 1 acceptance), §34 (representative criteria), §36 (production readiness), Appendix B |
| Normative sources | [TESTING_STRATEGY.md](TESTING_STRATEGY.md) §17–18 (review format and traceability to tests), spec §9.1 (what each layer must pass), [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) |

This document says what "done" means for each layer, records the Layer 0 kickoff report and the Layer 0, Layer 1, Layer 2 and Layer 3 acceptance reviews, and keeps the register of findings a later layer must resolve.

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
| F-35 | 2 | Unspecified photo details (see the list after this table) | **Resolved** (ADR-0023 K2-02 to K2-04, K2-06, K2-09, K2-11, K2-12, K2-15); the compatible-view rule by ADR-0026 K3-11: the same view key and pose target |
| F-36 | 2, 5 | The effect of revoking a permission on releases that already exist | **Resolved** (ADR-0023 K2-15): a change that ends a release's effective grant revokes the release; every use re-checks at read time |
| F-37 | 3 | Consultation completion requires "release decision recorded", but there is no column for it, and `/release` arrives in Layer 5 while `/complete` arrives in Layer 3 | **Resolved** (ADR-0026 K3-04): `Consultation.releaseDecision`; Layer 3 completion confirms `NOTHING_TO_RELEASE`, Layer 5's `/release` records `MATERIALS_RELEASED` |
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
| F-55 | 1, 3, 5 | Patient INACTIVE/DECEASED transitions, the consultation cancellation policy, patient-app offline caching | Patient statuses resolved in Layer 1 (ADR-0018 K-20); the cancellation policy by ADR-0026 K3-05 (any non-final state, with a reason); patient-app offline caching at the Layer 5 kickoff |
| F-56 | Owner | The repository is public, but the Bible is marked "Confidential Product Specification" | The owner decides the repository's visibility |
| F-60 | 5 | Spec §6.3/§6.5 have no staff endpoint or permission for inviting a patient, though `PatientUserLink.invitedById` implies one | Add the endpoint and permission in Layer 5 |
| F-61 | 2 | The spec §7.1 VPC-endpoint bucket condition and the spec §7.4 denial of overwriting existing keys are not yet in Terraform | **Resolved** (ADR-0023 K2-09, ADR-0024): the clinical-media policy refuses a `PUT` without `If-None-Match: *` and object access outside the S3 endpoint, except for the presigning role and GuardDuty |
| F-62 | 7 | GPU inference needs a subnet tier with no internet egress (spec §2.1); the Layer 0 private subnets route through NAT | Add the tier in Layer 7 (UD-04) |
| F-63 | 2 | Spec §5.4 has no photography-protocol state machine (the lifecycle is read from `/activate` and `/retire`) | **Resolved** (ADR-0023 K2-10): spec §5.4.10 |
| F-64 | 3 | Whether consultation transitions other than sign-off and release may be queued offline | **Resolved** (ADR-0026 K3-06): no transition is queued offline; notes are drafted, cached photos annotated and photos captured offline |
| F-65 | 4 | Whether education and instruction assignments may reference only PUBLISHED content versions | Decide in Layer 4 |
| F-66 | 2 | How archived photos are shown in lists | **Resolved** (ADR-0023 K2-14) |
| F-67 | 2 | Who manages platform-wide feature-flag defaults (`configuration.manage` is held by organization and practice admins) | **Resolved** (ADR-0023 K2-18): defaults in code; no platform-wide rows in Layer 2 |
| F-68 | Owner, 3 | The K2-21 snapshot tests need reference images. This environment cannot record them: they are rendered on a Mac with Xcode, and the first run of each test records its image and fails by design | **Resolved** (ADR-0026 K3-22): the `ios` job records missing references and prints them into its log; Claude reviewed and committed the 40 references of `ProviderSnapshotsTests`, which now run on every push (Layer 3 review, §8) |
| F-69 | Pre-clinical use | The camera path (AVFoundation capture, Vision face and body detection, Core Motion tilt) runs only on a device; CI exercises capture through the synthetic frame source. The sign of Vision's yaw is flipped to the protocol's convention by reasoning, not by measurement | Before first clinical use, capture each standard view on an iPhone and an iPad and confirm the guidance (in particular PATIENT_TURN_LEFT and RIGHT) and the recorded pose (ADR-0025) |
| F-70 | 3 | On the 13-inch iPad simulator, the accessibility audit of the gallery or the permission screen sometimes could not complete, and the app answered no UI query for minutes (CI runs 67–101). The device log showed the app's main thread busy once the audit started | **Resolved** in Layer 3 (§8): the reworked iPad shell (K3-23) ran every Layer 2 audit without a busy main thread. A Debug lifecycle trace then showed the iPad building a full-screen screen presented from another full-screen screen again on every trait change: each audit's text-size changes rebuilt the annotation screen eight times, dropping the drawing and fetching the preview again, and a sheet opening over the comparison screen closed itself. Photos and sets opened in the workspace are pushed instead, and their state is owned by the step that opens them (ADR-0027). CI keeps sampling the app if XCTest reports its main thread busy |
| F-71 | 2 | MARKETING holds `photo.export` for released assets only and sees no patient (spec §4.5 note ¹), but the Layer 2 release routes checked `photo.export` alone, so it could create or revoke a release of a photo whose ID it had (found in M3.7) | **Resolved** (ADR-0027): release and export routes also require `photo.view`; MARKETING gets the `404` of a patient it cannot see |

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

Layer 2 (photography core) was built in micro-prompts M2.1 to M2.10 on the branch `claude/jolly-keller-qmwt2o` (ADR-0023 to ADR-0025); this review is M2.11. The exit condition is the Bible §29 one, "standard photo session works end to end", and the must-pass tests are those of spec §9.1 row 2. Evidence is the test named and the CI job that runs it on every push; the final run is [CI run 92](https://github.com/cgibson24/Aestara/actions/runs/37093755967) on commit `750394a`, green in all nine jobs. Format: [TESTING_STRATEGY.md](TESTING_STRATEGY.md#17-acceptance-review-format).

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
| 15 | Accessibility audits on the capture, gallery and permission screens (K2-21) | `performAccessibilityAudit()` in `ProviderFlowTests` on iPhone and iPad: every finding fails the test with its screen and element, except the exclusions ADR-0025 lists (elements partly scrolled out of view or under the tab bar, the system bars' titles and buttons, the system search field, the screen dimmed behind a sheet); contrast findings are confirmed on the element's pixels against WCAG AA, and any other finding by a second audit of the same screen | PASS | The snapshot half of K2-21 is open (F-68). On iPad the audit sometimes cannot complete because the app's main thread stays busy (F-70, open) |
| 16 | Required tests pass | CI green on the final commit: lint, typecheck, unit and HTTP tests (api 351 against PostgreSQL 18 and moto, database 60 plus 125 database checks and the seed check, contracts 45, admin web 11, tokens 63, prototype 173, shared types 2), the end-to-end RLS gate, Playwright (9), image-processing (47 pytest tests and the container test), the iOS module tests (62 across seven modules), the hosted Keychain tests (3) and the UI test on iPhone and iPad, Terraform checks, OSV-Scanner, gitleaks, Trivy and CodeQL ([run 69](https://github.com/cgibson24/Aestara/actions/runs/37093755957)) | PASS | No test is skipped to get green; the RLS gate runs as its own CI step |

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

**Files.** 193 files changed between the Layer 1 acceptance commit `a2dffbe` and `750394a`: 90 added, 100 modified, 3 removed (the Layer 0 placeholders of three iOS modules). By area: `services/api` (29 new, including the worker), `apps/ios-provider` (26), `services/image-processing` (22, a new service), `packages/database` (4 migrations), `infrastructure/terraform` (the messaging module), `packages/api-contracts`, `apps/admin-web`, `docs` and `.github`. `git diff --stat a2dffbe` lists them.

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
- The encrypted store made its key on first use without a lock, so two first uses at once could make two keys and leave records sealed with the first unreadable; and every read and write asked the Keychain for the key, which stalled the app for minutes on a loaded simulator. The key is now made once under a lock and kept in memory until the store is destroyed (ADR-0025), with a hosted test of concurrent first use.
- The capture screen redrew for every camera frame, changed or not, and the synthetic camera repeated its settled frame three times a second; on iPad the audit then misjudged every text on that screen in one run of four. An unchanged frame no longer redraws the screen, and the synthetic camera rests once its subject has settled.
- The audit's Dynamic Type and clipping predictions on the iPad simulator varied between identical screens and runs (one label of a row flagged, its neighbours not). A finding other than contrast now fails when a second audit of the same screen reports it again; what is not confirmed is kept with the results.
- CI: a step's script that did not parse (an apostrophe inside a quoted Python snippet) ended the UI test step green without running a test (run 83). The step now keeps its exit status, fails unless both devices left a passing result, and every workflow script is parsed with `bash -n` in the spec job.
- CI: the iPad UI test runs on the 13-inch iPad in portrait, named explicitly; in landscape the simulator's screenshots of the app were cut off. An audit that cannot complete in time, which happened on that iPad, runs once more after a pause.
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
- On the iPad, the app's main thread sometimes stays busy for minutes while the accessibility audit of the gallery or permission screen runs, so the audit cannot complete (F-70). The cause is being traced; it is not seen on iPhone.
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

## 8. Layer 3 acceptance review [B §29, §34.1 #12–21]

Layer 3 (consultations and before/after) was built in micro-prompts M3.1 to M3.8 on the branch `claude/jolly-keller-qmwt2o` (ADR-0026, ADR-0027); this review is M3.9. The exit condition is the Bible §29 one, "consultation with standardized imagery is functional", and the detailed criteria are Bible §34.1 #12–21 with the Layer 3 tests of spec §9.1 row 3. Evidence is the test named and the CI job that runs it on every push; the final run is [CI run 114](https://github.com/cgibson24/Aestara/actions/runs/37195947250) on commit `c7679c3`, green in all nine jobs, with CodeQL green on the same commit. Format: [TESTING_STRATEGY.md](TESTING_STRATEGY.md#17-acceptance-review-format).

### 8.1 Criteria

| # | Criterion (source) | Evidence | Result | Notes |
|---|---|---|---|---|
| 1 | A consultation with standardized imagery is functional [B §29] | `ProviderFlowTests` on iPhone and iPad against the real api, worker, image-processing and AWS emulator: a consultation created in a practice and started; a Face protocol session taken for it, its photo shown in the step; a layer drawn on that photo; a note drafted and finalized; a before/after set made of two photos of the same view, viewed side by side, by swipe, cross-fade and overlay, aligned by hand and exported for a granted purpose; the consultation submitted for review, its summary generated, "nothing is released" recorded and the consultation completed; then the profile's Consultations, Documents and Timeline tabs. `consultations.test.ts` runs the whole machine through the api | PASS | The simulator has no camera; the Debug-only synthetic frame source stands in (ADR-0023 K2-12) |
| 2 | The consultation state machine [spec §5.4.1; UD-28] | `consultations.test.ts` "the machine" (every transition, refused ones, review blocked by a draft note, the completion preconditions, `NOTHING_TO_RELEASE` only) and "what each state allows" (frozen content under review and after completion, stale `If-Match`); database checks H7–H28 (the transition table, notes, the frozen content, the release decision, cancellation, no deletion), run on the real migrations by the database suite | PASS | K3-01 to K3-05 |
| 3 | Notes: final notes never change; corrections are addenda [B §5.1; UD-15] | `consultation-notes.test.ts` "notes" (author-only drafts, finalize, never changed after, addenda after completion, no note through another consultation); `ConsultationDomainTests` (queued drafts shown over the saved copy, edits coalesced with their base version, nothing kept after sign-out) | PASS | K3-06, K3-07; finalizing needs a connection |
| 4 | #12 A before/after set holds exactly two images of the same patient | `before-after.test.ts` "pairs two photos of the same patient and view, audited, originals untouched", "refuses photos of different views", "refuses a before photo that is not the earlier one, and the same photo twice", "uses only accepted photos that are not archived"; database checks C5–C7 and C15–C17 | PASS | The compatible-view rule is the same view key and pose target (K3-11) |
| 5 | #13 The server rejects another tenant's or patient's image IDs | `before-after.test.ts` "gives the same 404 for unknown, other-patient and other-tenant photos"; the generated cross-tenant suite swaps IDs in paths and bodies for all 139 operations; database checks A1 and C5 | PASS | |
| 6 | #14 Original assets remain untouched | `before-after.test.ts` compares both originals' object key and SHA-256 before and after a set is made, aligned by hand and reset; `derivatives-e2e.test.ts` reads the original back from the bucket unchanged after rendering; database checks C1, C3 and C4 refuse any change to an original's object, key or checksum, and C16–C17 a set's photos, and the bucket refuses an overwrite (ADR-0023 K2-09) | PASS | Annotations are vector layers beside the photo; exports and alignment make new objects |
| 7 | #15 Side by side, slider, cross-fade, blink and overlay work | The snapshot tests `comparison-<mode>` on iPhone and iPad; `BeforeAfterTests` "never blinks faster than three times a second" and "fits the before photo like the export"; the UI test opens side by side, swipe, cross-fade and overlay on both devices | PASS | Blink is covered by its snapshot and its rate test; it follows WCAG 2.3.1 |
| 8 | #16 Zoom and pan can be synchronized | `BeforeAfterTests` "zooms and pans both panes together until unlinked" | PASS | |
| 9 | #17 Automatic registration can be disabled or reset | `before-after.test.ts` "aligns by hand and resets, with If-Match and photo.annotate" and "automatic registration" (the job applies its transform, keeps a manual alignment made meanwhile, leaves the set when no reliable alignment is found, honours the organization's flag); 14 pytest registration tests; the UI test aligns by hand and sees "Aligned by hand" | PASS | K3-13 |
| 10 | #18 Export verifies purpose-specific permission | `exports.test.ts` "exports under the current grant", "refuses without the purpose's current grant and creates nothing", "revokes the export when its grant ends", "is revoked when either photo loses the grant", "needs photo.export, photo.view and a recent MFA" | PASS | Missing, revoked and expired grants answer `403 MEDIA_PERMISSION_NOT_GRANTED` |
| 11 | #19 Export creates `PHOTO_EXPORTED` | `exports.test.ts` "exports under the current grant: pinned, audited, rendered, then downloadable" (one event per photo shown, the purpose and pinned versions in its metadata) | PASS | Downloads write `PHOTO_VIEWED` |
| 12 | #20 Invalid or unauthorized images do not reveal existence | `before-after.test.ts` "gives the same 404 for unknown, other-patient and other-tenant photos" (identical bodies); the generated cross-tenant suite | PASS | MARKETING gets a patient's `404` on release and export routes (F-71) |
| 13 | #21 Tests cover success, invalid IDs, permission denial and export failure | Success: `exports.test.ts` "exports under the current grant", the before/after set test. Invalid IDs: "gives the same 404…", the cross-tenant suite. Permission denial: "refuses without the purpose's current grant", "needs photo.export, photo.view and a recent MFA", the generated authorization suite. Export failure: "fails visibly and serves nothing when the layer changed or the render failed" | PASS | All four are present |
| 14 | Annotations are non-destructive vector layers, never measurements [B §6.6] | `annotations.test.ts` (the palette, widths and normalized coordinates only, no measurement shapes, author-only changes with `If-Match`, the row kept on delete, offline creation replayed); `AnnotationsTests` (the wire format through the generated types, the editor, the offline queue and conflicts) | PASS | K3-10 |
| 15 | Documents, the consultation summary and the timeline [B §12, §5.1, §4.3] | `documents.test.ts` (8), `consultation-summary.test.ts` (3), `timeline.test.ts` (3); the UI test generates the summary and opens the Documents and Timeline tabs | PASS | The summary holds final notes only, no images (K3-17) |
| 16 | The audit events of K3-19 | The tests above assert each event and that its metadata holds no note text, concern or history description, reason or title [B §22.2] | PASS | Two additions: `CONSULTATION_NOTE_FINALIZED`, `DOCUMENT_ADDED` |
| 17 | Cross-tenant and role access are still rejected server-side | `authorization.test.ts`, generated from the registry for all 139 operations; the RLS suite; the RLS gate | PASS | |
| 18 | Accessibility audits of the workspace, the annotation editor and the comparison viewer on both devices (K3-22) | `performAccessibilityAudit()` in `ProviderFlowTests` on iPhone and iPad, beside the Layer 2 audits of capture, the gallery and the permission screen; every finding fails the test, with the exclusions and the confirm-twice rule of ADR-0025 | PASS | The findings the audits made during the review are fixed (§8.2) |
| 19 | Snapshot tests in light, dark and an accessibility text size (ADR-0023 K2-21; F-68) | `ProviderSnapshotsTests` (10 tests, 40 references): the five view states, the components, photo tiles, consultation, timeline and document rows, the annotated photo, the annotation editor, each comparison mode and the alignment editor; run on an iPhone simulator in the `ios` job | PASS | F-68 resolved: references recorded by CI, reviewed and committed |
| 20 | The iPad main-thread hang is fixed (F-70; K3-23) | The reworked iPad shell (K3-23) ran every audit, Layer 2's gallery and permission screen included, with no "main thread busy" report from XCTest in any of the four iPad runs since the sampler could find the app (CI runs 37184260133, 37186684605, 37193232067 and 37195947250). The Debug lifecycle trace found what remained on the Layer 3 screens: the iPad rebuilt a full-screen screen presented from the full-screen workspace on every trait change; those screens are now pushed and their state is owned by the step that opens them (ADR-0027) | PASS | F-70 resolved; CI keeps sampling the app whenever XCTest reports its main thread busy |
| 21 | Required tests pass | CI green on the final commit: lint, typecheck, unit and HTTP tests (api 587 against PostgreSQL 18 and moto, plus the RLS gate; database 69 plus 157 database checks, no drift and the seed check; contracts 45; admin web 11; tokens 63; prototype 173; shared types 2), Playwright (9), image-processing (94 pytest tests, the container test and Trivy), the iOS module tests (87 across ten modules), the snapshot tests (10 tests, 40 references), the hosted Keychain tests (3), the UI test on iPhone and iPad, the schema checks (145) and traceability (58 of 58), Terraform checks, OSV-Scanner, gitleaks and CodeQL | PASS | No test is skipped to get green; the one skipped api test is the RLS gate, which runs as its own step |

### 8.2 What Layer 3 delivers

**Features.**
- Consultations: create in a practice, the spec §5.4.1 machine with the four UD-28 transitions, what each state allows, the completion preconditions with `NOTHING_TO_RELEASE` as Layer 3's release decision, cancellation with a reason, archiving (ADR-0026 K3-01 to K3-05; ADR-0027).
- Concerns, medical history and notes: concerns by registered area, staff medical-history entries corrected with `If-Match` and never deleted, author-only note drafts, final notes that never change, and addenda, also after completion (K3-07, K3-08).
- Photography for a consultation: a session started from the workspace is linked to the consultation while it is under way, takes its practice and location, and the gallery filters by it (K3-09).
- Annotations: versioned vector layers beside the photo, in the token palette and fixed widths and sizes, with no measurement tools; only the author changes a layer (K3-10).
- Before/after: sets of two accepted photos of the same patient, view key and pose target, the before one earlier; one indistinguishable `404`; alignment by hand and reset; automatic registration by an image-processing job (AKAZE features and RANSAC), behind a flag (K3-11 to K3-13).
- Exports: a photo, optionally with one layer, or a before/after pair, for one of six purposes, under the purpose's current grant, pinned like a release, rendered by image-processing, downloadable for 10 minutes, revoked when a grant ends, with step-up and a rate limit (K3-14, K3-15; F-71).
- Documents, the consultation summary and the timeline: uploaded PDFs, verified and scanned, in versions; the summary PDF of final notes and addenda; the patient timeline merged across domains, each domain shown only to a caller who can read it (K3-16 to K3-18).
- Provider iOS app: the consultation workspace (on iPad a stepper beside its steps, on iPhone a list of steps), the profile's Timeline, Consultations, Before/After and Documents tabs, the annotation editor (finger or Apple Pencil), the comparison viewer in five modes with linked zoom and pan, alignment by hand, exports shared from a temporary file, "Confirm it's you" for step-up, and offline note drafts and annotation layers in the encrypted queue (K3-06, K3-21; ADR-0027).

**Files.** 228 files changed between the Layer 2 acceptance commit `cc285e0` and `c7679c3`: 122 added, 102 modified, 4 removed (the Layer 0 placeholders of four iOS modules). By area: `apps/ios-provider` (107, including the snapshot package and its 40 references), `services/api` (50), `services/image-processing` (16), `packages/api-contracts` (13), `packages/database` (8), `packages/design-tokens` (5), `docs` and `.github`. `git diff --stat cc285e0 c7679c3` lists them.

**Migrations** (`packages/database/prisma/migrations`): `20261004100000_layer3_tables`, `20261004100100_layer3_constraints`, `20261004100200_layer3_security`. 45 tables in all.

**APIs.** 139 operations under `/api/v1`, 44 of them new: consultations 19 (the lifecycle, the concern set, notes, the summary), patient data 7 (concerns, medical history, the timeline), photography 13 (annotations, before/after sets, automatic registration, exports) and documents 5. Both clients are generated from `openapi.json`.

**Permissions.** No new permissions or database roles: Layer 3 uses the catalog's `consultation.*`, `photo.view`, `photo.annotate`, `photo.export`, `document.read` and `document.manage`. Release and export routes now also require `photo.view` (F-71).

**Audit events.** The spec's Layer 3 events `CONSULTATION_CREATED`, `CONSULTATION_STATUS_CHANGED`, `CONSULTATION_COMPLETED`, `PHOTO_ANNOTATED`, `BEFORE_AFTER_CREATED`, `PHOTO_EXPORTED`, `DOCUMENT_VIEWED`, `PATIENT_UPDATED` (concerns and medical history), `CONFIGURATION_CHANGED` (the registration flag) and `ACCESS_DENIED` on the new routes, plus `CONSULTATION_NOTE_FINALIZED` and `DOCUMENT_ADDED` (K3-19). None carries note text, a description, a reason or a title.

**Tests.** As in row 21. The api and worker tests run as the runtime database roles against PostgreSQL 18 and moto; the registration and export tests run the real image-processing service; the UI test runs the whole stack on iPhone and iPad.

**Fixed during the review.** The UI tests, the accessibility audits and the first snapshot references found:
- The generated iOS client wrote header values as URI components, so an ETag went out as `%22v3%22` and the api refused every change that needs `If-Match`. A client middleware now sends the literal ETag, with a module test.
- On iPad in portrait, the workspace's split view hid its steps behind a sidebar button; the steps now sit in a fixed column beside the chosen step.
- On iPad, SwiftUI rebuilt a full-screen screen presented from the full-screen workspace on every trait change: the annotation screen on each text-size change of the audit, losing the drawing in progress and fetching the preview again, and the comparison screen when the export sheet opened over it, closing the sheet. It was found with a Debug-only lifecycle trace. Inside the workspace, photos and sets are now pushed onto its own navigation stack, and the step that opens one owns its screen's state (ADR-0027).
- The audit found: the annotation editor's Undo button with a 20 × 17 pt hit area (its 44-pt frame sat outside the button); status badges in `caption2`, which keeps one size from the default down (now `caption1`); an annotation layer's name cut off at large text (now a field that grows); note cards whose identifier hid their buttons' identifiers; the comparison viewer's reset button below 44 pt, its link toggle and notice that large text could cut off, and an unnamed photo in side by side. Each is fixed.
- The snapshot references showed rows squeezing their badge and date at accessibility sizes, a badge cutting its word off, and the timeline's icons running into their titles. Rows now stack their details when they do not fit, badges wrap, and the icon column grows with the text.
- A photo session could at first be linked to a `DRAFT` consultation, against K3-09; only `IN_PROGRESS` and `AWAITING_INFORMATION` are accepted, with a test.
- An export sheet could not be presented from behind a full-screen screen; the comparison screen presents it itself.
- MARKETING, which holds `photo.export` for released assets only, could create or revoke a Layer 2 release of a photo whose ID it had; release and export routes also require `photo.view` (F-71).
- The alignment test now compares the originals' object key and SHA-256 before and after aligning and resetting.
- CI: the main-thread sampler found no app process by path or by the simulator's launchd and once sampled xcodebuild by name; it now takes the app's process number from XCTest's own log line.
- CI: node, running the api stack beside the UI tests, made the step's output non-blocking; a long device log then made `echo` fail with "Resource temporarily unavailable" and ended the step before the iPad ran. The stack now writes through `cat`.
- The UI test typed into a field before the keyboard had appeared and lost all but the first key; it now waits for focus and checks what arrived.
- The first snapshot references lacked the app's root tint and showed the system's green and blue; the harness now applies it.

**Security considerations.**
- Originals: never edited. Annotations are rows beside the photo; alignment changes the set only; exports and the summary are new objects. Database checks C1, C3, C4, C16 and C17 enforce it (SR-MED).
- Tenancy: every new table under forced RLS and the explicit tenant filter; consultations are practice-scoped (K3-20); the generated cross-tenant tests cover all 139 operations, with IDs swapped in paths and bodies (SR-TEN).
- Permissions: an export needs the purpose's current grant on every photo shown, `photo.export`, `photo.view` and a recent second factor; it pins the grant versions, is re-checked at download and is revoked when a grant ends. Clinical consent never implies marketing, research or AI-training permission (Bible §7; Bible §30).
- PHI: no note text, concern or history description, cancellation reason or title in audit metadata, logs or events; export file names say what the image shows, not who; the Debug lifecycle trace logs screen names only and Release builds log nothing (SR-PHI).
- Clinical safety: annotations are visual notes with no measurement tools; comparisons show what was photographed and say they predict no result; nothing doses, diagnoses or recommends.
- Devices: note drafts and annotation layers wait offline in the encrypted store per user and organization, under the practice's cache policy, and are cleared at sign-out; an export is shared from a temporary file deleted when the share sheet closes.
- Supply chain: OpenCV (`opencv-python-headless`, Apache-2.0), PDFKit 0.20.2 (MIT) and Inter (OFL) join; the image-processing container stays pinned by digest and scanned by Trivy; OSV-Scanner covers the lockfiles.

**Known limitations.**
- Nothing is deployed: Terraform is checked, not applied (ADR-0014).
- Release to the patient app arrives in Layer 5; Layer 3 completion records `NOTHING_TO_RELEASE` only (K3-04). The steps of later layers (education, procedures, AI visualization, plans, estimates, consents, instructions, scheduling) are not shown in the workspace until their layer delivers them.
- Automatic registration is tested on synthetic pairs with known transforms; its accuracy on real clinical pairs has not been measured. It only proposes an alignment, which the provider sees and can change or reset.
- Documents are PDF only; an export draws at most one annotation layer.
- "Confirm it's you" (step-up) is tested by the api (`exports.test.ts` "needs photo.export, photo.view and a recent MFA"); the UI test takes it only when its export comes more than 15 minutes after sign-in, which the final run's did not.
- The snapshot tests run on the iPhone simulator; the iPad is covered by the screen-sized pictures at iPad size and by the UI test.
- Open owner items: F-33 (success metrics), F-56 (repository visibility), F-59 (CloudTrail account), F-69.

**Commands.** As in §7.2, plus:

```bash
cd services/image-processing && uv run pytest tests/test_registration.py tests/test_export.py   # registration and export
cd apps/ios-provider/Snapshots && xcodebuild test -scheme ProviderSnapshots -destination 'id=<iPhone simulator>'   # snapshots (macOS)
```

## 9. Sign-off

**Layer 0: accepted by the owner on 2026-09-28.**

The owner authorized Layer 1 (Bible Appendix B #38). Its kickoff, confirmed on 2026-09-29 (ADR-0018), resolved or scheduled the Layer 1 findings in §5.2 (F-13 to F-33, F-59) together with the decisions the roadmap lists for Layer 1.

**Layer 1: accepted by the owner on 2026-10-01**, with the go-ahead for Layer 2. The owner confirmed the Layer 2 kickoff the same day ([LAYER_2_KICKOFF.md](LAYER_2_KICKOFF.md), ADR-0023), resolving the Layer 2 findings in §5.3.

**Layer 2: accepted by the owner on 2026-10-03** on the review in §7, with F-68 (how the snapshot references are recorded), F-69 (the device camera check before first clinical use) and F-70 (on iPad the app's main thread sometimes stays busy during an audit) still open. The owner confirmed the Layer 3 kickoff on 2026-10-04 ([LAYER_3_KICKOFF.md](LAYER_3_KICKOFF.md), ADR-0026), resolving or scheduling the Layer 3 findings in §5.3.

**Layer 3: awaiting the owner's sign-off** on the review in §8. Work stops here until the owner accepts it (Bible §30, Appendix B #37–38).
