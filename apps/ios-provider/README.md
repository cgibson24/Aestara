# Provider iOS/iPadOS app

SwiftUI app for surgeons, injectors, nurses, photographers, consultants and front desk (Bible §2, §24). It is iPad-landscape first with full iPhone support, and requires iOS/iPadOS 26+ (ADR-0005).

**Status:** Layer 0 skeleton.
- The Tuist project builds in CI for iPhone and iPad.
- The 20 Bible §24.4 modules are local Swift packages under `Modules/`, with a checked tier graph (`Modules/modules.json`, ADR-0015).
- DesignSystem ships the generated design tokens and their tests. Every other module holds its documented boundary only; features arrive layer by layer, starting with Layer 1 (shell, login, patients).

```bash
mise install                                   # Tuist 4.209.0 (repo root mise.toml)
tuist generate                                 # AestaraProvider.xcworkspace (never committed)
python3 scripts/check_module_graph.py          # module architecture rules (also in CI)
```

Architecture: [`docs/IOS_ARCHITECTURE.md`](../../docs/IOS_ARCHITECTURE.md). Design rules: [`docs/DESIGN_SYSTEM.md`](../../docs/DESIGN_SYSTEM.md).
