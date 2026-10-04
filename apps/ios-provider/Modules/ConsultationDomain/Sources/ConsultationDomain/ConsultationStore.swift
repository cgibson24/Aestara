// Consultation work offline (spec §8; ADR-0026 K3-06), sealed in the encrypted
// store of the signed-in user and organization:
// - a copy of each cached patient's open consultations with their notes, and
//   the patient's concerns and medical history, within the practice's cache
//   policy, to read them without a connection;
// - the queue of note drafts written or edited offline. Each operation keeps
//   its Idempotency-Key, the note's client UUIDv7 and, for an edit, the version
//   it was based on. They replay in order, after the session is checked again.
//   A version that moved on meanwhile is never overwritten silently: the draft
//   is kept and both texts are shown (spec §8 rule 4).
// Creating a consultation, transitions, finalizing, the summary and everything
// else need the connection. Everything here goes with sign-out.
// Bible §5, §23 · tier: domain · Layer 3.
import CoreNetworking
import CoreSecurity
import Foundation

/// A patient's consultation work as last seen online.
public struct ConsultationSnapshot: Sendable, Equatable, Codable {
    public let patientId: String
    public var consultations: [Consultation]
    public var notes: [String: [ConsultationNote]]
    public var concerns: [PatientConcern]
    public var history: [MedicalHistoryEntry]
    public var savedAt: Date

    public init(patientId: String, consultations: [Consultation], notes: [String: [ConsultationNote]],
                concerns: [PatientConcern], history: [MedicalHistoryEntry], savedAt: Date) {
        self.patientId = patientId
        self.consultations = consultations
        self.notes = notes
        self.concerns = concerns
        self.history = history
        self.savedAt = savedAt
    }
}

/// One queued note change (spec §8 rule 1).
public struct NoteOperation: Sendable, Equatable, Codable, Identifiable {
    public enum Kind: String, Sendable, Codable { case create, update }

    /// The Idempotency-Key of a create; for an edit, identifies the queued entry.
    public let id: String
    public let kind: Kind
    public let patientId: String
    public let consultationId: String
    public let noteId: String
    public var body: String
    public let correctsNoteId: String?
    /// The server version an edit was based on (If-Match).
    public let baseVersion: Int?
    public let queuedAt: Date
    /// Why the server refused it, kept for the author to decide (spec §8 rule 4).
    public var problem: NoteProblem?
}

public enum NoteProblem: Sendable, Equatable, Codable {
    /// The draft changed on the server meanwhile: both texts are shown.
    case conflict(serverBody: String, serverVersion: Int)
    /// The server refused the change for good (the note was finalized or the consultation closed).
    case refused(message: String)
}

/// What one replay did.
public struct NoteReplay: Sendable, Equatable {
    public let sent: Int
    public let problems: Int
    /// Stopped for want of a connection.
    public let interrupted: Bool
}

