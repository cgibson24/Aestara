// Sign-in, MFA, token refresh, biometric unlock and revocation handling for
// the provider app (spec §4.2; ADR-0018 K-22; ADR-0021).
//
// - The access token lives in memory only (`TokenStore`).
// - The refresh token is in the Keychain behind Face ID / Touch ID with the
//   current biometric set; there is no passcode fallback.
// - Any 401 that a refresh cannot fix signs the person out.
// Bible §21.1 · tier: platform · Layer 1.
import CoreNetworking
import CoreSecurity
import Foundation
import Observation
import OpenAPIRuntime

/// The signed-in person and where they work. A UI hint only; the server enforces.
public struct SessionSummary: Sendable, Equatable {
    public struct Membership: Sendable, Equatable, Identifiable {
        public let id: String
        public let name: String
        public let isActive: Bool
    }

    public let userId: String
    public let email: String
    public let displayName: String?
    public let organizationId: String?
    public let organizationName: String?
    public let memberships: [Membership]
    public let permissions: Set<String>

    public func can(_ permission: String) -> Bool { permissions.contains(permission) }

    init(_ s: Components.Schemas.SessionInfo) {
        userId = s.user.id
        email = s.user.email
        displayName = s.user.displayName
        organizationId = s.organization?.id
        organizationName = s.organization?.name
        memberships = s.memberships.map {
            Membership(id: $0.organizationId, name: $0.organizationName, isActive: $0.status == .active)
        }
        permissions = Set(s.permissions)
    }
}

/// Holds the access token and renews it with the refresh token.
actor TokenStore: AccessTokenProviding {
    private let keychain: Keychain
    private var accessToken: String?
    private var refreshToken: String?
    private var renewing: Task<String?, Never>?
    /// A client without the token middleware, so a refresh never recurses.
    private let bare: Client
    private var onEnded: (@Sendable () async -> Void)?
    static let account = "refresh-token"

    init(keychain: Keychain, bare: Client) {
        self.keychain = keychain
        self.bare = bare
    }

    func whenEnded(_ callback: @escaping @Sendable () async -> Void) {
        onEnded = callback
    }

    func store(access: String, refresh: String?) {
        accessToken = access
        if let refresh {
            refreshToken = refresh
            // When the device has no biometrics the token stays in memory: sign-in is needed next launch.
            try? keychain.setBiometryProtected(Data(refresh.utf8), account: Self.account)
        }
    }

    /// Reads the stored refresh token, which shows the Face ID / Touch ID prompt.
    func loadStoredRefreshToken(reason: String) -> Bool {
        guard let data = try? keychain.get(account: Self.account, reason: reason) else { return false }
        refreshToken = String(data: data, encoding: .utf8)
        return refreshToken != nil
    }

    func clear() {
        accessToken = nil
        refreshToken = nil
        try? keychain.delete(account: Self.account)
    }

    func currentAccessToken() async -> String? { accessToken }

    /// Clients serialize refreshes: a refresh token is single-use (ADR-0021).
    func refreshAccessToken() async -> String? {
        if let renewing { return await renewing.value }
        let task = Task { await self.renew() }
        renewing = task
        let token = await task.value
        renewing = nil
        return token
    }

    private func renew() async -> String? {
        guard let refreshToken else { return nil }
        let bare = self.bare
        do throws(APIError) {
            let tokens = try await callAPI {
                try await bare.refreshToken(body: .json(.init(refreshToken: refreshToken))).ok.body.json.data
            }
            store(access: tokens.accessToken, refresh: tokens.refreshToken)
            return tokens.accessToken
        } catch {
            if error.endsSession {
                clear()
                await onEnded?()
            }
            return nil
        }
    }
}

@MainActor
@Observable
public final class AuthStore {
    public enum Phase: Equatable, Sendable {
        case restoring
        case signedOut(notice: String?)
        case secondFactor(MFAChallenge)
        case chooseOrganization
        case signedIn
        /// Back from the background after the lock interval: biometrics again.
        case locked
    }

    public private(set) var phase: Phase = .restoring
    public private(set) var session: SessionSummary?
    /// The client every feature uses: it sends the access token and refreshes it.
    public let client: Client

    private let bare: Client
    private let tokens: TokenStore
    private let device: Components.Schemas.DeviceInfo
    private var backgroundedAt: Date?
    /// Spec §4.2: Face ID / Touch ID again after 5 minutes in the background.
    public static let relockInterval: TimeInterval = 5 * 60

    public init(baseURL: URL, keychain: Keychain = Keychain(), deviceName: String, deviceModel: String, osVersion: String, appVersion: String) {
        let bare = APIClientFactory.make(baseURL: baseURL)
        let tokens = TokenStore(keychain: keychain, bare: bare)
        self.tokens = tokens
        self.bare = bare
        self.client = APIClientFactory.make(baseURL: baseURL, tokens: tokens)
        self.device = Components.Schemas.DeviceInfo(
            installationId: InstallationID.current(keychain: keychain),
            name: deviceName,
            model: deviceModel,
            osVersion: osVersion,
            appVersion: appVersion
        )
        Task { [weak self] in
            await tokens.whenEnded { [weak self] in
                await self?.sessionEnded(notice: "Your session has ended. Sign in again.")
            }
        }
    }

