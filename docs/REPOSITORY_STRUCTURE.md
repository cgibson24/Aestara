# Repository structure

| | |
|---|---|
| Version | 1.0 |
| Status | Layer 0 baseline, 2026-09-28 |
| Authority | Bible §31 "REPOSITORY TARGET", §35 target repository; ADR-0010 (environment and tooling), ADR-0011 (design tokens) |
| Normative sources | spec §2 (tech stack), spec §3.1 (service responsibilities); `pnpm-workspace.yaml`, `turbo.json`, `.github/workflows/ci.yml` |

This document explains where everything lives, what state each part is in, and the rules for adding code. The tree follows the Bible §31/§35 target exactly. The one addition is `apps/design-prototype` (ADR-0009).

## 1. Tree

```text
/
├── apps/
│   ├── ios-provider/        Provider iPad/iPhone app: Tuist project + 20 module packages (Modules/)
│   ├── ios-patient/         Patient iPhone app: Tuist project (reuses 3 provider modules)
│   ├── admin-web/           Admin portal, React 19 + Vite SPA (ADR-0003)              · from Layer 1
│   └── design-prototype/    Static design mock-up, hard-coded data (ADR-0009)          · never deployed
├── services/
│   ├── api/                 NestJS 12 + Fastify; owns the database schema             · from Layer 1
│   ├── ai-gateway/          Internal AI job API and model routing                     · from Layer 7
│   ├── image-processing/    Derivatives, normalization, registration (Python, UD-06)  · from Layer 2
│   ├── notifications/       APNs/email/SMS without sensitive payloads                 · from Layer 5
│   └── integration-service/ FHIR/vendor adapters                                      · from Layer 10
├── packages/
│   ├── api-contracts/       Zod schemas → OpenAPI 3.1 (openapi.json)                  · Layer 0 primitives
│   ├── database/            Prisma schema, migrations, RLS, permission catalog, seeds · Layer 1 (M1.1)
│   ├── security/            Shared authz/crypto helpers for services                  · from Layer 1
│   ├── design-tokens/       tokens.json → CSS, TypeScript, Swift                      · Layer 0
│   └── shared-types/        Enum values generated from the Prisma schema              · Layer 1 (M1.1)
├── infrastructure/
│   └── terraform/           AWS: bootstrap, environments/{dev,staging,production}, modules/
├── docs/                    Bible export, spec, ADRs, Layer 0 documentation pack
├── .github/                workflows/ci.yml (CI gates, Bible §28.2), dependabot.yml
├── .claude/                 Claude Code on the web: SessionStart hook
├── .devcontainer/           Codespaces / Dev Container
├── Aesthetic_Platform_Software_Production_Bible_v1.0.pdf   (authoritative)
├── CLAUDE.md                Development constitution and working rules for agents
└── package.json, pnpm-workspace.yaml, turbo.json, biome.json, tsconfig.base.json, mise.toml, .nvmrc
```

## 2. What exists after Layer 0

| Path | State | Proven by |
|---|---|---|
| `packages/design-tokens` | Implemented: one token source compiled to CSS, TS and Swift | 63 contrast tests; CI drift check |
| `packages/api-contracts` | Implemented: platform-wide primitives only, with no endpoints | 18 schema tests; OpenAPI drift check; oasdiff gate |
| `apps/ios-provider`, `apps/ios-patient` | Skeleton. Tuist projects; 20 module packages with a checked tier graph; DesignSystem ships the tokens and has tests. The other modules hold their documented boundary only. | `check_module_graph.py`; CI `ios` job (generate, build both apps, test DesignSystem) |
| `infrastructure/terraform` | Skeleton. Real, minimal modules (KMS, account baseline, network, storage, database, compute) and three environment roots. **Not applied** to any account yet. | CI `terraform` job: fmt, validate, tflint, checkov |
| `apps/design-prototype` | Static mock-up of the core scenes | 173 scene × state tests |
| `packages/database` | Layer 1 tables (21), generated from the design schema; migrations for tables, constraints (including patient search keys), security (roles, forced RLS, sign-in lookup) and the permission catalog; ownership classification; local seed; RLS benchmark | 45 unit tests; `schema:check` drift gate; CI `database` job: migrations as a non-superuser, drift, `check-rls.ts`, 61 database checks |
| `packages/shared-types` | Enum values generated from `packages/database/prisma/schema.prisma` | 2 tests; CI drift check |
| `apps/admin-web`, `services/*`, `packages/security` | Placeholder README only. Each names the layer that builds it. | Bible §31: "no fake business implementation" |
| `docs/` | Layer 0 documentation pack | `check_docs.py`, `check_traceability.py` |

## 3. Toolchain

| Tool | Version | Pinned in |
|---|---|---|
| Node.js | 24.21.0 (LTS) | `.nvmrc`, `package.json` engines |
| pnpm | 12.6.0 via corepack | `package.json` `packageManager` |
| TypeScript | 6.0.3 | package manifests |
| Turborepo, Biome, Vitest | 2.11.4, 2.5.14, 5.0.2 | package manifests |
| Zod, zod-to-openapi | 4.6.5, 9.1.0 | `packages/api-contracts/package.json` |
| Prisma ORM and Migrate, `@prisma/adapter-pg`, node-postgres | 7.10.0, 7.10.0, 8.23.0 | `packages/database/package.json`; `pnpm-workspace.yaml` `allowBuilds` lets Prisma's engine install script run |
| oasdiff | v1.32.1 | `packages/api-contracts/scripts/check-breaking.sh`, CI |
| Terraform, AWS provider | 1.16.4, 6.66.0 (exact) | environment roots, `.terraform.lock.hcl` |
| tflint (+ AWS ruleset), checkov | 0.64.0 (0.49.0), 3.3.20 | `.tflint.hcl`, CI |
| Xcode, Swift | 26.6 on macOS 26 runners; Swift tools 6.2 | CI `ios` job, `Package.swift` |
| Tuist | 4.209.0 (via mise) | `mise.toml` |
| PostgreSQL | 18 (≥ 15 required) | `docker-compose.yml`, CI service |
| OSV-Scanner | v2.6.0 | CI `security` job |

