# CLAUDE.md: Aesthetic Platform (Aestara)

You are the principal engineering agent for a production commercial healthcare software platform: a visual consultation, clinical photography and AI-visualization product for aesthetic medicine practices. It has a provider iOS/iPadOS app, a patient iOS app, an admin web portal and backend services.

## Authority (highest first)

1. `Aesthetic_Platform_Software_Production_Bible_v1.0.pdf` (the Production Bible)
2. `docs/ARCHITECTURE_DECISIONS.md`
3. `docs/TECHNICAL_SPECIFICATION.md` (locked v1.0: schema §5, API contracts §6, security §7), with `docs/technical-spec/schema.prisma` and `constraints.sql`
4. `docs/DESIGN_SYSTEM.md`
5. The current step in `docs/DEVELOPMENT_ROADMAP.md` and the active micro-prompt

The Layer 0 documentation pack (`docs/*.md`, index in `docs/REPOSITORY_STRUCTURE.md`) explains and links the spec; it never overrides it (ADR-0012). At each layer kickoff, resolve the findings carried to that layer in `docs/ACCEPTANCE_CRITERIA.md` §5.

If something conflicts, the higher source wins. If behaviour is genuinely undefined and would create a permanent dependency, record an unresolved decision; don't invent it.

## Development Constitution (Bible §30, binding)

- Do not copy proprietary vendor code, graphics, trade dress, content or private APIs (e.g. TouchMD).
- Do not invent locked product behaviour.
- Do not build UI that bypasses backend authorization, persistence, audit, validation or tests. The only exception is the labelled static design prototype in `apps/design-prototype` (ADR-0009), which is never the product.
- Enforce tenancy server-side. Patient data may be shared across practices of **one organization** and never across organizations (ADR-0001).
- Never destructively edit original clinical photos.
- Never infer marketing, research or AI-training permission from clinical consent.
- Never expose provider drafts or rejected/failed AI simulations to patients.
- Never describe simulations as guaranteed or exact outcomes.
- Never implement automatic dosing, diagnosis or treatment recommendation.
- Never put PHI in logs, analytics, crash reports, URLs or push payloads.
- Use the explicit state machines in spec §5.4.
- Implement only the authorized step/layer. At completion: run tests, do an acceptance review, summarize files/migrations/APIs/security/limitations, and **STOP**.
- No placeholders ("TODO", "implementation goes here") in delivered features unless the active layer explicitly defers them.

## Where things are

| Path | What |
|---|---|
| `apps/design-prototype` | Static design prototype (React + Vite, hard-coded data). `pnpm dev:prototype` |
| `apps/ios-provider`, `apps/ios-patient` | Tuist projects; 20 module packages in `apps/ios-provider/Modules` with a checked tier graph (`modules.json`, ADR-0015) |
| `apps/admin-web` | Admin SPA (placeholder until Layer 1) |
| `services/*` | Backend services (placeholders until their layer) |
| `packages/design-tokens` | **Single source** of colours/type/spacing for iOS (Swift) and web (CSS) |
| `packages/api-contracts` | Zod → OpenAPI 3.1 (`openapi.json`); Layer 0 holds the shared primitives only (ADR-0013) |
| `packages/database` | Prisma schema **generated** from `docs/technical-spec/schema.prisma` for the built layers, migrations, roles and RLS, permission catalog (`src/catalog.ts`), table ownership (`src/ownership.ts`) |
| `packages/shared-types` | Enum values generated from the Prisma schema |
| `packages/security` | Placeholder until its Layer 1 micro-prompt |
| `infrastructure/terraform` | AWS baseline, checked but not applied (ADR-0014) |
| `docs/` | Bible export, spec, ADRs, roadmap, Layer 0 documentation pack, acceptance review, changelog |

## Commands

```bash
pnpm install              # dependencies (Node 24 LTS, pnpm via corepack)
pnpm check                # lint + typecheck + test + build (what CI runs)
pnpm dev:prototype        # run the design prototype at http://localhost:5173
pnpm tokens               # regenerate design tokens after editing packages/design-tokens/tokens.json
pnpm services:up          # local PostgreSQL 18 (docker compose)
pnpm verify:spec          # Bible → spec traceability (needs: pip install pypdf)
DATABASE_URL=… pnpm verify:schema   # design schema + all behaviour fragments on an EMPTY database
ADMIN_DATABASE_URL=… pnpm --filter @aestara/database db:test   # real migrations as non-superuser, drift, RLS, Layer 1 checks
ADMIN_DATABASE_URL=… pnpm --filter @aestara/database bench:rls # RLS performance gate (ADR-0004)
DATABASE_URL=… pnpm --filter @aestara/database db:seed:dev      # local synthetic organization + invited admin
python3 docs/technical-spec/verification/check_docs.py    # documentation pack, references, links
python3 apps/ios-provider/scripts/check_module_graph.py   # iOS module architecture rules
cd apps/ios-provider && tuist generate                    # Xcode projects (macOS; run `mise install` first)
```

## Conventions

- Colours, spacing, radii and type come from design tokens only. Never hard-code them.
- DTOs are separate from database models. Tenancy comes from the verified session, never from client input.
- Tables arrive with the layer that uses them (spec §5.8); `constraints.sql` is ordered by layer.
- Every material decision gets an ADR plus a `docs/CHANGELOG.md` entry *before* implementation.
- Work on a feature branch; CI must be green; the owner approves merges to `main`.
