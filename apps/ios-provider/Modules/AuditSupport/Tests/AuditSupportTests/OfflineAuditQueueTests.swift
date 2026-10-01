// The offline view queue (spec §8 rule 8): kept encrypted, replayed oldest
// first in batches, past-window views dropped, and kept on a network error.
import AuditSupport
import CoreNetworking
import CoreSecurity
import Foundation
import Testing

private actor FakeSender: OfflineAuditSending {
    var batches: [[OfflineViewEvent]] = []
    var failWith: APIError?

    func failing(_ error: APIError?) { failWith = error }

    func send(_ events: [OfflineViewEvent]) async throws(APIError) {
        if let failWith { throw failWith }
        batches.append(events)
    }
}

private func queue() -> OfflineAuditQueue {
    let base = FileManager.default.temporaryDirectory.appending(path: "audit-\(UUID().uuidString)")
    let scope = StoreScope(userId: UUIDv7.make(), organizationId: UUIDv7.make())
    return OfflineAuditQueue(store: EncryptedStore(scope: scope, keys: InMemoryStoreKeys(), baseDirectory: base))
}

@Test func replaysOldestFirstInBatchesAndEmptiesTheQueue() async {
    let q = queue()
    let now = Date()
    for i in (0..<150).reversed() {
        await q.record(.patientViewed(UUIDv7.make(), at: now.addingTimeInterval(TimeInterval(-i * 60))))
    }
    let sender = FakeSender()
    let outcome = await q.replay(using: sender, now: now)
    #expect(outcome == ReplayOutcome(sent: 150, dropped: 0, remaining: 0))
    let batches = await sender.batches
    #expect(batches.map(\.count) == [100, 50])
    let times = batches.flatMap { $0 }.map(\.occurredAt)
    #expect(times == times.sorted())
    #expect(await q.count == 0)
}

@Test func dropsViewsOlderThanSevenDays() async {
    let q = queue()
    let now = Date()
    await q.record(.patientViewed(UUIDv7.make(), at: now.addingTimeInterval(-8 * 24 * 3600)))
    await q.record(.photoViewed(patientId: UUIDv7.make(), photoId: UUIDv7.make(), variant: .thumbnail, at: now))
    let sender = FakeSender()
    let outcome = await q.replay(using: sender, now: now)
    #expect(outcome == ReplayOutcome(sent: 1, dropped: 1, remaining: 0))
    #expect(await sender.batches.first?.first?.action == .photoViewed)
}

@Test func keepsEverythingWhenOffline() async {
    let q = queue()
    await q.record(.patientViewed(UUIDv7.make()))
    let sender = FakeSender()
    await sender.failing(.offline)
    let outcome = await q.replay(using: sender)
    #expect(outcome == ReplayOutcome(sent: 0, dropped: 0, remaining: 1))
    #expect(await q.count == 1)
    await sender.failing(nil)
    #expect(await q.replay(using: sender).sent == 1)
}

@Test func dropsABatchTheServerRefuses() async {
    let q = queue()
    await q.record(.patientViewed(UUIDv7.make()))
    let sender = FakeSender()
    await sender.failing(APIError(status: 400, code: "VALIDATION_FAILED", message: "Offline views are replayed within 7 days."))
    let outcome = await q.replay(using: sender)
    #expect(outcome == ReplayOutcome(sent: 0, dropped: 1, remaining: 0))
    #expect(await q.count == 0)
}
