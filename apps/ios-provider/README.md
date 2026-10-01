# Provider iOS/iPadOS app

SwiftUI app for surgeons, injectors, nurses, photographers, consultants and front desk (Bible §2, §24). It is iPad-landscape first with full iPhone support, and requires iOS/iPadOS 26+ (ADR-0005).

**Status:** Layer 1 (ADR-0022).
- Sign-in with password and TOTP or authenticator enrollment, organization choice, Face ID unlock of the saved sign-in, relock after 5 minutes in the background, and a privacy cover for the app switcher.
- Patients: list and search, create with the duplicate check, and the profile with all twelve tabs (Overview shows demographics; the other tabs fill in with their layers).
- The API client is generated at build time from `Modules/CoreNetworking/Sources/CoreNetworking/openapi.json`.
- The 20 Bible §24.4 modules are local Swift packages under `Modules/`, with a checked tier graph (`Modules/modules.json`, ADR-0015).

The Debug build talks to `http://localhost:3000` (run `pnpm dev:stack` at the root). Release builds have no server address until the domain names are decided (F-32, UD-34).

```bash
mise install                                   # Tuist 4.209.0 (repo root mise.toml)
tuist generate                                 # AestaraProvider.xcworkspace (never committed)
python3 scripts/check_module_graph.py          # module architecture rules (also in CI)
```

Tests: module tests per package (`xcodebuild test -scheme <Module>` in its folder); Keychain tests hosted in the app and UI tests against a running api through the `AestaraProviderTests` scheme (`-only-testing:AestaraProviderTests` or `AestaraProviderUITests`). The UI tests read `UITEST_EMAIL`, `UITEST_PASSWORD`, `UITEST_TOTP_SECRET` and `UITEST_TOTP_LAST_STEP`, which `services/api/scripts/local-stack.ts --ios` prepares; see the `ios` job in `.github/workflows/ci.yml`.

Architecture: [`docs/IOS_ARCHITECTURE.md`](../../docs/IOS_ARCHITECTURE.md). Design rules: [`docs/DESIGN_SYSTEM.md`](../../docs/DESIGN_SYSTEM.md).