public actor ConsultationStore {
    struct Index: Codable {
        var savedAt: [String: Date] = [:]
    }

    private static let index = "consultation-index.json"
    private static let queueRecord = "note-queue.json"
    private let store: EncryptedStore
    private var maxPatients = 25
    private var maxAge: TimeInterval = 7 * 24 * 60 * 60

    public init(store: EncryptedStore) {
        self.store = store
    }

    private static func record(_ patientId: String) -> String {
        "consultations.\(patientId.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "-" }).json"
    }

    /// The server's cache policy, applied at once (spec §8 rule 7).
    public func apply(maxPatients: Int, maxAgeDays: Int, now: Date = Date()) {
        self.maxPatients = maxPatients
        maxAge = TimeInterval(maxAgeDays) * 24 * 60 * 60
        enforce(now: now)
    }

    // MARK: The offline copy

    /// Saves what was loaded online; final consultations are left out (K3-06).
    public func save(_ snapshot: ConsultationSnapshot, now: Date = Date()) {
        var open = snapshot
        open.consultations = snapshot.consultations.filter { !$0.status.isFinal }
        let kept = Set(open.consultations.map(\.id))
        open.notes = snapshot.notes.filter { kept.contains($0.key) }
        open.savedAt = now
        guard (try? store.writeJSON(open, as: Self.record(snapshot.patientId))) != nil else { return }
        var index = loadIndex()
        index.savedAt[snapshot.patientId] = now
        saveIndex(index)
        enforce(now: now)
    }

    /// The copy of a patient's work, while it is within the policy, with queued drafts applied.
    public func snapshot(patientId: String, now: Date = Date()) -> ConsultationSnapshot? {
        enforce(now: now)
        guard loadIndex().savedAt[patientId] != nil,
              var saved = try? store.readJSON(ConsultationSnapshot.self, from: Self.record(patientId)) else { return nil }
        for operation in queue() where operation.patientId == patientId {
            var notes = saved.notes[operation.consultationId] ?? []
            if let at = notes.firstIndex(where: { $0.id == operation.noteId }) {
                notes[at] = notes[at].with(body: operation.body, version: notes[at].version, updatedAt: operation.queuedAt)
            } else {
                notes.append(ConsultationNote(id: operation.noteId, consultationId: operation.consultationId,
                                              authorUserId: "", status: .draft, body: operation.body,
                                              correctsNoteId: operation.correctsNoteId, finalizedAt: nil,
                                              createdAt: operation.queuedAt, updatedAt: operation.queuedAt, version: 0))
            }
            saved.notes[operation.consultationId] = notes
        }
        return saved
    }

    // MARK: The queue

    public func queue() -> [NoteOperation] {
        (try? store.readJSON([NoteOperation].self, from: Self.queueRecord)) ?? []
    }

    private func saveQueue(_ operations: [NoteOperation]) {
        if operations.isEmpty {
            store.remove(Self.queueRecord)
        } else {
            try? store.writeJSON(operations, as: Self.queueRecord)
        }
    }

    /// A new draft written offline, with its client UUIDv7.
    public func queueCreate(patientId: String, consultationId: String, noteId: String, body: String,
                            correctsNoteId: String?, now: Date = Date()) {
        var operations = queue()
        operations.append(NoteOperation(id: newIdempotencyKey(), kind: .create, patientId: patientId,
                                        consultationId: consultationId, noteId: noteId, body: body,
                                        correctsNoteId: correctsNoteId, baseVersion: nil, queuedAt: now, problem: nil))
        saveQueue(operations)
    }

    /// An offline edit of one's own draft. A draft still waiting to be sent takes the new text;
    /// successive edits of a sent draft keep the version the first one was based on.
    public func queueEdit(patientId: String, consultationId: String, noteId: String, body: String,
                          baseVersion: Int, now: Date = Date()) {
        var operations = queue()
        if let at = operations.lastIndex(where: { $0.noteId == noteId && $0.problem == nil }) {
            operations[at].body = body
        } else {
            operations.append(NoteOperation(id: newIdempotencyKey(), kind: .update, patientId: patientId,
                                            consultationId: consultationId, noteId: noteId, body: body,
                                            correctsNoteId: nil, baseVersion: baseVersion, queuedAt: now, problem: nil))
        }
        saveQueue(operations)
    }

    /// Drops a queued draft the author chose to discard.
    public func discard(_ operationId: String) {
        saveQueue(queue().filter { $0.id != operationId })
    }

    /// Keeps the author's text over the server's: sent again on top of the server's version.
    public func keepMine(_ operationId: String, now: Date = Date()) {
        var operations = queue()
        guard let at = operations.firstIndex(where: { $0.id == operationId }),
              case let .conflict(_, serverVersion) = operations[at].problem else { return }
        let old = operations[at]
        operations[at] = NoteOperation(id: newIdempotencyKey(), kind: .update, patientId: old.patientId,
                                       consultationId: old.consultationId, noteId: old.noteId, body: old.body,
                                       correctsNoteId: nil, baseVersion: serverVersion, queuedAt: now, problem: nil)
        saveQueue(operations)
    }

    /// Sends the queue in order (spec §8 rule 2): a refused note keeps its draft and its
    /// problem; the others continue. No connection stops the run.
    public func replay(using repository: ConsultationRepository) async -> NoteReplay {
        var sent = 0
        var problems = 0
        for operation in queue() where operation.problem == nil {
            do throws(APIError) {
                switch operation.kind {
                case .create:
                    _ = try await repository.createNote(
                        patientId: operation.patientId, consultationId: operation.consultationId,
                        noteId: operation.noteId, body: operation.body, correctsNoteId: operation.correctsNoteId,
                        idempotencyKey: operation.id
                    )
                case .update:
                    _ = try await repository.updateNote(
                        patientId: operation.patientId, consultationId: operation.consultationId,
                        noteId: operation.noteId, body: operation.body, version: operation.baseVersion ?? 1
                    )
                }
                discard(operation.id)
                sent += 1
            } catch {
                if error.status == 0 { return NoteReplay(sent: sent, problems: problems, interrupted: true) }
                problems += 1
                let problem: NoteProblem
                if error.status == 412,
                   let current = try? await repository.note(patientId: operation.patientId,
                                                            consultationId: operation.consultationId,
                                                            noteId: operation.noteId),
                   current.status == .draft {
                    problem = .conflict(serverBody: current.body, serverVersion: current.version)
                } else {
                    problem = .refused(message: error.displayMessage)
                }
                mark(operation.id, problem: problem)
            }
        }
        return NoteReplay(sent: sent, problems: problems, interrupted: false)
    }

    private func mark(_ operationId: String, problem: NoteProblem) {
        var operations = queue()
        guard let at = operations.firstIndex(where: { $0.id == operationId }) else { return }
        operations[at].problem = problem
        saveQueue(operations)
    }

    /// Sign-out or the end of the session: the copy and the queue go.
    public func removeAll() {
        for id in loadIndex().savedAt.keys { store.remove(Self.record(id)) }
        store.remove(Self.index)
        store.remove(Self.queueRecord)
    }

    /// Drops copies older than the policy allows, then all but the most recent patients.
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
