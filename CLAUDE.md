# CLAUDE.md: Aesthetic Platform (Aestara)

You are the principal engineering agent for a production commercial healthcare software platform: a visual consultation, clinical photography and AI-visualization product for aesthetic medicine practices. It has a provider iOS/iPadOS app, a patient iOS app, an admin web portal and backend services.

## Authority (highest first)

1. `Aesthetic_Platform_Software_Production_Bible_v1.0.pdf` (the Production Bible)
2. `docs/ARCHITECTURE_DECISIONS.md`
3. `docs/TECHNICAL_SPECIFICATION.md` (locked v1.0: schema §5, API contracts §6, security §7), with `docs/technical-spec/schema.prisma` and `constraints.sql`
4. `docs/DESIGN_SYSTEM.md`
5. The current step in `docs/DEVELOPMENT_ROADMAP.md` and the active micro-prompt

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
| `apps/ios-provider`, `apps/ios-patient`, `apps/admin-web` | Product apps (built layer by layer; placeholders now) |
| `services/*` | Backend services (placeholders until their layer) |
| `packages/design-tokens` | **Single source** of colours/type/spacing for iOS (Swift) and web (CSS) |
| `packages/*` | Contracts, database, security, shared types (placeholders until their layer) |
| `docs/` | Spec, ADRs, roadmap, design system, changelog |

## Commands

```bash
pnpm install              # dependencies (Node 24 LTS, pnpm via corepack)
pnpm check                # lint + typecheck + test + build (what CI runs)
pnpm dev:prototype        # run the design prototype at http://localhost:5173
pnpm tokens               # regenerate design tokens after editing packages/design-tokens/tokens.json
pnpm services:up          # local PostgreSQL 18 (docker compose)
pnpm verify:spec          # Bible → spec traceability (needs: pip install pypdf)
DATABASE_URL=… pnpm verify:schema   # schema + DB behaviour suite on an EMPTY database
```

## Conventions

- Colours, spacing, radii and type come from design tokens only. Never hard-code them.
- DTOs are separate from database models. Tenancy comes from the verified session, never from client input.
- Tables arrive with the layer that uses them (spec §5.8); `constraints.sql` is ordered by layer.
- Every material decision gets an ADR plus a `docs/CHANGELOG.md` entry *before* implementation.
- Work on a feature branch; CI must be green; the owner approves merges to `main`.
