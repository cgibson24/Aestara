// Account and security settings (Bible §17, §21.1): who is signed in, which
// organization is active, switching organization and signing out.
// Tier: feature · Layer 1.
import Authentication
import CoreNetworking
import DesignSystem
import SwiftUI

/// What signing out would delete, asked before the confirmation (ADR-0023 K2-17):
/// photos still on this device are lost with the sign-out.
public struct SignOutCheck: Sendable {
    /// Tries once more to upload, then counts the photos still waiting.
    public let unsentPhotos: @MainActor @Sendable () async -> Int
    /// Deletes this user's queued photos and cached images.
    public let purge: @MainActor @Sendable () async -> Void

    public init(unsentPhotos: @escaping @MainActor @Sendable () async -> Int, purge: @escaping @MainActor @Sendable () async -> Void) {
        self.unsentPhotos = unsentPhotos
        self.purge = purge
    }
}

public struct SettingsView: View {
    let store: AuthStore
    let signOutCheck: SignOutCheck?
    @State private var error: String?
    @State private var confirmSignOut = false
    @State private var checking = false
    @State private var unsent = 0

    public init(store: AuthStore, signOutCheck: SignOutCheck? = nil) {
        self.store = store
        self.signOutCheck = signOutCheck
    }

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
                Button(role: .destructive) {
                    Task { await prepareSignOut() }
                } label: {
                    HStack {
                        Text("Sign out")
                        if checking {
                            Spacer()
                            ProgressView().accessibilityLabel("Checking for photos waiting to upload")
                        }
                    }
                }
                .disabled(checking)
                .accessibilityIdentifier("settings.signOut")
            } footer: {
                Text("Signing out ends this session on the server and removes the saved sign-in, cached photos and photos still waiting to upload from this device.")
            }
        }
        .navigationTitle("Settings")
        .confirmationDialog(signOutTitle, isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button(unsent == 0 ? String(localized: "Sign out") : String(localized: "Sign out and delete photos"), role: .destructive) {
                Task {
                    await signOutCheck?.purge()
                    await store.signOut()
                }
            }
            .accessibilityIdentifier("settings.signOutConfirm")
            Button("Stay signed in", role: .cancel) {}
        } message: {
            if unsent > 0 {
                Text("They have not reached the server. Signing out deletes them from this device, and they cannot be recovered.")
            }
        }
    }

    private var signOutTitle: String {
        switch unsent {
        case 0: String(localized: "Sign out of Aestara?")
        case 1: String(localized: "1 photo has not uploaded")
        default: String(localized: "\(unsent) photos have not uploaded")
        }
    }

    private func prepareSignOut() async {
        checking = true
        unsent = await signOutCheck?.unsentPhotos() ?? 0
        checking = false
        confirmSignOut = true
    }
}
