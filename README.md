# Aestara: Aesthetic Platform

A visual consultation, clinical photography and clinician-controlled AI visualization platform for aesthetic medicine practices. It has three apps, sharing one backend:

- a provider iPad/iPhone app
- a patient iPhone app
- an admin web portal

> **Source of truth:** `Aesthetic_Platform_Software_Production_Bible_v1.0.pdf` → `docs/TECHNICAL_SPECIFICATION.md` (locked v1.0) → `docs/ARCHITECTURE_DECISIONS.md`.
> **Where we are:** `docs/DEVELOPMENT_ROADMAP.md`.

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
  ios-provider/       provider iOS/iPadOS app (SwiftUI)          · Layer 1+
  ios-patient/        patient iOS app (SwiftUI)                  · Layer 5+
  admin-web/          admin portal (React + Vite SPA)             · Layer 1+
services/             api · ai-gateway · image-processing · notifications · integration-service
packages/             design-tokens · api-contracts · database · security · shared-types
infrastructure/       terraform (AWS) · local tooling
docs/                 specification, ADRs, roadmap, design system, changelog
```

Placeholders say which layer builds them. Nothing is faked ahead of its layer.

## Verification

```bash
pnpm verify:spec                                   # Bible → spec traceability (pip install pypdf)
DATABASE_URL=postgresql://…/empty_db pnpm verify:schema   # schema + 89 database behaviour checks
pnpm --filter @aestara/design-tokens test          # WCAG contrast gate for the palette
```

CI (`.github/workflows/ci.yml`) runs all of these on every push.
