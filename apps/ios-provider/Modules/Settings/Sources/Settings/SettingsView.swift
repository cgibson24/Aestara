// Account and security settings (Bible §17, §21.1): who is signed in, which
// organization is active, switching organization and signing out.
// Tier: feature · Layer 1.
import Authentication
import CoreNetworking
import DesignSystem
import SwiftUI

public struct SettingsView: View {
    let store: AuthStore
    @State private var error: String?
    @State private var confirmSignOut = false

    public init(store: AuthStore) { self.store = store }

    public var body: some View {
        Form {
            if let session = store.session {
                Section("Account") {
                    LabeledContent("Name", value: session.displayName ?? "—")
                    LabeledContent("Email", value: session.email)
                }
                Section("Organization") {
                    LabeledContent("Working in", value: session.organizationName ?? "None chosen")
                    let others = session.memberships.filter { $0.isActive && $0.id != session.organizationId }
                    ForEach(others) { membership in
                        Button("Switch to \(membership.name)") {
                            Task {
                                do throws(APIError) { try await store.chooseOrganization(membership.id) } catch { self.error = error.displayMessage }
                            }
                        }
                    }
                }
            }
            if let error {
                Section { DSBanner(error, tone: .danger) }
            }
            Section {
                Button("Sign out", role: .destructive) { confirmSignOut = true }
                    .accessibilityIdentifier("settings.signOut")
            } footer: {
                Text("Signing out ends this session on the server and removes the saved sign-in from this device.")
            }
        }
        .navigationTitle("Settings")
        .confirmationDialog("Sign out of Aestara?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await store.signOut() } }
            Button("Stay signed in", role: .cancel) {}
        }
    }
}
