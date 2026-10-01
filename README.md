# Aestara: Aesthetic Platform

A visual consultation, clinical photography and clinician-controlled AI visualization platform for aesthetic medicine practices. It has three apps, sharing one backend:

- a provider iPad/iPhone app
- a patient iPhone app
- an admin web portal

> **Source of truth:** `Aesthetic_Platform_Software_Production_Bible_v1.0.pdf` → `docs/TECHNICAL_SPECIFICATION.md` (locked v1.0) → `docs/ARCHITECTURE_DECISIONS.md`.
> **Where we are:** `docs/DEVELOPMENT_ROADMAP.md`. Layer 0 was accepted on 2026-09-28. Layer 1 (identity, tenancy, patients) is built; its acceptance review (`docs/ACCEPTANCE_CRITERIA.md` §6) awaits the owner.

## Quick start

Requirements:

- **Node.js 24 LTS** (`.nvmrc`)
- Docker (only for the local database)
- Python 3 (only for spec verification)

pnpm comes from corepack.

```bash
corepack enable
pnpm install
pnpm dev:prototype        # design prototype → http://localhost:5173
pnpm check                # lint + typecheck + tests + build (same as CI)
pnpm services:up          # PostgreSQL 18 and Mailpit for local development
```

Run Layer 1 locally (synthetic data only; the database is dropped when the stack stops):

```bash
pnpm services:up
ADMIN_DATABASE_URL=postgresql://aestara:aestara_local_only@localhost:5432/aestara pnpm dev:stack
pnpm dev:admin            # in a second terminal → open the printed invitation link
```

The provider app (macOS, Xcode 26.6): `mise install`, `cd apps/ios-provider && tuist generate`, then run the Debug build on a simulator; it talks to the api on `http://localhost:3000`.

**Cloud IDE:** open the repo in **GitHub Codespaces** (or any Dev Container host); `.devcontainer/` installs everything. **Claude Code on the web:** `.claude/hooks/session-start.sh` prepares each session automatically.

## Repository map

```
apps/
  design-prototype/   static, clickable design prototype (hard-coded data, no backend)
  ios-provider/       provider iOS/iPadOS app: Tuist project + 20 module packages · sign-in, patients (Layer 1)
  ios-patient/        patient iOS app: Tuist project                             · features from Layer 5
  admin-web/          admin portal (React + Vite SPA)             · sign-in, users and roles, audit (Layer 1)
services/             api (Layer 1) · ai-gateway · image-processing · notifications · integration-service
packages/             design-tokens · api-contracts (OpenAPI 3.1) · database · security · shared-types
infrastructure/       terraform: AWS baseline for dev/staging/production (checked, not applied)
docs/                 Bible export, specification, ADRs, roadmap, Layer 0 documentation pack
```

Placeholders say which layer builds them. Nothing is faked ahead of its layer.

## Verification

```bash
pnpm verify:spec                                   # Bible → spec traceability (pip install pypdf)
DATABASE_URL=postgresql://…/empty_db pnpm verify:schema   # design schema + 101 database behaviour checks
ADMIN_DATABASE_URL=postgresql://…/postgres pnpm --filter @aestara/database db:test   # Layer 1 migrations, RLS, 61 checks, seed
TEST_ADMIN_DATABASE_URL=postgresql://…/postgres pnpm --filter @aestara/api test      # api: auth, tenancy, cross-tenant, patients, audit
TEST_ADMIN_DATABASE_URL=postgresql://…/postgres pnpm --filter @aestara/admin-web e2e # admin portal end to end (after pnpm build)
pnpm --filter @aestara/design-tokens test          # WCAG contrast gate for the palette
python3 docs/technical-spec/verification/check_docs.py    # documentation pack and references
python3 apps/ios-provider/scripts/check_module_graph.py   # iOS module architecture
```

iOS (macOS with Xcode 26.6): `mise install`, then `tuist generate` in `apps/ios-provider` or `apps/ios-patient`. Terraform: see `infrastructure/terraform/README.md`.

CI (`.github/workflows/ci.yml`) runs all of these on every push, plus the RLS benchmark and the end-to-end RLS gate, Terraform checks, dependency, secret and vulnerability scans, CodeQL, and the iOS build, module tests and UI tests against the real api.
