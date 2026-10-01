# Changelog

All material changes to the architecture, contracts and repository. Newest first. Entries reference ADRs in `ARCHITECTURE_DECISIONS.md`.

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
