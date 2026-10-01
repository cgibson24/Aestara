// The encrypted cache of viewed derivatives (ADR-0023 K2-17): thumbnails and
// previews already viewed, kept for offline use within the practice's policy
// (by default 25 patients and 7 days), sealed in the store of the signed-in
// user and organization. Originals are never cached. The cache is purged with
// sign-out, device revocation and the end of the session.
// Bible §6.6, §21.2, §23 · tier: platform · Layer 2.
import CoreSecurity
import Foundation

/// How much a device may keep (the practice setting `offline.cachePolicy`).
public struct CachePolicy: Sendable, Equatable, Codable {
    public let maxPatients: Int
    public let maxAgeDays: Int

    public init(maxPatients: Int, maxAgeDays: Int) {
        self.maxPatients = maxPatients
        self.maxAgeDays = maxAgeDays
    }

    /// The default until the server's policy is known (spec §8 rule 7).
    public static let standard = CachePolicy(maxPatients: 25, maxAgeDays: 7)
}

public enum DerivativeVariant: String, Sendable, Codable, CaseIterable {
    case thumbnail = "THUMBNAIL"
    case displayPreview = "DISPLAY_PREVIEW"
}

public actor MediaCache {
    struct Entry: Codable, Equatable {
        let photoId: String
        let patientId: String
        let variant: DerivativeVariant
        let cachedAt: Date
    }

    private static let index = "media-index.json"
    private let store: EncryptedStore
    private var policy: CachePolicy

    public init(store: EncryptedStore, policy: CachePolicy = .standard) {
        self.store = store
        self.policy = policy
    }

    private static func record(_ photoId: String, _ variant: DerivativeVariant) -> String {
        "media.\(photoId).\(variant.rawValue)"
    }

    private func entries() -> [Entry] {
        (try? store.readJSON([Entry].self, from: Self.index)) ?? []
    }

    private func save(_ entries: [Entry]) {
        try? store.writeJSON(entries, as: Self.index)
    }

    /// Applies a new policy at once (the server's, after sign-in).
    public func apply(_ policy: CachePolicy, now: Date = Date()) {
        self.policy = policy
        enforce(now: now)
    }

    public func put(_ data: Data, photoId: String, patientId: String, variant: DerivativeVariant, now: Date = Date()) {
        guard (try? store.write(data, as: Self.record(photoId, variant))) != nil else { return }
        var all = entries().filter { !($0.photoId == photoId && $0.variant == variant) }
        all.append(Entry(photoId: photoId, patientId: patientId, variant: variant, cachedAt: now))
        save(all)
        enforce(now: now)
    }

    /// A cached derivative, when it is still within the policy.
    public func data(photoId: String, variant: DerivativeVariant, now: Date = Date()) -> Data? {
        enforce(now: now)
        guard entries().contains(where: { $0.photoId == photoId && $0.variant == variant }) else { return nil }
        return try? store.read(Self.record(photoId, variant))
    }

    /// The patients with cached photos, most recent first.
    public func patients() -> [String] {
        var latest: [String: Date] = [:]
        for entry in entries() { latest[entry.patientId] = max(latest[entry.patientId] ?? .distantPast, entry.cachedAt) }
        return latest.sorted { $0.value > $1.value }.map(\.key)
    }

    /// Removes every cached derivative (sign-out, session end or device revocation).
    public func removeAll() {
        for entry in entries() { store.remove(Self.record(entry.photoId, entry.variant)) }
        store.remove(Self.index)
    }

    /// Drops entries older than the policy allows, then all but the most recent patients.
    func enforce(now: Date) {
        let all = entries()
        let cutoff = now.addingTimeInterval(-TimeInterval(policy.maxAgeDays) * 24 * 60 * 60)
        var kept = all.filter { $0.cachedAt >= cutoff }
        var latest: [String: Date] = [:]
        for entry in kept { latest[entry.patientId] = max(latest[entry.patientId] ?? .distantPast, entry.cachedAt) }
        let allowed = Set(latest.sorted { $0.value > $1.value }.prefix(policy.maxPatients).map(\.key))
        kept = kept.filter { allowed.contains($0.patientId) }
        guard kept.count != all.count else { return }
        for gone in all where !kept.contains(gone) { store.remove(Self.record(gone.photoId, gone.variant)) }
        save(kept)
    }
}
