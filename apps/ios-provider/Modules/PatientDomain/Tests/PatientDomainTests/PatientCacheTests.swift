// The offline patient summaries (ADR-0023 K2-17): within the cache policy,
// sealed per user and organization, and gone with the cache.
import CoreSecurity
import Foundation
@testable import PatientDomain
import Testing

private func cache() -> (PatientCache, EncryptedStore) {
    let store = EncryptedStore(
        scope: StoreScope(userId: UUID().uuidString, organizationId: UUID().uuidString),
        keys: InMemoryStoreKeys(),
        baseDirectory: FileManager.default.temporaryDirectory.appending(path: "patients-\(UUID().uuidString)")
    )
    return (PatientCache(store: store), store)
}

private func profile(_ id: String) -> PatientProfile {
    PatientProfile(
        patient: Patient(id: id, firstName: "Ana", middleName: nil, lastName: "Quill", preferredName: nil, dateOfBirth: "1980-01-01",
                         email: nil, phone: nil, mrn: nil, status: "ACTIVE", version: 1),
        readableTabs: [.overview, .photos]
    )
}

@Test func keepsAnOpenedProfileForOfflineUse() async {
    let (c, store) = cache()
    await c.save(profile("a"))
    #expect(await c.profile(id: "a") == profile("a"))
    #expect(await c.profile(id: "b") == nil)
    #expect(store.names(withPrefix: "patient.") == ["patient.a.json"])
}

@Test func forgetsProfilesBeyondThePolicy() async {
    let (c, _) = cache()
    let now = Date()
    await c.apply(maxPatients: 2, maxAgeDays: 7, now: now)
    await c.save(profile("old"), now: now.addingTimeInterval(-8 * 86_400))
    #expect(await c.profile(id: "old", now: now) == nil)
    for (i, id) in ["a", "b", "c"].enumerated() {
        await c.save(profile(id), now: now.addingTimeInterval(TimeInterval(i)))
    }
    #expect(await c.profile(id: "a", now: now.addingTimeInterval(3)) == nil)
    #expect(await c.profile(id: "c", now: now.addingTimeInterval(3)) != nil)
}

@Test func keepsTheRecentListWithinThePolicy() async {
    let (c, store) = cache()
    let now = Date()
    await c.apply(maxPatients: 1, maxAgeDays: 7, now: now)
    let patients = ["a", "b"].map {
        PatientSummary(id: $0, firstName: "Ana", lastName: "Quill", preferredName: nil, dateOfBirth: "1980-01-01", mrn: nil, status: "ACTIVE")
    }
    await c.saveRecent(patients, now: now)
    #expect(await c.recent(now: now)?.map(\.id) == ["a"])
    #expect(await c.recent(now: now.addingTimeInterval(8 * 86_400)) == nil)
    await c.save(profile("a"), now: now)
    await c.removeAll()
    #expect(store.names().isEmpty)
}
