// The sign-in screens: password, second factor (or first-time authenticator
// setup), organization choice and the biometric unlock after the background
// interval. Copy follows docs/DESIGN_SYSTEM.md §9.
import CoreNetworking
import DesignSystem
import SwiftUI
import UIKit

private struct AuthCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                Text("Aestara").font(DSFont.title2).foregroundStyle(DSColor.accent)
                Text(title).font(DSFont.largeTitle).foregroundStyle(DSColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                content
            }
            .padding(DSSpacing.xxxl)
            .frame(maxWidth: 480)
            .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.lg))
            .padding(DSSpacing.lg)
            .frame(maxWidth: .infinity)
        }
        .background(DSColor.canvas.ignoresSafeArea())
    }
}

public struct SignInView: View {
    let store: AuthStore
    let notice: String?
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    public init(store: AuthStore, notice: String?) {
        self.store = store
        self.notice = notice
    }

    public var body: some View {
        AuthCard(title: "Sign in") {
            if let notice { DSBanner(notice, tone: .info) }
            if let error { DSBanner(error, tone: .danger) }
            DSTextField("Email", text: $email, prompt: "name@practice.com")
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("signin.email")
            DSTextField("Password", text: $password, isSecure: true)
                .textContentType(.password)
                .accessibilityIdentifier("signin.password")
            Button(busy ? "Signing in…" : "Sign in") {
                Task { await submit() }
            }
            .buttonStyle(DSButtonStyle())
            .disabled(busy || email.isEmpty || password.isEmpty)
            .accessibilityIdentifier("signin.submit")
        }
    }

    private func submit() async {
        busy = true
        error = nil
        defer { busy = false }
        do throws(APIError) {
            try await store.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
            password = ""
        } catch {
            self.error = error.displayMessage
        }
    }
}

public struct SecondFactorView: View {
    let store: AuthStore
    let challenge: MFAChallenge
    @State private var code = ""
    @State private var error: String?
    @State private var enrollment: TOTPEnrollment?
    @State private var busy = false

    public init(store: AuthStore, challenge: MFAChallenge) {
        self.store = store
        self.challenge = challenge
    }

    public var body: some View {
        AuthCard(title: challenge.enrollmentRequired ? "Set up your authenticator" : "Enter your code") {
            if let error { DSBanner(error, tone: .danger) }
            if challenge.enrollmentRequired {
                enrollmentSteps
            } else {
                Text("Open your authenticator app and enter the 6-digit code for Aestara.")
                    .font(DSFont.body).foregroundStyle(DSColor.textSecondary)
                codeField
                Button("Verify") { Task { await run { try await store.verify(code: code) } } }
                    .buttonStyle(DSButtonStyle())
                    .disabled(busy || code.count != 6)
                    .accessibilityIdentifier("mfa.verify")
            }
            Button("Use a different account") { Task { await store.signOut() } }
                .buttonStyle(DSButtonStyle(.secondary))
        }
    }

    @ViewBuilder private var enrollmentSteps: some View {
        Text("Your role needs a second factor. Add Aestara to an authenticator app, then enter the code it shows.")
            .font(DSFont.body).foregroundStyle(DSColor.textSecondary)
        if let enrollment {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                Text("Setup key").font(DSFont.subheadline.weight(.semibold))
                Text(enrollment.secret)
                    .font(DSFont.body.monospaced())
                    .textSelection(.enabled)
                    .accessibilityIdentifier("mfa.secret")
                if let url = URL(string: enrollment.otpauthURI) {
                    Link("Add to authenticator app", destination: url)
                }
            }
            codeField
            Button("Confirm authenticator") {
                Task {
                    await run {
                        try await store.confirmEnrollment(id: enrollment.id, code: code)
                        code = ""
                    }
                }
            }
            .buttonStyle(DSButtonStyle())
            .disabled(busy || code.count != 6)
        } else {
            Button("Show my setup key") {
                Task { await run { enrollment = try await store.startEnrollment() } }
            }
            .buttonStyle(DSButtonStyle())
            .disabled(busy)
        }
    }

    private var codeField: some View {
        DSTextField("Code", text: $code, prompt: "6 digits")
            .textContentType(.oneTimeCode)
            .keyboardType(.numberPad)
            .accessibilityIdentifier("mfa.code")
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

public struct OrganizationPickerView: View {
    let store: AuthStore
    @State private var error: String?

    public init(store: AuthStore) { self.store = store }

    public var body: some View {
        AuthCard(title: "Choose an organization") {
            if let error { DSBanner(error, tone: .danger) }
            ForEach(store.session?.memberships.filter(\.isActive) ?? []) { membership in
                Button(membership.name) {
                    Task {
                        do throws(APIError) { try await store.chooseOrganization(membership.id) } catch { self.error = error.displayMessage }
                    }
                }
                .buttonStyle(DSButtonStyle(.secondary))
            }
            Button("Sign out") { Task { await store.signOut() } }
                .buttonStyle(DSButtonStyle(.secondary))
        }
    }
}

/// After 5 minutes in the background: Face ID / Touch ID, or sign in again.
public struct LockedView: View {
    let store: AuthStore

    public init(store: AuthStore) { self.store = store }

    public var body: some View {
        AuthCard(title: "Locked") {
            Text("Aestara was in the background. Confirm it is you to continue.")
                .font(DSFont.body).foregroundStyle(DSColor.textSecondary)
            Button("Unlock") { Task { await store.unlock() } }
                .buttonStyle(DSButtonStyle())
            Button("Sign out") { Task { await store.signOut() } }
                .buttonStyle(DSButtonStyle(.secondary))
        }
        .task { await store.unlock() }
    }
}
