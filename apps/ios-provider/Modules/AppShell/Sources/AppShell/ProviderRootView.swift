// Composition root of the provider app (Bible §24.4–24.5). It owns navigation
// and wires the feature modules together: sign-in until a session exists, then
// the adaptive shell (docs/DESIGN_SYSTEM.md §4): on iPad a split view with the
// sections in a sidebar beside each section's own columns, on iPhone a tab bar.
// The iPad shell no longer nests a split view inside a sidebar-adaptable tab
// view (ADR-0026 K3-23, F-70).
// Bible §24.4–24.5 · tier: app · Layers 1–3.
import Authentication
import ConsultationDomain
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
    /// Consultation work of the same user and organization (ADR-0026 K3-06).
    @State private var consultations: ConsultationWork?
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
                if let photography, let consultations {
                    SignedInShell(store: store, photography: photography, consultations: consultations)
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
            // Copies of consultation work go too; queued drafts go with them (spec §8 rule 7).
            if case .signedOut = phase, let work = consultations {
                consultations = nil
                Task { await work.purge() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: store.didEnterBackground()
            case .active:
                store.willEnterForeground()
                if let photography {
                    let consultations = self.consultations
                    Task {
                        await photography.sync()
                        await consultations?.sync()
                    }
                }
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
        let work = ConsultationWork(client: store.client, scope: scope, photography: context, auth: store)
        consultations = work
        // After sign-in: re-validated, so offline views replay, then the queues (spec §8 rule 5).
        Task {
            await context.sync()
            await work.sync()
        }
    }
}

/// Patients and Settings: a tab bar on iPhone; on iPad a split view whose sidebar holds the sections.
struct SignedInShell: View {
    let store: AuthStore
    let photography: PhotographyContext
    let consultations: ConsultationWork
    @State private var section: ShellSection = .patients
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        Group {
            if sizeClass == .compact {
                TabView(selection: $section) {
                    Tab("Patients", systemImage: "person.2", value: ShellSection.patients) {
                        patients(sidebar: nil)
                    }
                    Tab("Settings", systemImage: "gearshape", value: ShellSection.settings) {
                        NavigationStack { settings }
                    }
                }
                .tint(DSColor.accent)
            } else {
                switch section {
                case .patients:
                    patients(sidebar: SectionSidebar(section: $section))
                case .settings:
                    NavigationSplitView {
                        SectionSidebar(section: $section)
                    } detail: {
                        NavigationStack { settings }
                    }
                    .tint(DSColor.accent)
                }
            }
        }
        // Reconnecting replays offline views, then the queues (spec §8 rule 5).
        .task {
            await photography.monitorConnectivity()
        }
        .onChange(of: photography.isOnline) { _, online in
            if online { Task { await consultations.sync() } }
        }
        // A different organization is a different tenant: rebuild every screen.
        .id(store.session?.organizationId)
    }

    private func patients(sidebar: SectionSidebar?) -> some View {
        PatientsSplitView(repository: PatientRepository(client: store.client), session: store.session,
                          photography: photography, consultations: consultations, sidebar: sidebar)
    }

    private var settings: some View {
        SettingsView(store: store, signOutCheck: signOutCheck)
    }

    /// Signing out deletes photos and notes still on this device, so it asks first (ADR-0023 K2-17).
    private var signOutCheck: SignOutCheck {
        let photography = self.photography
        let consultations = self.consultations
        return SignOutCheck(
            unsentPhotos: { await photography.unsentBeforeSignOut() },
            unsentDrafts: { await consultations.unsentBeforeSignOut() },
            purge: {
                await photography.purgeForSignOut()
                await consultations.purge()
            }
        )
    }
}

enum ShellSection: Hashable { case patients, settings }

/// The iPad sidebar: the sections of the app (DESIGN_SYSTEM.md §4, 264 pt).
struct SectionSidebar: View {
    @Binding var section: ShellSection

    var body: some View {
        List {
            sectionButton("Patients", systemImage: "person.2", value: .patients, id: "shell.section.patients")
            sectionButton("Settings", systemImage: "gearshape", value: .settings, id: "shell.section.settings")
        }
        .listStyle(.sidebar)
        .navigationTitle("Aestara")
        .navigationSplitViewColumnWidth(DSSize.sidebarWidth)
    }

    private func sectionButton(_ title: LocalizedStringKey, systemImage: String, value: ShellSection, id: String) -> some View {
        Button {
            section = value
        } label: {
            Label(title, systemImage: systemImage)
                .foregroundStyle(section == value ? DSColor.accentText : DSColor.textPrimary)
        }
        .listRowBackground(section == value ? DSColor.accentSoft : Color.clear)
        .accessibilityAddTraits(section == value ? .isSelected : [])
        .accessibilityIdentifier(id)
    }
}
