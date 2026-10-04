// Step-up (ADR-0021; ADR-0027): actions such as exports need a second factor
// within the last 15 minutes. When the api answers `403
// REAUTHENTICATION_REQUIRED`, this sheet signs the user in again, as the same
// user in the same organization, with their password and, when the account
// has one, their authenticator code. Nothing on the device is cleared.
// Bible §21.1 · tier: platform · Layer 3.
import CoreNetworking
import DesignSystem
import SwiftUI

public struct ConfirmIdentityView: View {
    let store: AuthStore
    let reason: String
    let confirmed: () -> Void
    @State private var password = ""
    @State private var code = ""
    @State private var challenge: MFAChallenge?
    @State private var error: String?
    @State private var busy = false
    @Environment(\.dismiss) private var dismiss

    /// `reason` says what the confirmation is for, in a sentence.
    public init(store: AuthStore, reason: String, confirmed: @escaping () -> Void) {
        self.store = store
        self.reason = reason
        self.confirmed = confirmed
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    Text(reason).font(DSFont.body).foregroundStyle(DSColor.textSecondary)
                    if let error { DSBanner(error, tone: .danger) }
                    if let challenge {
                        Text("Enter the 6-digit code from your authenticator app.")
                            .font(DSFont.body).foregroundStyle(DSColor.textSecondary)
                        DSTextField("Code", text: $code, prompt: "6 digits")
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                            .accessibilityIdentifier("stepUp.code")
                        Button("Verify") {
                            Task {
                                await run { () async throws(APIError) in
                                    try await store.confirmIdentity(challenge: challenge, code: code)
                                    finish()
                                }
                            }
                        }
                        .buttonStyle(DSButtonStyle())
                        .disabled(busy || code.count != 6)
                        .accessibilityIdentifier("stepUp.verify")
                    } else {
                        DSTextField("Password", text: $password, isSecure: true)
                            .textContentType(.password)
                            .accessibilityIdentifier("stepUp.password")
                        Button("Continue") {
                            Task {
                                await run { () async throws(APIError) in
                                    if let next = try await store.confirmIdentity(password: password) {
                                        if next.enrollmentRequired {
                                            error = String(localized: "Your account needs an authenticator first. Sign out and sign in again to set it up.")
                                        } else {
                                            challenge = next
                                        }
                                    } else {
                                        finish()
                                    }
                                }
                            }
                        }
                        .buttonStyle(DSButtonStyle())
                        .disabled(busy || password.isEmpty)
                        .accessibilityIdentifier("stepUp.continue")
                    }
                }
                .padding(DSSpacing.xxl)
            }
            .background(DSColor.canvas)
            .navigationTitle("Confirm it's you")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }

    private func finish() {
        password = ""
        code = ""
        confirmed()
    }

    private func run(_ action: () async throws(APIError) -> Void) async {
        busy = true
        error = nil
        defer { busy = false }
        do throws(APIError) {
            try await action()
        } catch {
            self.error = error.displayMessage
        }
    }
}
