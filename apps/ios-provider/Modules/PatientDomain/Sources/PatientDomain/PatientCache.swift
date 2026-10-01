// Patient summaries kept for offline use (Bible §23.1; spec §8 rule 7;
// ADR-0023 K2-17): the recent-patients list and the profiles already opened,
// sealed in the encrypted store of the signed-in user and organization, within
// the practice's cache policy (by default 25 patients and 7 days). They let a
// photographer reach a patient and capture without a connection. Search and
// patient creation stay online. The cache goes on sign-out and when the session
// ends.
// Bible §4, §23 · tier: domain · Layer 2.
import CoreSecurity
import Foundation

public actor PatientCache {
    struct Index: Codable {
        var savedAt: [String: Date] = [:]
    }

    struct Recent: Codable {
        let patients: [PatientSummary]
        let savedAt: Date
    }

    private static let index = "patient-index.json"
    private static let recentRecord = "patient-recent.json"
    private let store: EncryptedStore
    private var maxPatients = 25
    private var maxAge: TimeInterval = 7 * 24 * 60 * 60

    public init(store: EncryptedStore) {
        self.store = store
    }

    private static func record(_ patientId: String) -> String {
        "patient.\(patientId.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "-" }).json"
    }

    /// The server's policy, applied at once.
    public func apply(maxPatients: Int, maxAgeDays: Int, now: Date = Date()) {
        self.maxPatients = maxPatients
        maxAge = TimeInterval(maxAgeDays) * 24 * 60 * 60
        enforce(now: now)
    }

    public func saveRecent(_ patients: [PatientSummary], now: Date = Date()) {
        try? store.writeJSON(Recent(patients: Array(patients.prefix(maxPatients)), savedAt: now), as: Self.recentRecord)
    }

    /// The last recent-patients list, while it is within the policy.
    public func recent(now: Date = Date()) -> [PatientSummary]? {
        guard let recent = try? store.readJSON(Recent.self, from: Self.recentRecord) else { return nil }
        guard now.timeIntervalSince(recent.savedAt) <= maxAge else {
            store.remove(Self.recentRecord)
            return nil
        }
        return recent.patients
    }

    public func save(_ profile: PatientProfile, now: Date = Date()) {
        guard (try? store.writeJSON(profile, as: Self.record(profile.patient.id))) != nil else { return }
        var index = loadIndex()
        index.savedAt[profile.patient.id] = now
        saveIndex(index)
        enforce(now: now)
    }

    /// A profile opened before, while it is within the policy.
    public func profile(id: String, now: Date = Date()) -> PatientProfile? {
        enforce(now: now)
        guard loadIndex().savedAt[id] != nil else { return nil }
        return try? store.readJSON(PatientProfile.self, from: Self.record(id))
    }

    public func removeAll() {
        for id in loadIndex().savedAt.keys { store.remove(Self.record(id)) }
        store.remove(Self.index)
        store.remove(Self.recentRecord)
    }

    /// Drops profiles older than the policy allows, then all but the most recent patients.
    func enforce(now: Date) {
        let index = loadIndex()
        let fresh = index.savedAt.filter { now.timeIntervalSince($0.value) <= maxAge }
        let kept = Dictionary(uniqueKeysWithValues: fresh.sorted { $0.value > $1.value }.prefix(maxPatients).map { ($0.key, $0.value) })
        guard kept.count != index.savedAt.count else { return }
        for id in index.savedAt.keys where kept[id] == nil { store.remove(Self.record(id)) }
        saveIndex(Index(savedAt: kept))
    }

    private func loadIndex() -> Index {
        (try? store.readJSON(Index.self, from: Self.index)) ?? Index()
    }

    private func saveIndex(_ index: Index) {
        try? store.writeJSON(index, as: Self.index)
    }
}