    // MARK: Launch and lock

    /// On launch: a stored refresh token (behind biometrics) restores the session.
    public func restore() async {
        guard await tokens.loadStoredRefreshToken(reason: "Unlock Aestara") else {
            phase = .signedOut(notice: nil)
            return
        }
        if await tokens.refreshAccessToken() != nil {
            await loadSession()
        } else {
            phase = .signedOut(notice: nil)
        }
    }

    public func didEnterBackground() {
        backgroundedAt = Date()
    }

    public func willEnterForeground() {
        if phase == .signedIn, let since = backgroundedAt, Date().timeIntervalSince(since) >= Self.relockInterval {
            phase = .locked
        }
        backgroundedAt = nil
    }

    /// Unlocks after the background interval; failure signs out (no passcode fallback).
    public func unlock() async {
        if await BiometricGate.verify(reason: "Unlock Aestara") {
            phase = .signedIn
        } else {
            await signOut(notice: "Sign in again to continue.")
        }
    }

    // MARK: Sign-in

    public func signIn(email: String, password: String) async throws(APIError) {
        let device = self.device
        let bare = self.bare
        do throws(APIError) {
            let result = try await callAPI {
                try await bare.login(body: .json(.init(
                    email: email,
                    password: password,
                    clientApp: .iosProvider,
                    device: device
                ))).ok.body.json.data
            }
            try await finishSignIn(result)
        } catch {
            if let challenge = error.challenge {
                phase = .secondFactor(challenge)
                return
            }
            throw error
        }
    }

    public func verify(code: String) async throws(APIError) {
        guard case let .secondFactor(challenge) = phase else { return }
        let device = self.device
        let bare = self.bare
        do throws(APIError) {
            let result = try await callAPI {
                try await bare.verifyMfa(body: .json(.init(
                    challengeToken: challenge.challengeToken,
                    totpCode: code,
                    device: device
                ))).ok.body.json.data
            }
            try await finishSignIn(result)
        } catch {
            if let next = error.challenge { phase = .secondFactor(next) }
            throw error
        }
    }

    /// Starts TOTP enrollment with the sign-in challenge, when MFA is required but none is set up.
    public func startEnrollment() async throws(APIError) -> TOTPEnrollment {
        guard case let .secondFactor(challenge) = phase else { throw APIError.unexpected }
        let bare = self.bare
        let enrollment = try await callAPI {
            try await bare.createMfaEnrollment(
                headers: .init(idempotencyKey: newIdempotencyKey()),
                body: .json(.init(_type: .totp, challengeToken: challenge.challengeToken))
            ).created.body.json.data
        }
        guard let totp = enrollment.totp else { throw APIError.unexpected }
        return TOTPEnrollment(id: enrollment.id, secret: totp.secret, otpauthURI: totp.otpauthUri)
    }

    public func confirmEnrollment(id: String, code: String) async throws(APIError) {
        guard case let .secondFactor(challenge) = phase else { return }
        let bare = self.bare
        _ = try await callAPI {
            try await bare.confirmMfaEnrollment(
                path: .init(id: id),
                body: .json(.init(totpCode: code, challengeToken: challenge.challengeToken))
            ).noContent
        }
        phase = .secondFactor(MFAChallenge(challengeToken: challenge.challengeToken, enrollmentRequired: false, factors: ["TOTP"]))
    }

    public func chooseOrganization(_ organizationId: String) async throws(APIError) {
        let client = self.client
        let result = try await callAPI {
            try await client.switchOrganization(body: .json(.init(organizationId: organizationId))).ok.body.json.data
        }
        await tokens.store(access: result.accessToken, refresh: nil)
        session = SessionSummary(result.session)
        phase = .signedIn
    }

    public func signOut(notice: String? = nil) async {
        let client = self.client
        _ = try? await callAPI { try await client.logout().noContent }
        await tokens.clear()
        session = nil
        phase = .signedOut(notice: notice)
    }

    // MARK: Private

    private func finishSignIn(_ tokens: Components.Schemas.AuthTokens) async throws(APIError) {
        await self.tokens.store(access: tokens.accessToken, refresh: tokens.refreshToken)
        let summary = SessionSummary(tokens.session)
        session = summary
        phase = summary.organizationId == nil ? .chooseOrganization : .signedIn
    }

    private func loadSession() async {
        let client = self.client
        do throws(APIError) {
            let info = try await callAPI { try await client.getSession().ok.body.json.data }
            let summary = SessionSummary(info)
            session = summary
            phase = summary.organizationId == nil ? .chooseOrganization : .signedIn
        } catch {
            phase = .signedOut(notice: nil)
        }
    }

    private func sessionEnded(notice: String) {
        session = nil
        phase = .signedOut(notice: notice)
    }
}

/// An authenticator-app setup started during sign-in.
public struct TOTPEnrollment: Sendable, Equatable, Identifiable {
    public let id: String
    public let secret: String
    public let otpauthURI: String
}
