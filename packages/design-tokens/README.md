# @aestara/design-tokens

One source (`tokens.json`) for colour, typography, spacing, shape, elevation and motion. It is compiled into:

| Output | Consumer |
|---|---|
| `generated/tokens.css` | Admin web, design prototype (CSS custom properties, light + dark) |
| `generated/tokens.ts` | TypeScript code that needs raw values |
| `generated/DesignTokens.swift` | Provider and patient iOS apps (`DSColor`, `DSFont`, `DSSpacing`, `DSRadius`, `DSSize`, `DSMotion`) |

```bash
pnpm tokens                                    # regenerate after editing tokens.json
pnpm --filter @aestara/design-tokens test      # WCAG contrast gate (text ≥ 4.5:1, UI ≥ 3:1, both themes)
```

Rules:

- Never hard-code a colour or spacing value in an app. Add or adjust a token instead.
- Generated files are committed so Xcode builds don't need Node; CI fails if they drift from `tokens.json`.
- Type styles mirror iOS Dynamic Type text styles, so the apps scale with the user's text-size setting.

See `docs/DESIGN_SYSTEM.md`.
