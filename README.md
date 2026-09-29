# Aestara: Aesthetic Platform

A visual consultation, clinical photography and clinician-controlled AI visualization platform for aesthetic medicine practices. It has three apps, sharing one backend:

- a provider iPad/iPhone app
- a patient iPhone app
- an admin web portal

> **Source of truth:** `Aesthetic_Platform_Software_Production_Bible_v1.0.pdf` → `docs/TECHNICAL_SPECIFICATION.md` (locked v1.0) → `docs/ARCHITECTURE_DECISIONS.md`.
> **Where we are:** `docs/DEVELOPMENT_ROADMAP.md`. Layer 0 (architecture foundation) was accepted on 2026-09-28 (`docs/ACCEPTANCE_CRITERIA.md`); Layer 1 is next.

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
pnpm services:up          # PostgreSQL 18 for local development
```

**Cloud IDE:** open the repo in **GitHub Codespaces** (or any Dev Container host); `.devcontainer/` installs everything. **Claude Code on the web:** `.claude/hooks/session-start.sh` prepares each session automatically.

## Repository map

```
apps/
  design-prototype/   static, clickable design prototype (hard-coded data, no backend)
  ios-provider/       provider iOS/iPadOS app: Tuist project + 20 module packages · features from Layer 1
  ios-patient/        patient iOS app: Tuist project                             · features from Layer 5
  admin-web/          admin portal (React + Vite SPA)             · Layer 1+
services/             api · ai-gateway · image-processing · notifications · integration-service
packages/             design-tokens · api-contracts (OpenAPI 3.1) · database · security · shared-types
infrastructure/       terraform: AWS baseline for dev/staging/production (checked, not applied)
docs/                 Bible export, specification, ADRs, roadmap, Layer 0 documentation pack
```

Placeholders say which layer builds them. Nothing is faked ahead of its layer.

## Verification

```bash
pnpm verify:spec                                   # Bible → spec traceability (pip install pypdf)
DATABASE_URL=postgresql://…/empty_db pnpm verify:schema   # design schema + 99 database behaviour checks
ADMIN_DATABASE_URL=postgresql://…/postgres pnpm --filter @aestara/database db:test   # Layer 1 migrations, RLS, 57 checks
pnpm --filter @aestara/design-tokens test          # WCAG contrast gate for the palette
python3 docs/technical-spec/verification/check_docs.py    # documentation pack and references
python3 apps/ios-provider/scripts/check_module_graph.py   # iOS module architecture
```

iOS (macOS with Xcode 26.6): `mise install`, then `tuist generate` in `apps/ios-provider` or `apps/ios-patient`. Terraform: see `infrastructure/terraform/README.md`.

CI (`.github/workflows/ci.yml`) runs all of these on every push, plus the RLS benchmark report, Terraform checks, a dependency vulnerability scan and the iOS build and tests.
