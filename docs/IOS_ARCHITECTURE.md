# iOS architecture

| | |
|---|---|
| Version | 1.0 |
| Status | Layer 0 baseline, 2026-09-28 |
| Authority | Bible §2, §13, §23, §24.1–24.5, §21.1–21.2; ADR-0005 (iOS/iPadOS 26, intuitive controls), ADR-0011 (one token source) |
| Normative sources | spec §2.2 (client stack), spec §4.2 (authentication on devices), spec §8 (offline and sync contract), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); `apps/ios-provider/Modules/modules.json`, `apps/ios-provider/Project.swift`, `apps/ios-patient/Project.swift` |

This document describes how the two iOS apps are built:
- **Provider iPad/iPhone app:** surgeons, injectors, nurses, photographers, consultants and front desk.
- **Patient iPhone app.**

It covers the module structure, the rules that keep it clean, how offline work and security are handled on the device, and how it is built and tested.

## 1. Platform and stack

| Area | Choice | Source |
|---|---|---|
| Minimum OS | iOS/iPadOS **26** | D-05, ADR-0005 |
| Language and UI | Swift 6 language mode with complete strict-concurrency checking, SwiftUI, Swift Concurrency | [B §24.3], spec §2.2 |
| Frameworks | AVFoundation, Vision, CoreML, Metal (where useful), CryptoKit, LocalAuthentication, Keychain, URLSession, BackgroundTasks. ARKit is reserved for the future 3D layer only. | [B §24.3] |
| Packages | Swift Package Manager: one local package per Bible §24.4 module | spec §2.2 |
| Project generation | **Tuist** (Swift manifests); generated `.xcodeproj`/`.xcworkspace` are never committed | [B §31] "reproducible method", spec §2.2 |
| API client | Generated from `packages/api-contracts/openapi.json` by swift-openapi-generator, inside CoreNetworking | spec §2.2, §6.8 |
| Offline store | GRDB (SQLite) with SQLCipher; key in the Keychain; Data Protection class *Complete* | [B §23.3], spec §2.2 |
| Toolchain in CI | macOS 26 runner, Xcode 26.6, Swift tools 6.2 | `.github/workflows/ci.yml` |

## 2. Repository layout

```text
apps/ios-provider/
├── Project.swift               Tuist: app target "AestaraProvider" (iPhone + iPad), depends on AppShell
├── Sources/AestaraProviderApp.swift   @main; hosts AppShell.ProviderRootView
├── Modules/
│   ├── modules.json            tier, Bible section, layer and allowed dependencies of every module
│   └── <Module>/Package.swift  one local Swift package per Bible §24.4 module (20)
└── scripts/check_module_graph.py   architecture rules, run in CI (no Swift needed)
apps/ios-patient/
├── Project.swift               Tuist: app target "AestaraPatient" (iPhone)
└── Sources/AestaraPatientApp.swift
```

The patient app reuses three provider modules: DesignSystem, CoreNetworking and CoreSecurity (spec §2.2). It has no module of its own in Layer 0; its screens arrive with Layer 5.

## 3. Module graph

Every module belongs to a tier. Dependencies may only point to a lower tier, with same-tier dependencies allowed in the foundation and domain tiers. **Feature modules never depend on other feature modules.** Anything two features share moves down into a domain or platform module.

```mermaid
flowchart TB
  subgraph app [App]
    AppShell
  end
  subgraph feature [Features]
    Photography
    Annotations
    BeforeAfter
    Simulation
    TreatmentPlans
    DocumentsConsent
    Education
    Appointments
    Messaging
    Telehealth
    Settings
  end
  subgraph domain [Domain]
    PatientDomain
    ConsultationDomain
  end
  subgraph platform [Platform services]
    Authentication
    Media
  end
  subgraph foundation [Foundation]
    DesignSystem
    CoreSecurity
    CoreNetworking
    AuditSupport
  end
  app --> feature
  feature --> domain
  feature --> platform
  domain --> foundation
  platform --> foundation
  feature --> foundation
```

