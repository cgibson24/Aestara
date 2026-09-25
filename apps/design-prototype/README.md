# @aestara/design-prototype

**Static design prototype (ADR-0009).** It uses hard-coded, fictional data and has no backend and no authentication. It is never deployed as the product.

It shows the core scenes at true device sizes so the look and the controls can be reviewed before any feature is built. The rules it demonstrates are in [`docs/DESIGN_SYSTEM.md`](../../docs/DESIGN_SYSTEM.md).

```bash
pnpm dev:prototype                                   # http://localhost:5173
pnpm --filter @aestara/design-prototype test         # every scene in every view state + safety-copy checks
pnpm --filter @aestara/design-prototype build        # dist/ and a single-file dist-artifact/aestara-design-prototype.html
```

## Using the viewer

- **Surface:** provider iPad (1180 × 820), provider iPhone (393 × 852), patient iPhone, admin web (1280 × 820).
- **State:** normal, loading, empty, error, offline, permission denied.
- **Theme:** light, dark, or follow the system.
- **Deep link:** `#<surface>-<scene>`, for example `#ipad-consultation`, `#iphone-capture`, `#patient-plan` or `#admin-audit`.

## Layout

| Path | Contents |
|---|---|
| `src/prototype/Prototype.tsx` | The viewer: device frames, scene list, state and theme switches |
| `src/scenes/` | Provider, patient and admin scenes |
| `src/ui/kit.tsx`, `src/ui/shells.tsx` | Shared components and the adaptive app shells (sidebar on iPad, tab bar on iPhone) |
| `src/ui/icons.tsx`, `src/ui/Portrait.tsx` | Original line icons and illustrated placeholder photos (no real photographs) |
| `src/data/fixtures.ts` | Synthetic data |
| `src/styles/app.css` | All styling, from `@aestara/design-tokens` custom properties only; iPhone overrides are at the end in one container query |
| `scripts/build-artifact.mjs` | Inlines the build into one shareable HTML file (React from cdnjs) |
