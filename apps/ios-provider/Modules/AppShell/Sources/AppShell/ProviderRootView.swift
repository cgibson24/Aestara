// Composition root of the provider app (Bible §24.4–24.5). It owns navigation
// and wires the feature modules together: sign-in until a session exists, then
// the adaptive shell (sidebar on iPad, tab bar on iPhone; docs/DESIGN_SYSTEM.md §4).
// Bible §24.4–24.5 · tier: app · Layer 1.
import Authentication
import CoreSecurity
import DesignSystem
import PatientDomain
import Photography
import Settings
import SwiftUI

public struct ProviderRootView: View {
    @State private var store: AuthStore
    /// Photography of the signed-in user in the active organization (ADR-0023 K2-17).
    @State private var photography: PhotographyContext?
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
                if let photography {
                    SignedInShell(store: store, photography: photography)
                } else {
                    DSStateView(.loading("Signing you in"))
                }
            }
        }
        .background(DSColor.canvas)
        .privacyCover()
        .task { await store.restore() }
        .onChange(of: scope, initial: true) { _, scope in
            open(scope)
        }
        .onChange(of: store.phase) { _, phase in
            // The session ended without a sign-out (expiry, revocation, failed unlock): cached
            // images go; queued photos stay sealed until this user signs in here again.
            if case .signedOut = phase, let context = photography {
                photography = nil
                Task { await context.purgeCache() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: store.didEnterBackground()
            case .active:
                store.willEnterForeground()
                if let photography { Task { await photography.sync() } }
            default: break
            }
        }
    }

    /// The user and organization whose photos, cache and offline records may be opened.
    private var scope: StoreScope? {
        guard let session = store.session, let organizationId = session.organizationId else { return nil }
        return StoreScope(userId: session.userId, organizationId: organizationId)
    }

    private func open(_ scope: StoreScope?) {
        guard let scope, let session = store.session else { return }
        if photography?.scope == scope {
            photography?.updatePermissions(session.permissions)
            return
        }
        let context = PhotographyContext(client: store.client, scope: scope, permissions: session.permissions)
        photography = context
        // After sign-in: re-validated, so offline views replay, then the queue (spec §8 rule 5).
        Task { await context.sync() }
    }
}

/// Patients and Settings. `.sidebarAdaptable` shows a sidebar on iPad and a tab bar on iPhone.
struct SignedInShell: View {
    let store: AuthStore
    let photography: PhotographyContext
    @State private var section: Section = .patients

    enum Section: Hashable { case patients, settings }

    var body: some View {
        TabView(selection: $section) {
            Tab("Patients", systemImage: "person.2", value: Section.patients) {
                PatientsSplitView(repository: PatientRepository(client: store.client), session: store.session, photography: photography)
            }
            Tab("Settings", systemImage: "gearshape", value: Section.settings) {
                NavigationStack { SettingsView(store: store, signOutCheck: signOutCheck) }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tint(DSColor.accent)
        // Reconnecting replays offline views, then the queue (spec §8 rule 5).
        .task { await photography.monitorConnectivity() }
        // A different organization is a different tenant: rebuild every screen.
        .id(store.session?.organizationId)
    }

    /// Signing out deletes photos still on this device, so it asks first (ADR-0023 K2-17).
    private var signOutCheck: SignOutCheck {
        let photography = self.photography
        return SignOutCheck(
            unsentPhotos: { await photography.unsentBeforeSignOut() },
            purge: { await photography.purgeForSignOut() }
        )
    }
}
