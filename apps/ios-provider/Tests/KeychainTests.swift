// CoreSecurity's Keychain, hosted in the provider app: a bare package test
// bundle has no keychain entitlement on the simulator (ADR-0022).
import CoreSecurity
import CryptoKit
import Foundation
import Testing

@Test func storesReadsAndDeletesADeviceValue() throws {
    let keychain = Keychain(service: "com.aestara.tests.\(UUID().uuidString)")
    try keychain.set(Data("value".utf8), account: "a")
    #expect(try keychain.get(account: "a") == Data("value".utf8))
    try keychain.delete(account: "a")
    #expect(throws: KeychainError.notFound) { _ = try keychain.get(account: "a") }
}

@Test func keepsOneInstallationID() {
    let keychain = Keychain(service: "com.aestara.tests.\(UUID().uuidString)")
    let first = InstallationID.current(keychain: keychain)
    #expect(InstallationID.current(keychain: keychain) == first)
    #expect(UUID(uuidString: first) != nil)
}

@Test func makesOneStoreKeyWhenFirstUsedFromManyTasksAtOnce() async throws {
    let keys = KeychainStoreKeys(keychain: Keychain(service: "com.aestara.tests.\(UUID().uuidString)"))
    let scope = StoreScope(userId: UUID().uuidString, organizationId: UUID().uuidString)
    let made = await withTaskGroup(of: Data?.self) { group in
        for _ in 0..<8 {
            group.addTask { (try? keys.key(for: scope)).map { key in key.withUnsafeBytes { Data($0) } } }
        }
        var all: [Data?] = []
        for await key in group { all.append(key) }
        return all
    }
    #expect(made.count == 8)
    #expect(made.allSatisfy { $0 != nil })
    #expect(Set(made.compactMap { $0 }).count == 1)
    // Records written by any of them stay readable.
    let store = EncryptedStore(scope: scope, keys: keys, baseDirectory: FileManager.default.temporaryDirectory
        .appending(path: UUID().uuidString, directoryHint: .isDirectory))
    try store.write(Data("record".utf8), as: "a")
    #expect(try store.read("a") == Data("record".utf8))
    store.destroy()
}

