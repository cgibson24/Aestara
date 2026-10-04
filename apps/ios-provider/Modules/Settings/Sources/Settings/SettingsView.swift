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
    /// Tries once more to send, then counts the note drafts and annotation layers written
    /// offline and still waiting (ADR-0026 K3-06).
    public let unsentDrafts: @MainActor @Sendable () async -> Int
    /// Deletes this user's queued photos, drafts and the cached copies.
    public let purge: @MainActor @Sendable () async -> Void

    public init(unsentPhotos: @escaping @MainActor @Sendable () async -> Int,
                unsentDrafts: @escaping @MainActor @Sendable () async -> Int = { 0 },
                purge: @escaping @MainActor @Sendable () async -> Void) {
        self.unsentPhotos = unsentPhotos
        self.unsentDrafts = unsentDrafts
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
    @State private var unsentDrafts = 0

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
                Text("Signing out ends this session on the server and removes the saved sign-in, cached photos and records, and photos and notes still waiting to be sent from this device.")
            }
        }
        .navigationTitle("Settings")
        .confirmationDialog(signOutTitle, isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button(unsent + unsentDrafts == 0 ? String(localized: "Sign out") : String(localized: "Sign out and delete them"), role: .destructive) {
                Task {
                    await signOutCheck?.purge()
                    await store.signOut()
                }
            }
            .accessibilityIdentifier("settings.signOutConfirm")
            Button("Stay signed in", role: .cancel) {}
        } message: {
            if unsent + unsentDrafts > 0 {
                Text("They have not reached the server. Signing out deletes them from this device, and they cannot be recovered.")
            }
        }
    }

    private var signOutTitle: String {
        let photos = unsent == 1 ? String(localized: "1 photo") : String(localized: "\(unsent) photos")
        let drafts = unsentDrafts == 1 ? String(localized: "1 draft") : String(localized: "\(unsentDrafts) drafts")
        switch (unsent, unsentDrafts) {
        case (0, 0): return String(localized: "Sign out of Aestara?")
        case (_, 0): return unsent == 1 ? String(localized: "1 photo has not uploaded") : String(localized: "\(unsent) photos have not uploaded")
        case (0, _): return unsentDrafts == 1 ? String(localized: "1 draft has not been sent") : String(localized: "\(unsentDrafts) drafts have not been sent")
        default: return String(localized: "\(photos) and \(drafts) have not been sent")
        }
    }

    private func prepareSignOut() async {
        checking = true
        unsent = await signOutCheck?.unsentPhotos() ?? 0
        unsentDrafts = await signOutCheck?.unsentDrafts() ?? 0
        checking = false
        confirmSignOut = true
    }
}
