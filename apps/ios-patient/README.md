# Patient iOS app

SwiftUI app that shows a patient only what their practice has explicitly released (Bible §13).

**Status:** Layer 0 skeleton. The Tuist project builds in CI. It reuses the provider app's DesignSystem, CoreNetworking and CoreSecurity modules (spec §2.2), and the module-graph check enforces that it uses no others. Its screens arrive in Layer 5.

```bash
mise install && tuist generate                 # AestaraPatient.xcworkspace (never committed)
```

Architecture: [`docs/IOS_ARCHITECTURE.md`](../../docs/IOS_ARCHITECTURE.md).
