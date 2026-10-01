// The encrypted local store (spec §7.1, §8 rule 6; ADR-0023 K2-17): each
// record is a file sealed with AES-GCM under a key that belongs to one user in
// one organization, written with Data Protection Complete. The key lives in
// the Keychain, readable only while the device is unlocked and never synced
// or backed up. A record's name is bound into its seal, so records cannot be
// swapped between names, and another user's or organization's store cannot
// open them. Destroying a store deletes its key and every file.
// Bible §21.2, §23.3 · tier: foundation · Layer 2.
import CryptoKit
import Foundation

/// Whose data a store holds: one user in one organization (ADR-0023 K2-17).
public struct StoreScope: Sendable, Hashable {
    public let userId: String
    public let organizationId: String

    public init(userId: String, organizationId: String) {
        self.userId = userId
        self.organizationId = organizationId
    }

    /// A file-system name from the two identifiers (server UUIDs; anything else is dropped).
    var directoryName: String {
        let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789-")
        let clean = { (value: String) in String(value.lowercased().filter { allowed.contains($0) }) }
        return "\(clean(userId)).\(clean(organizationId))"
    }
}

public enum EncryptedStoreError: Error, Sendable, Equatable {
    /// The key cannot be read: the device is locked, or the store was destroyed.
    case keyUnavailable
    /// A record failed authentication: it was altered or belongs elsewhere.
    case corrupted
    /// The file system refused a read or write.
    case storage
    /// A record name outside the allowed characters.
    case invalidName
}

/// Supplies and destroys the key of each scope.
public protocol StoreKeyProviding: Sendable {
    func key(for scope: StoreScope) throws(EncryptedStoreError) -> SymmetricKey
    func destroyKey(for scope: StoreScope)
}

/// Keys in the Keychain: 256-bit, created on first use, `whenUnlocked`, this device only.
public struct KeychainStoreKeys: StoreKeyProviding {
    let keychain: Keychain

    public init(keychain: Keychain = Keychain()) {
        self.keychain = keychain
    }

    private func account(_ scope: StoreScope) -> String { "store-key.\(scope.directoryName)" }

    public func key(for scope: StoreScope) throws(EncryptedStoreError) -> SymmetricKey {
        do {
            let stored = try keychain.get(account: account(scope))
            return SymmetricKey(data: stored)
        } catch KeychainError.notFound {
            let key = SymmetricKey(size: .bits256)
            let data = key.withUnsafeBytes { Data($0) }
            do {
                try keychain.set(data, account: account(scope), accessibility: .whenUnlocked)
            } catch {
                throw .keyUnavailable
            }
            return key
        } catch {
            throw .keyUnavailable
        }
    }

    public func destroyKey(for scope: StoreScope) {
        try? keychain.delete(account: account(scope))
    }
}

/// Keys held in memory only: for tests, which run without a Keychain entitlement.
public final class InMemoryStoreKeys: StoreKeyProviding, @unchecked Sendable {
    private let lock = NSLock()
    private var keys: [StoreScope: SymmetricKey] = [:]

    public init() {}

    public func key(for scope: StoreScope) throws(EncryptedStoreError) -> SymmetricKey {
        lock.lock()
        defer { lock.unlock() }
        if let key = keys[scope] { return key }
        let key = SymmetricKey(size: .bits256)
        keys[scope] = key
        return key
    }

    public func destroyKey(for scope: StoreScope) {
        lock.lock()
        defer { lock.unlock() }
        keys[scope] = nil
    }
}

/// Sealed records of one scope, under Application Support (excluded from backups).
public struct EncryptedStore: Sendable {
    public let scope: StoreScope
    private let keys: any StoreKeyProviding
    private let directory: URL

    /// - Parameter baseDirectory: the parent of every store; tests pass a temporary directory.
    public init(scope: StoreScope, keys: any StoreKeyProviding = KeychainStoreKeys(), baseDirectory: URL? = nil) {
        self.scope = scope
        self.keys = keys
        let base = baseDirectory ?? URL.applicationSupportDirectory.appending(path: "AestaraSecure", directoryHint: .isDirectory)
        self.directory = base.appending(path: scope.directoryName, directoryHint: .isDirectory)
    }

    /// Record names: letters, digits, dots, dashes and underscores, as file names.
    static func isValid(_ name: String) -> Bool {
        let allowed = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
        return !name.isEmpty && name.count <= 200 && !name.hasPrefix(".") && name.allSatisfy { allowed.contains($0) }
    }

    private func url(_ name: String) throws(EncryptedStoreError) -> URL {
        guard Self.isValid(name) else { throw .invalidName }
        return directory.appending(path: name, directoryHint: .notDirectory)
    }

    /// Seals and writes a record, replacing any record of that name.
    public func write(_ data: Data, as name: String) throws(EncryptedStoreError) {
        let target = try url(name)
        let key = try keys.key(for: scope)
        let sealed: Data
        do {
            guard let combined = try AES.GCM.seal(data, using: key, authenticating: Data(name.utf8)).combined else {
                throw EncryptedStoreError.storage
            }
            sealed = combined
        } catch {
            throw .storage
        }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var excluded = directory
            try? excluded.setResourceValues(values)
            try sealed.write(to: target, options: [.atomic, .completeFileProtection])
        } catch {
            throw .storage
        }
    }

    /// Opens a record; nil when there is none.
    public func read(_ name: String) throws(EncryptedStoreError) -> Data? {
        let source = try url(name)
        guard FileManager.default.fileExists(atPath: source.path(percentEncoded: false)) else { return nil }
        let sealed: Data
        do {
            sealed = try Data(contentsOf: source)
        } catch {
            throw .storage
        }
        let key = try keys.key(for: scope)
        do {
            let box = try AES.GCM.SealedBox(combined: sealed)
            return try AES.GCM.open(box, using: key, authenticating: Data(name.utf8))
        } catch {
            throw .corrupted
        }
    }

    public func remove(_ name: String) {
        guard let target = try? url(name) else { return }
        try? FileManager.default.removeItem(at: target)
    }

    /// The names of the records that start with `prefix`, sorted.
    public func names(withPrefix prefix: String = "") -> [String] {
        let all = (try? FileManager.default.contentsOfDirectory(atPath: directory.path(percentEncoded: false))) ?? []
        return all.filter { $0.hasPrefix(prefix) && Self.isValid($0) }.sorted()
    }

    /// Deletes every record and the key: nothing of this scope can be read afterwards.
    public func destroy() {
        try? FileManager.default.removeItem(at: directory)
        keys.destroyKey(for: scope)
    }

    // MARK: JSON records

    public func writeJSON<T: Encodable>(_ value: T, as name: String) throws(EncryptedStoreError) {
        let data: Data
        do {
            data = try Self.encoder.encode(value)
        } catch {
            throw .storage
        }
        try write(data, as: name)
    }

    public func readJSON<T: Decodable>(_ type: T.Type, from name: String) throws(EncryptedStoreError) -> T? {
        guard let data = try read(name) else { return nil }
        do {
            return try Self.decoder.decode(type, from: data)
        } catch {
            throw .corrupted
        }
    }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
