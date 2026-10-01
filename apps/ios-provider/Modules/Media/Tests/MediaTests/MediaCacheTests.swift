// The derivative cache's policy (ADR-0023 K2-17) and the upload checksum.
import CoreSecurity
import Foundation
import Media
import Testing

private func cache(_ policy: CachePolicy = .standard) -> (MediaCache, EncryptedStore) {
    let base = FileManager.default.temporaryDirectory.appending(path: "media-\(UUID().uuidString)")
    let store = EncryptedStore(
        scope: StoreScope(userId: UUID().uuidString, organizationId: UUID().uuidString),
        keys: InMemoryStoreKeys(),
        baseDirectory: base
    )
    return (MediaCache(store: store, policy: policy), store)
}

@Test func keepsAViewedDerivativeEncrypted() async throws {
    let (c, store) = cache()
    await c.put(Data("thumb".utf8), photoId: "p1", patientId: "a", variant: .thumbnail)
    #expect(await c.data(photoId: "p1", variant: .thumbnail) == Data("thumb".utf8))
    #expect(await c.data(photoId: "p1", variant: .displayPreview) == nil)
    #expect(store.names(withPrefix: "media.") == ["media.p1.THUMBNAIL"])
}

@Test func forgetsDerivativesOlderThanThePolicy() async {
    let (c, _) = cache(CachePolicy(maxPatients: 25, maxAgeDays: 7))
    let now = Date()
    await c.put(Data("old".utf8), photoId: "old", patientId: "a", variant: .thumbnail, now: now.addingTimeInterval(-8 * 86_400))
    await c.put(Data("new".utf8), photoId: "new", patientId: "a", variant: .thumbnail, now: now)
    #expect(await c.data(photoId: "old", variant: .thumbnail, now: now) == nil)
    #expect(await c.data(photoId: "new", variant: .thumbnail, now: now) != nil)
}

@Test func keepsOnlyTheMostRecentPatients() async {
    let (c, store) = cache(CachePolicy(maxPatients: 2, maxAgeDays: 7))
    let now = Date()
    for (i, patient) in ["a", "b", "c"].enumerated() {
        await c.put(Data(patient.utf8), photoId: "photo-\(patient)", patientId: patient, variant: .thumbnail,
                    now: now.addingTimeInterval(TimeInterval(i)))
    }
    #expect(await c.patients() == ["c", "b"])
    #expect(await c.data(photoId: "photo-a", variant: .thumbnail, now: now.addingTimeInterval(3)) == nil)
    #expect(!store.names().contains("media.photo-a.THUMBNAIL"))
}

@Test func appliesAStricterPolicyAtOnce() async {
    let (c, _) = cache()
    let now = Date()
    await c.put(Data("x".utf8), photoId: "x", patientId: "a", variant: .thumbnail, now: now.addingTimeInterval(-3 * 86_400))
    await c.apply(CachePolicy(maxPatients: 25, maxAgeDays: 2), now: now)
    #expect(await c.data(photoId: "x", variant: .thumbnail, now: now) == nil)
}

@Test func hashesLikeTheUploadIntentExpects() {
    #expect(sha256Hex(Data("abc".utf8)) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
}

@Test func removesEveryCachedDerivativeAtTheEndOfTheSession() async {
    let (c, store) = cache()
    await c.put(Data("a".utf8), photoId: "a", patientId: "p", variant: .thumbnail)
    await c.put(Data("b".utf8), photoId: "b", patientId: "p", variant: .displayPreview)
    try? store.write(Data("queued".utf8), as: "capture.q.jpg")
    await c.removeAll()
    #expect(await c.data(photoId: "a", variant: .thumbnail) == nil)
    #expect(await c.patients().isEmpty)
    #expect(store.names() == ["capture.q.jpg"])
}