## 4. Commands

```bash
pnpm install                     # dependencies (Node 24, pnpm via corepack)
pnpm check                       # lint + typecheck + test + build: what the CI workspace job runs
pnpm tokens                      # regenerate design tokens (CSS/TS/Swift + iOS DesignSystem copy)
pnpm dev:prototype               # design prototype at http://localhost:5173
pnpm services:up                 # local PostgreSQL 18
pnpm verify:spec                 # Bible → spec traceability (pip install pypdf)
DATABASE_URL=… pnpm verify:schema  # schema + database behaviour suite on an empty database
python3 docs/technical-spec/verification/check_docs.py      # documentation pack and references
python3 apps/ios-provider/scripts/check_module_graph.py     # iOS module architecture rules
cd apps/ios-provider && tuist generate                      # Xcode workspace (macOS; mise install first)
```

## 5. Rules for adding code

1. **Build only what the current layer authorizes.** A folder stays a README until its layer (Bible §30, `DEVELOPMENT_ROADMAP.md`).
2. **The api owns the database.** Only `services/api` (through `packages/database`) reads or writes PostgreSQL. Imaging and AI services receive opaque object references, never demographics (spec §3.1).
3. **DTOs are not models.** Request and response shapes live in `packages/api-contracts`. Prisma types never cross the API boundary (Bible §31).
4. **One source per fact.**
   - Colours, spacing and type come from `packages/design-tokens`.
   - API shapes come from `packages/api-contracts`.
   - Tables come from the Prisma schema, plus `constraints.sql` fragments for what Prisma cannot express.
   - Generated files are committed, and CI fails when they drift.
5. **iOS modules follow the tier graph** in `apps/ios-provider/Modules/modules.json`: foundation → platform → domain → feature → app. A new dependency is added to `modules.json` and the module's `Package.swift` together; CI enforces the rules. Details are in [IOS_ARCHITECTURE.md](IOS_ARCHITECTURE.md).
6. **Infrastructure changes go through Terraform only.** Each checkov suppression sits inline with its reason (`infrastructure/terraform/README.md`).
7. **No secrets in the repository.**
   - `.env` and `terraform.tfvars` are ignored by git.
   - Backend secrets live in AWS Secrets Manager.
   - `.env.example` holds only local-development values.
8. **No PHI anywhere in the repository.** That covers fixtures, tests, logs and screenshots. Test data is synthetic (Bible §28.1).
9. **Every material decision** gets an ADR in `ARCHITECTURE_DECISIONS.md` and an entry in `CHANGELOG.md` before implementation (Bible §0).

## 6. Where new things go

| Adding… | Put it in | Also update |
|---|---|---|
| An endpoint or DTO | `packages/api-contracts/src/…` (register it in `openapi.ts`), then implement in `services/api` | `openapi.json` (`pnpm --filter @aestara/api-contracts build`); spec §6.3 if the catalog changes |
| A table or constraint | `packages/database` migration (from Layer 1) plus the layer's `constraints.sql` fragment | `docs/technical-spec/schema.prisma` and `constraints.sql` stay the design reference; DB behaviour suite |
| A design token | `packages/design-tokens/tokens.json`, then run `pnpm tokens` | contrast test pairs if it is a text/background role |
| An iOS feature | The owning module under `apps/ios-provider/Modules/<Module>` | `modules.json` if dependencies change |
| An AWS resource | A module under `infrastructure/terraform/modules`, wired through `modules/platform` | `INFRASTRUCTURE.md` |
| A CI gate | `.github/workflows/ci.yml` | `TESTING_STRATEGY.md`, `DEPLOYMENT.md` |

## 7. CI jobs

| Job | Runs on | Gates (Bible §28.2) |
|---|---|---|
| `workspace` | ubuntu | Biome lint/format, typecheck, unit tests, build, generated-file drift (tokens, OpenAPI, shared enums), database schema, catalog and constraint migrations match the design, oasdiff breaking changes, iOS module rules |
| `spec` | ubuntu + PostgreSQL 18 | Bible → spec traceability, Bible export drift, documentation pack and references, design schema validity plus every behaviour fragment |
| `database` | ubuntu + PostgreSQL 18 | Migrations applied as a non-superuser, no drift against the schema, ownership/RLS/grant check, the built layers' behaviour fragments plus the RLS suite; RLS benchmark report (ADR-0004) |
| `terraform` | ubuntu | fmt, validate (all roots), tflint (Terraform + AWS), checkov |
| `security` | ubuntu | OSV-Scanner on `pnpm-lock.yaml` |
| `ios` | macOS 26, Xcode 26.6 | Tuist generate, build provider and patient apps, DesignSystem tests on the simulator |

The container scanning and `terraform plan` review gates arrive when there is something to scan and an account to plan against (Layer 1; see [DEPLOYMENT.md](DEPLOYMENT.md)).
