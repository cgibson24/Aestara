// Composition root of the provider app (Bible §24.4–24.5). It owns navigation
// and wires the feature modules together: sign-in until a session exists, then
// the adaptive shell (sidebar on iPad, tab bar on iPhone; docs/DESIGN_SYSTEM.md §4).
// Bible §24.4–24.5 · tier: app · Layer 1.
import Authentication
import DesignSystem
import PatientDomain
import Settings
import SwiftUI

public struct ProviderRootView: View {
    @State private var store: AuthStore
    @Environment(\.scenePhase) private var scenePhase

    public init(store: AuthStore) {
        _store = State(initialValue: store)
    }

    public var body: some View {
        Group {
            switch store.phase {
            case .restoring:
                DSStateView(.loading("Signing you in"))
            case let .signedOut(notice):
                SignInView(store: store, notice: notice)
            case let .secondFactor(challenge):
                SecondFactorView(store: store, challenge: challenge)
            case .chooseOrganization:
                OrganizationPickerView(store: store)
            case .locked:
                LockedView(store: store)
            case .signedIn:
                SignedInShell(store: store)
            }
        }
        .background(DSColor.canvas)
        .privacyCover()
        .task { await store.restore() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: store.didEnterBackground()
            case .active: store.willEnterForeground()
            default: break
            }
        }
    }
}

/// Patients and Settings. `.sidebarAdaptable` shows a sidebar on iPad and a tab bar on iPhone.
struct SignedInShell: View {
    let store: AuthStore
    @State private var section: Section = .patients

    enum Section: Hashable { case patients, settings }

    var body: some View {
        TabView(selection: $section) {
            Tab("Patients", systemImage: "person.2", value: Section.patients) {
                PatientsSplitView(repository: PatientRepository(client: store.client), session: store.session)
            }
            Tab("Settings", systemImage: "gearshape", value: Section.settings) {
                NavigationStack { SettingsView(store: store) }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tint(DSColor.accent)
        // A different organization is a different tenant: rebuild every screen.
        .id(store.session?.organizationId)
    }
}