| Module | Tier | Bible | Responsibility | Built from |
|---|---|---|---|---|
| DesignSystem | foundation | §24.1–24.2 | Design tokens (generated), shared SwiftUI components and view states | Layer 0 (tokens); Layer 1 (components) |
| CoreSecurity | foundation | §21.2, §23.3 | Keychain, encrypted store (GRDB + SQLCipher), biometric gate, secure wipe | Layer 1 |
| CoreNetworking | foundation | §20 | Generated API client, request correlation, idempotency keys, error envelope | Layer 1 |
| AuditSupport | foundation | §22, §23.3 | Client audit context; offline audit replay queue | Layer 2 |
| Authentication | platform | §21.1 | Sign-in, MFA, token refresh, biometric unlock, revocation handling | Layer 1 |
| Media | platform | §6.6, §21.2 | Signed upload/download, checksums, encrypted media cache | Layer 2 |
| PatientDomain | domain | §4, §23 | Patient models, search, create with duplicate check, cached recent patients | Layer 1 |
| ConsultationDomain | domain | §5 | Consultation lifecycle, notes and concerns (spec §5.4.1) | Layer 3 |
| Photography | feature | §6 | Guided capture, live guidance, ghost overlay, capture review, upload queue | Layer 2 |
| Annotations | feature | §6.6 | Annotation layers kept separate from the immutable original | Layer 3 |
| BeforeAfter | feature | §8 | Five comparison modes; display-only alignment | Layer 3 |
| Simulation | feature | §9 | Visualization request, provider review, approve, then separate release, with the disclaimer | Layer 8 |
| TreatmentPlans | feature | §11 | Plans A/B/C, estimates, procedure tracking | Layer 4 |
| DocumentsConsent | feature | §12 | Consent assignment and signing, staff-assisted signing mode | Layer 4 |
| Education | feature | §12.5 | Education content and care instructions | Layer 4 |
| Appointments | feature | §15 | Schedule and appointment lifecycle | Layer 6 |
| Messaging | feature | §14 | Secure messaging with attachments | Layer 5 |
| Telehealth | feature | §16 | Virtual consultations through the approved vendor SDK | Layer 6 |
| Settings | feature | §17, §21.1 | Account, security and device settings | Layer 1 |
| AppShell | app | §24.4–24.5 | Composition root: adaptive navigation, routing, deep links | Layer 1 |

The exact allowed dependencies of each module are in `modules.json`, and each `Package.swift` must match it. `check_module_graph.py` enforces the following in CI (`workspace` and `ios` jobs) and fails the build on any violation:
- the module set equals Bible §24.4
- `Package.swift` files match `modules.json`
- the tier rules hold, and there are no cycles
- the patient app's dependency closure stays within its three modules
- the Swift tokens match the token package

**Layer 0 state.**
- DesignSystem contains the generated tokens and their tests.
- AppShell contains the root view, which shows only the brand name until Layer 1 adds sign-in and navigation.
- Every other module holds a documented boundary (its responsibility and Bible section) and no code, because Bible §30 forbids faking behaviour before its layer.

## 4. Adaptive layout and navigation

