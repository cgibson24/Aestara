// Consultations on the device (spec §5.4.1, §8; ADR-0026 K3-01, K3-06): the
// actions each state offers, and the offline store: final consultations are
// never kept, queued drafts show over the copy, edits coalesce while keeping
// their base version, and everything goes at sign-out.
@testable import ConsultationDomain
import CoreSecurity
import Foundation
import Testing

private func store() -> ConsultationStore {
    ConsultationStore(store: EncryptedStore(
        scope: StoreScope(userId: UUID().uuidString, organizationId: UUID().uuidString),
        keys: InMemoryStoreKeys(),
        baseDirectory: FileManager.default.temporaryDirectory.appending(path: "consultations-\(UUID().uuidString)")
    ))
}

/// Whole seconds: the store keeps dates as ISO 8601 without fractions.
private let day = Date(timeIntervalSince1970: 1_790_000_000)

private func consultation(_ id: String, _ status: ConsultationStatus) -> Consultation {
    Consultation(id: id, patientId: "p", practiceId: "pr", locationId: nil, primaryProviderUserId: nil, status: status,
                 reason: "Brow", concernIds: [], startedAt: nil, readyForReviewAt: nil, completedAt: nil, cancelledAt: nil,
                 cancellationReason: nil, unmet: [], createdAt: day, updatedAt: day, version: 1)
}

private func note(_ id: String, consultationId: String, body: String, version: Int = 1) -> ConsultationNote {
    ConsultationNote(id: id, consultationId: consultationId, authorUserId: "u", status: .draft, body: body, correctsNoteId: nil,
                     finalizedAt: nil, createdAt: day, updatedAt: day, version: version)
}

@Test func offersTheTransitionsOfEachState() {
    #expect(ConsultationAction.available(for: .draft) == [.start, .cancel])
    #expect(ConsultationAction.available(for: .inProgress) == [.requestInformation, .submitForReview, .cancel])
    #expect(ConsultationAction.available(for: .readyForReview) == [.returnToProgress, .cancel, .complete])
    #expect(ConsultationAction.available(for: .completed) == [.archive])
    #expect(ConsultationAction.available(for: .archived).isEmpty)
    #expect(ConsultationAction.complete.permission == "consultation.complete")
}

@Test func takesPhotosOnlyWhileUnderWay() {
    #expect(ConsultationStatus.allCases.filter(\.capturesPhotos) == [.inProgress, .awaitingInformation])
}

@Test func keepsOnlyOpenConsultationsOnTheDevice() async {
    let s = store()
    let open = consultation("c1", .inProgress)
    let done = consultation("c2", .completed)
    await s.save(ConsultationSnapshot(patientId: "p", consultations: [open, done],
                                      notes: ["c1": [note("n1", consultationId: "c1", body: "Seen")], "c2": []],
                                      concerns: [], history: [], savedAt: Date()))
    let saved = await s.snapshot(patientId: "p")
    #expect(saved?.consultations == [open])
    #expect(saved?.notes.keys.sorted() == ["c1"])
}

@Test func showsQueuedDraftsOverTheCopy() async {
    let s = store()
    await s.save(ConsultationSnapshot(patientId: "p", consultations: [consultation("c1", .inProgress)],
                                      notes: ["c1": [note("n1", consultationId: "c1", body: "Old")]],
                                      concerns: [], history: [], savedAt: Date()))
    await s.queueEdit(patientId: "p", consultationId: "c1", noteId: "n1", body: "New", baseVersion: 1)
    await s.queueCreate(patientId: "p", consultationId: "c1", noteId: "n2", body: "Offline", correctsNoteId: nil)
    let notes = await s.snapshot(patientId: "p")?.notes["c1"] ?? []
    #expect(notes.map(\.body) == ["New", "Offline"])
    #expect(notes.last?.version == 0)
}

@Test func coalescesEditsAndKeepsTheirBaseVersion() async {
    let s = store()
    await s.queueEdit(patientId: "p", consultationId: "c1", noteId: "n1", body: "One", baseVersion: 2)
    await s.queueEdit(patientId: "p", consultationId: "c1", noteId: "n1", body: "Two", baseVersion: 3)
    await s.queueCreate(patientId: "p", consultationId: "c1", noteId: "n2", body: "A", correctsNoteId: nil)
    await s.queueEdit(patientId: "p", consultationId: "c1", noteId: "n2", body: "B", baseVersion: 0)
    let queue = await s.queue()
    #expect(queue.count == 2)
    #expect(queue[0].body == "Two")
    #expect(queue[0].baseVersion == 2)
    #expect(queue[1].kind == .create)
    #expect(queue[1].body == "B")
}

@Test func forgetsEverythingAtSignOut() async {
    let s = store()
    await s.save(ConsultationSnapshot(patientId: "p", consultations: [consultation("c1", .draft)], notes: [:],
                                      concerns: [], history: [], savedAt: Date()))
    await s.queueCreate(patientId: "p", consultationId: "c1", noteId: "n1", body: "A", correctsNoteId: nil)
    await s.removeAll()
    #expect(await s.snapshot(patientId: "p") == nil)
    #expect(await s.queue().isEmpty)
}

@Test func forgetsCopiesBeyondThePolicy() async {
    let s = store()
    let now = Date()
    for (i, id) in ["a", "b", "c"].enumerated() {
        await s.save(ConsultationSnapshot(patientId: id, consultations: [], notes: [:], concerns: [], history: [],
                                          savedAt: now), now: now.addingTimeInterval(TimeInterval(i)))
    }
    await s.apply(maxPatients: 2, maxAgeDays: 7, now: now.addingTimeInterval(3))
    #expect(await s.snapshot(patientId: "a", now: now.addingTimeInterval(3)) == nil)
    #expect(await s.snapshot(patientId: "c", now: now.addingTimeInterval(3)) != nil)
}
