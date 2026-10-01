// CoreSecurity's Keychain, hosted in the provider app: a bare package test
// bundle has no keychain entitlement on the simulator (ADR-0022).
import CoreSecurity
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
