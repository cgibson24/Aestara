// Offline view audit (spec §8 rule 8; ADR-0023 K2-17; ADR-0024): a patient or
// photo viewed from the encrypted cache while offline is recorded on the
// device with a UUIDv7 and its time, and replayed first on reconnect through
// `POST /audit/offline-events`. The server records each event once, at its
// original time. Events are kept in the encrypted store of the user and
// organization that viewed them, and hold identifiers only.
// Bible §22, §23.3 · tier: foundation · Layer 2.
import CoreNetworking
import CoreSecurity
import Foundation

/// One view made offline.
public struct OfflineViewEvent: Codable, Sendable, Equatable, Identifiable {
    public enum Action: String, Codable, Sendable {
        case patientViewed = "PATIENT_VIEWED"
        case photoViewed = "PHOTO_VIEWED"
    }

    public enum Variant: String, Codable, Sendable {
        case thumbnail = "THUMBNAIL"
        case displayPreview = "DISPLAY_PREVIEW"
    }

    public let id: String
    public let action: Action
    public let patientId: String
    public let photoId: String?
    public let variant: Variant?
    public let occurredAt: Date

    public static func patientViewed(_ patientId: String, at date: Date = Date()) -> Self {
        Self(id: UUIDv7.make(at: date), action: .patientViewed, patientId: patientId, photoId: nil, variant: nil, occurredAt: date)
    }

    public static func photoViewed(patientId: String, photoId: String, variant: Variant, at date: Date = Date()) -> Self {
        Self(id: UUIDv7.make(at: date), action: .photoViewed, patientId: patientId, photoId: photoId, variant: variant, occurredAt: date)
    }
}

/// Sends a batch of offline views to the server.
public protocol OfflineAuditSending: Sendable {
    func send(_ events: [OfflineViewEvent]) async throws(APIError)
}

/// The generated client's `recordOfflineAuditEvents`.
public struct ClientOfflineAuditSender: OfflineAuditSending {
    let client: Client

    public init(client: Client) {
        self.client = client
    }

    public func send(_ events: [OfflineViewEvent]) async throws(APIError) {
        let body = Components.Schemas.OfflineAuditBatch(events: events.map(Self.dto))
        let client = self.client
        _ = try await callAPI {
            try await client.recordOfflineAuditEvents(
                headers: .init(idempotencyKey: newIdempotencyKey()),
                body: .json(body)
            ).created
        }
    }

    static func dto(_ event: OfflineViewEvent) -> Components.Schemas.OfflineAuditEvent {
        Components.Schemas.OfflineAuditEvent(
            id: event.id,
            action: wire(event.action),
            patientId: event.patientId,
            photoId: event.photoId,
            variant: event.variant.map { wire($0) },
            occurredAt: event.occurredAt
        )
    }
}

/// What a replay did.
public struct ReplayOutcome: Sendable, Equatable {
    /// Events the server now holds.
    public var sent: Int
    /// Events past the 7-day window, or refused by the server: they cannot be recorded.
    public var dropped: Int
    /// Events still queued (offline, or the server was unavailable).
    public var remaining: Int

    public init(sent: Int = 0, dropped: Int = 0, remaining: Int = 0) {
        self.sent = sent
        self.dropped = dropped
        self.remaining = remaining
    }
}

/// The queue of offline views of one user in one organization.
public actor OfflineAuditQueue {
    /// The server records offline views up to 7 days old (spec §8 rule 8).
    public static let maxAge: TimeInterval = 7 * 24 * 60 * 60
    static let batchSize = 100
    /// The record name; it outlives a sign-out so no offline view goes unaudited.
    public static let record = "offline-audit.json"
    private let store: EncryptedStore

    public init(store: EncryptedStore) {
        self.store = store
    }

    private func load() -> [OfflineViewEvent] {
        (try? store.readJSON([OfflineViewEvent].self, from: Self.record)) ?? []
    }

    private func save(_ events: [OfflineViewEvent]) {
        if events.isEmpty {
            store.remove(Self.record)
        } else {
            try? store.writeJSON(events, as: Self.record)
        }
    }

    public func record(_ event: OfflineViewEvent) {
        var events = load()
        events.append(event)
        save(events)
    }

    public var count: Int { load().count }

    /// Sends the queued views, oldest first, in batches of 100. A batch the server
    /// refuses as invalid or forbidden can never be recorded and is dropped; on a
    /// network or server error the rest stays queued for the next reconnect.
    public func replay(using sender: some OfflineAuditSending, now: Date = Date()) async -> ReplayOutcome {
        var outcome = ReplayOutcome()
        let all = load().sorted { $0.occurredAt < $1.occurredAt }
        let fresh = all.filter { now.timeIntervalSince($0.occurredAt) < Self.maxAge }
        outcome.dropped = all.count - fresh.count
        save(fresh)
        var index = 0
        while index < fresh.count {
            let batch = Array(fresh[index..<min(index + Self.batchSize, fresh.count)])
            do throws(APIError) {
                try await sender.send(batch)
                outcome.sent += batch.count
            } catch {
                if error.status == 0 || error.status >= 500 || error.status == 401 || error.status == 429 {
                    outcome.remaining = fresh.count - index
                    return outcome
                }
                outcome.dropped += batch.count
            }
            // Views recorded while this batch was in flight stay queued.
            let done = Set(batch.map(\.id))
            save(load().filter { !done.contains($0.id) })
            index += batch.count
        }
        return outcome
    }
}
