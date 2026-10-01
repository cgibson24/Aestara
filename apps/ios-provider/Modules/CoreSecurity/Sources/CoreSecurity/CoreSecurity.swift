// CoreSecurity
//
// Keychain storage and the biometric gate (spec §4.2; docs/IOS_ARCHITECTURE.md
// §7; ADR-0018 K-22). The refresh token is readable only on this device, only
// with a passcode set, and only after Face ID or Touch ID with the currently
// enrolled biometrics: there is no passcode fallback. The encrypted local
// store arrives with Layer 2 (M2.9).
// Bible §21.2, §23.3 · tier: foundation · Layer 1.
import Foundation
import LocalAuthentication
import Security

public enum KeychainError: Error, Sendable, Equatable {
    case notFound
    case userCancelled
    case biometryUnavailable
    case unexpected(OSStatus)
}

/// Generic-password items of the provider app.
public struct Keychain: Sendable {
    public let service: String

    public init(service: String = "com.aestara.provider") {
        self.service = service
    }

    /// Stores a secret that needs Face ID or Touch ID with the current biometric set to read.
    public func setBiometryProtected(_ value: Data, account: String) throws(KeychainError) {
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            .biometryCurrentSet,
            &error
        ) else { throw .biometryUnavailable }
        try delete(account: account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessControl as String: access,
            kSecValueData as String: value,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw status == errSecAuthFailed || status == errSecNotAvailable ? .biometryUnavailable : .unexpected(status)
        }
    }

    /// Stores a non-secret device value, readable after the first unlock, never synced.
    public func set(_ value: Data, account: String) throws(KeychainError) {
        try delete(account: account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: value,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw .unexpected(status) }
    }

    /// Reads an item; a biometry-protected one shows the system prompt with `reason`.
    public func get(account: String, reason: String? = nil) throws(KeychainError) -> Data {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if let reason {
            let context = LAContext()
            context.localizedReason = reason
            query[kSecUseAuthenticationContext as String] = context
        }
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data else { throw .unexpected(status) }
            return data
        case errSecItemNotFound: throw .notFound
        case errSecUserCanceled: throw .userCancelled
        case errSecAuthFailed, errSecInteractionNotAllowed: throw .biometryUnavailable
        default: throw .unexpected(status)
        }
    }

    public func delete(account: String) throws(KeychainError) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw .unexpected(status) }
    }
}

/// The per-install identifier the server registers as a device; only its hash is stored server-side.
public enum InstallationID {
    private static let account = "installation-id"

    public static func current(keychain: Keychain = Keychain()) -> String {
        if let data = try? keychain.get(account: account), let value = String(data: data, encoding: .utf8) {
            return value
        }
        let value = UUID().uuidString.lowercased()
        try? keychain.set(Data(value.utf8), account: account)
        return value
    }
}

/// Face ID or Touch ID, never the device passcode (ADR-0018 K-22).
public enum BiometricGate {
    public static var isAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    /// True when the person passed the biometric check.
    public static func verify(reason: String) async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = ""
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return false }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)) ?? false
    }
}
