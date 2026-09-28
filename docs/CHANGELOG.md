# Changelog

All material changes to the architecture, contracts and repository. Newest first. Entries reference ADRs in `ARCHITECTURE_DECISIONS.md`.

## 2026-09-28: Layer 0 architecture foundation

- **Documentation pack** (Bible §31, §35): all 27 documents are present. The spec stays normative and the pack explains and links it (ADR-0012). `SOFTWARE_PRODUCTION_BIBLE.md` is a verbatim export generated from the PDF. `check_docs.py` checks completeness, references, links and placeholders in CI.
- **`packages/api-contracts`**: Zod 4 → OpenAPI 3.1 with the shared primitives. The committed document is drift-checked and an oasdiff breaking-change gate runs in CI (ADR-0013).
- **`infrastructure/terraform`**: bootstrap, dev/staging/production roots, and modules for KMS, account baseline, network, storage, database and compute. validate, tflint and checkov are clean. Nothing is applied yet (ADR-0014).
- **iOS**: Tuist projects for both apps and 20 module packages with a checked tier graph. DesignSystem ships the generated tokens and 4 tests. CI builds and tests on macOS 26 with Xcode 26.6 (ADR-0015).
- **CI**: new `terraform`, `security` (OSV-Scanner) and `ios` jobs; OpenAPI and iOS-architecture gates; Dependabot (ADR-0016).
- **Errata to the locked spec and schema**: `SimulationParameter.unit` removed; §1.5, §2.1, §6.1.1, §7.5, §10.4, §11 corrected; UD-34 added. The V7 `MATCH SIMPLE` audit is now automated (90 database checks, 58 traceability checks) (ADR-0017).
- **Findings register**: 56 Layer 0 findings are recorded in `ACCEPTANCE_CRITERIA.md` §5; 12 are fixed and the rest are carried to the kickoff of the layer that needs them.

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
