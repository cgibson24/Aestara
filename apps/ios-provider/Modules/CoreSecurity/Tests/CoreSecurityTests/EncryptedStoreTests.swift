// The encrypted local store (ADR-0023 K2-17), with in-memory keys: records
// round-trip, are unreadable to another scope, refuse tampering and renaming,
// and are gone once the store is destroyed.
import CoreSecurity
import CryptoKit
import Foundation
import Testing

private func temporaryBase() -> URL {
    FileManager.default.temporaryDirectory.appending(path: "store-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
}

private let alice = StoreScope(userId: "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f", organizationId: "0192f7c4-5b1e-7c3a-9d2f-000000000001")
private let bob = StoreScope(userId: "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e60", organizationId: "0192f7c4-5b1e-7c3a-9d2f-000000000001")

@Test func roundTripsRecordsAndListsThemByPrefix() throws {
    let store = EncryptedStore(scope: alice, keys: InMemoryStoreKeys(), baseDirectory: temporaryBase())
    try store.write(Data("first".utf8), as: "capture.a")
    try store.write(Data("second".utf8), as: "capture.b")
    try store.write(Data("other".utf8), as: "queue.json")
    #expect(try store.read("capture.a") == Data("first".utf8))
    #expect(store.names(withPrefix: "capture.") == ["capture.a", "capture.b"])
    #expect(try store.read("missing") == nil)
    store.remove("capture.a")
    #expect(store.names(withPrefix: "capture.") == ["capture.b"])
}

@Test func writesNothingInTheClear() throws {
    let base = temporaryBase()
    let store = EncryptedStore(scope: alice, keys: InMemoryStoreKeys(), baseDirectory: base)
    let secret = Data("Synthetic Patient 1970-01-01".utf8)
    try store.write(secret, as: "record")
    let files = try #require(FileManager.default.enumerator(at: base, includingPropertiesForKeys: nil)?.allObjects as? [URL])
    let bytes = try files.filter { !$0.hasDirectoryPath }.map { try Data(contentsOf: $0) }
    #expect(bytes.count == 1)
    #expect(bytes.allSatisfy { $0.range(of: secret) == nil })
}

@Test func anotherScopeCannotOpenTheRecords() throws {
    let base = temporaryBase()
    let keys = InMemoryStoreKeys()
    let mine = EncryptedStore(scope: alice, keys: keys, baseDirectory: base)
    try mine.write(Data("queue".utf8), as: "queue.json")
    let theirs = EncryptedStore(scope: bob, keys: keys, baseDirectory: base)
    #expect(try theirs.read("queue.json") == nil)
    #expect(theirs.names().isEmpty)
}

@Test func refusesATamperedOrRenamedRecord() throws {
    let base = temporaryBase()
    let store = EncryptedStore(scope: alice, keys: InMemoryStoreKeys(), baseDirectory: base)
    try store.write(Data("original".utf8), as: "a")
    try store.write(Data("other".utf8), as: "b")
    let directory = try #require(FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: nil).first)
    // Swapping two files: each seal names its record, so neither opens under the other name.
    let a = directory.appending(path: "a")
    let b = directory.appending(path: "b")
    let aBytes = try Data(contentsOf: a)
    try Data(contentsOf: b).write(to: a)
    #expect(throws: EncryptedStoreError.corrupted) { _ = try store.read("a") }
    // Flipping one byte breaks authentication.
    var flipped = aBytes
    flipped[flipped.count - 1] ^= 0x01
    try flipped.write(to: b)
    #expect(throws: EncryptedStoreError.corrupted) { _ = try store.read("b") }
}

@Test func destroyingTheStoreRemovesTheKeyAndEveryRecord() throws {
    let base = temporaryBase()
    let keys = InMemoryStoreKeys()
    let store = EncryptedStore(scope: alice, keys: keys, baseDirectory: base)
    try store.write(Data("x".utf8), as: "a")
    let bytes = { (key: SymmetricKey) in key.withUnsafeBytes { Data($0) } }
    let before = bytes(try keys.key(for: alice))
    store.destroy()
    #expect(store.names().isEmpty)
    #expect(try store.read("a") == nil)
    // A new key: the old records could not be opened even if they were recovered.
    #expect(bytes(try keys.key(for: alice)) != before)
}

@Test func rejectsNamesThatAreNotPlainFileNames() {
    let store = EncryptedStore(scope: alice, keys: InMemoryStoreKeys(), baseDirectory: temporaryBase())
    for name in ["", "../escape", ".hidden", "a/b", "name with spaces"] {
        #expect(throws: EncryptedStoreError.invalidName) { try store.write(Data(), as: name) }
    }
}

@Test func roundTripsJSONRecords() throws {
    struct Item: Codable, Equatable { let id: String; let at: Date }
    let store = EncryptedStore(scope: alice, keys: InMemoryStoreKeys(), baseDirectory: temporaryBase())
    let item = Item(id: "x", at: Date(timeIntervalSince1970: 1_790_000_000))
    try store.writeJSON([item], as: "items.json")
    #expect(try store.readJSON([Item].self, from: "items.json") == [item])
}