One scene definition serves iPad and iPhone and adapts on horizontal size class ([B §24.5], [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §4):
- **iPad (regular):** `NavigationSplitView` with a 264-pt sidebar and a 340-pt list pane.
- **iPhone (compact):** a `TabView` with Patients, Schedule, Capture, Messages and More, plus large titles and push navigation.

AppShell owns the navigation model. Features expose views and routes but never navigate across each other directly. The intuitive-controls rules C1–C15 in DESIGN_SYSTEM.md §2 are binding (ADR-0005); every feature's UI goes through the checklist in DESIGN_SYSTEM.md §11.

**Deep links re-authorize.** Opening a link to a patient, photo or consent goes through the normal authorization path and never trusts cached UI state ([B §24.5], spec §8 rule 5).

## 5. Data flow inside a feature

```mermaid
flowchart LR
  view["SwiftUI view"] --> model["@Observable view model<br/>MainActor"]
  model --> repo["Domain repository<br/>actor"]
  repo --> client["CoreNetworking<br/>generated client"]
  repo --> store["CoreSecurity store<br/>GRDB + SQLCipher"]
  repo --> queue["Mutation queue<br/>(offline)"]
  queue --> client
```

- **Views stay thin.** State and actions live in `@Observable` view models on the main actor. Domain repositories are actors that own networking and persistence.
- **DTOs stop at the repository.** Generated API types are mapped to domain models inside the repository. Views never see transport types (Bible §31, DTO/persistence separation).
- **The server decides.** The app hides actions the user's permissions do not include, but authorization is always enforced server-side. A `403`/`404` from the server is handled as the real answer (spec §4.6).
- **Every data view implements the six view states:** normal, loading, empty, error, permission denied and offline (DESIGN_SYSTEM.md §6).

## 6. Offline and synchronization

The device follows spec §8 exactly; this is the implementation shape.

| Rule | How |
|---|---|
| What works offline | Cached recent patients, photo capture, note drafts, annotating cached photos, queueing uploads and mutations [B §23.1]. AI generation, EMR sync, release, export, sign-off, permission changes and consent completion need a connection [B §23.2]; the UI disables them with the offline banner. |
| Encrypted at rest | GRDB + SQLCipher database; cached media encrypted with CryptoKit AES-GCM; keys in the Keychain; files use Data Protection *Complete* (spec §7.1). |
| Mutation queue | Each operation stores a UUIDv7 `operationId`, which is sent as `Idempotency-Key`. Creates also store a client-generated `id`, and updates the resource `version`, which is sent as `If-Match`. Operations replay in order per aggregate; a failed dependency pauses only its dependents (spec §8 rules 1–3). |
| Conflicts | `412 VERSION_CONFLICT` is shown to the user with both versions. Nothing is auto-resolved by timestamp [B §23.3]. |
| Reconnect | Re-validate the session (`GET /auth/session`), replay offline audit records first (`POST /audit/offline-events`), then mutations (spec §8 rules 5 and 8). |
| Originals | Stored encrypted with their SHA-256. They are purged locally only after the server confirms the checksum on `complete-upload` (spec §8 rule 6). |
| Cache policy | Maximum patients, maximum age, and purge on sign-out or device revocation, from `PracticeSetting` (UD-25 baseline: 25 recent patients, 7 days). |

## 7. Security on the device

| Concern | Design |
|---|---|
| Tokens | Short-lived access token in memory. The refresh token is in the Keychain, gated by biometrics (spec §4.2). A background app requires Face ID or Touch ID again after the configured time: 5 minutes by default for the provider app. |
| Step-up | Signing and export require a fresh biometric check on the device, and the server also requires a recent MFA verification (spec §4.2). |
| Staff-assisted signing | The consent-scoped hand-off locks the app to the consent. Leaving it needs staff re-authentication (UD-31, DESIGN_SYSTEM.md C13). |
| No PHI leaks | No PHI in logs, analytics, crash reports, notification payloads, URLs or pasteboard defaults (Bible §21.2, spec §7.2). Notifications carry only a deep-link identifier. |
| Sign-out and revocation | Wipe the local database, cached media, keys and queued mutations. Unsent offline audit records are reported through the security runbook (spec §8 rule 8). |
| Transport | TLS only, with App Transport Security at its defaults (no exceptions). |

## 8. Build, test and run

```bash
mise install                              # installs the pinned Tuist (mise.toml)
cd apps/ios-provider && tuist generate    # opens AestaraProvider.xcworkspace
cd apps/ios-patient && tuist generate     # opens AestaraPatient.xcworkspace
python3 apps/ios-provider/scripts/check_module_graph.py   # architecture rules
pnpm tokens                               # after editing packages/design-tokens/tokens.json
```

| Test level | Tool | Where | From |
|---|---|---|---|
| Design tokens | Swift Testing | `Modules/DesignSystem/Tests` | Layer 0 |
| View models and domain logic | Swift Testing | each module's `Tests/` | Layer 1 |
| Mutation queue, offline replay, conflict surfacing | Swift Testing with an in-memory store | CoreSecurity, PatientDomain, Photography | Layers 1–2 |
| UI automation for critical flows | XCUITest | app targets | Layer 1 onward [B §27.1] |
| Accessibility | XCUITest audits (Dynamic Type, VoiceOver labels) plus the token contrast gate | app targets | Layer 1 onward |

The CI `ios` job generates both projects, builds both apps for the simulator (the provider app for iPhone and iPad) and runs the DesignSystem tests on an iPhone simulator. Each layer adds its module tests to the job.

## Open items

| Item | Decision point |
|---|---|
| Apple Developer team and bundle identifier prefix (`com.aestara.*` is provisional) | UD-34, before the first TestFlight build (end of Layer 1) |
| Tuist version pin (currently resolved by mise from `mise.toml`) | Pinned from the first macOS CI run, in Layer 0 |
| Keychain accessibility class and exact biometric flags (`.biometryCurrentSet` does not itself give a passcode fallback) | Layer 1 (M1.9), see [AUTHENTICATION_ARCHITECTURE.md](AUTHENTICATION_ARCHITECTURE.md) |
| Snapshot-testing tool for SwiftUI views | Layer 1 kickoff |
| App-switcher privacy screen and jailbreak signals | Layer 1 kickoff, see [THREAT_MODEL.md](THREAT_MODEL.md) |
