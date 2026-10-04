// The state of one open consultation workspace (Bible §5.1; spec §5.4.1, §8;
// ADR-0026 K3-02 to K3-09, K3-21): the consultation, its notes, the patient's
// concerns and medical history. Online, every change goes to the server, which
// decides it. Offline, the workspace shows the copy saved on this device, and
// only note drafts can be written: they wait in the encrypted queue and are
// sent on reconnect (K3-06). A version that moved on is never overwritten
// silently: both texts are shown (spec §8 rule 4).
// Bible §5 · tier: app · Layer 3.
import ConsultationDomain
import CoreNetworking
import DesignSystem
import Foundation
import Observation
import PatientDomain

@MainActor
@Observable
final class WorkspaceModel {
    let work: ConsultationWork
    let patient: Patient
    private(set) var consultation: Consultation
    /// Oldest first; drafts waiting in the queue are shown with their queued text.
    private(set) var notes: [ConsultationNote] = []
    private(set) var concerns: [PatientConcern] = []
    private(set) var history: [MedicalHistoryEntry] = []
    /// Showing the copy saved on this device.
    private(set) var offline = false
    /// The consultation could not be loaded at all.
    private(set) var failure: DSViewState?
    private(set) var busy = false
    /// The last change the server refused, in words.
    var message: String?
    /// Bumped after a summary is generated, so the summary list loads again.
    private(set) var summaries = 0
    /// Notes with a change still waiting to be sent.
    private(set) var queuedNotes: Set<String> = []

    init(work: ConsultationWork, patient: Patient, consultation: Consultation) {
        self.work = work
        self.patient = patient
        self.consultation = consultation
    }

    var canEdit: Bool { work.can("consultation.edit") }
    var canComplete: Bool { work.can("consultation.complete") }

    /// New notes while the consultation is under way (K3-07).
    var canWriteNotes: Bool { canEdit && consultation.status.notesOpen }

    /// Addenda to final notes, also after completion (K3-07).
    var canWriteAddenda: Bool { canEdit && (consultation.status.notesOpen || consultation.status == .completed) }

    /// Reason and concern selection, while the content is open (K3-02), online.
    var canChangeContent: Bool { canEdit && consultation.status.contentOpen && !offline }

    /// Queued drafts of this consultation that need their author's decision.
    var problems: [NoteOperation] { work.problems.filter { $0.consultationId == consultation.id } }

    var topLevelNotes: [ConsultationNote] { notes.filter { $0.correctsNoteId == nil } }

    func addenda(of note: ConsultationNote) -> [ConsultationNote] {
        notes.filter { $0.correctsNoteId == note.id }
    }

    /// One's own note; a note created offline has no server author yet.
    func isMine(_ note: ConsultationNote) -> Bool {
        note.authorUserId == work.userId || note.version == 0
    }

    // MARK: Loading

    /// Sends queued drafts first, then loads everything from the server, or shows the copy.
    func load() async {
        await work.sync()
        let repository = work.repository
        let patientId = patient.id
        do throws(APIError) {
            let current = try await repository.consultation(patientId: patientId, id: consultation.id)
            let loadedNotes = try await repository.notes(current)
            let loadedConcerns = try await repository.concerns(patientId: patientId)
            let loadedHistory = try await repository.history(patientId: patientId)
            work.photography.reachedServer()
            consultation = current
            concerns = loadedConcerns
            history = loadedHistory
            offline = false
            failure = nil
            notes = await withQueued(loadedNotes)
        } catch {
            work.photography.note(error)
            if error.status == 0 {
                offline = true
                failure = nil
                if let saved = await work.store.snapshot(patientId: patientId) {
                    if let copy = saved.consultations.first(where: { $0.id == consultation.id }) { consultation = copy }
                    concerns = saved.concerns
                    history = saved.history
                    notes = await withQueued(saved.notes[consultation.id] ?? [])
                } else {
                    notes = await withQueued(notes)
                }
            } else {
                failure = error.status == 404
                    ? .error(message: String(localized: "This consultation is not available."), reference: error.requestId)
                    : error.viewState
            }
        }
    }

    /// Shows the queued text of each draft waiting to be sent; drafts with a problem
    /// keep the server's text here and show both in their own card.
    private func withQueued(_ base: [ConsultationNote]) async -> [ConsultationNote] {
        await work.refreshQueue()
        var result = base
        var queued: Set<String> = []
        let operations = await work.store.queue()
        for operation in operations where operation.consultationId == consultation.id && operation.problem == nil {
            queued.insert(operation.noteId)
            if let at = result.firstIndex(where: { $0.id == operation.noteId }) {
                result[at] = result[at].with(body: operation.body, version: result[at].version, updatedAt: operation.queuedAt)
            } else {
                result.append(ConsultationNote(
                    id: operation.noteId, consultationId: operation.consultationId, authorUserId: work.userId,
                    status: .draft, body: operation.body, correctsNoteId: operation.correctsNoteId, finalizedAt: nil,
                    createdAt: operation.queuedAt, updatedAt: operation.queuedAt, version: 0
                ))
            }
        }
        queuedNotes = queued
        return result
    }

    /// Runs one online change; a refusal is shown in words, a lost connection says so.
    @discardableResult
    private func attempt(_ change: () async throws(APIError) -> Void) async -> Bool {
        busy = true
        defer { busy = false }
        do throws(APIError) {
            try await change()
            work.photography.reachedServer()
            message = nil
            return true
        } catch {
            work.photography.note(error)
            message = error.status == 0
                ? String(localized: "This needs a connection. Try again when you are online.")
                : error.displayMessage
            // Someone changed it meanwhile, or the server says what is left: show the current state.
            if error.status == 412 || error.status == 409 || error.status == 422 { await refreshConsultation() }
            return false
        }
    }

    private func refreshConsultation() async {
        if let current = try? await work.repository.consultation(patientId: patient.id, id: consultation.id) {
            consultation = current
        }
    }

    // MARK: Reason, concerns and history

    func saveReason(_ reason: String) async {
        let repository = work.repository
        let current = consultation
        await attempt { () async throws(APIError) in
            consultation = try await repository.updateReason(current, reason: reason)
        }
    }

    /// Selects or removes one of the patient's concerns for this consultation.
    func toggle(_ concern: PatientConcern) async {
        var ids = consultation.concernIds
        if let at = ids.firstIndex(of: concern.id) { ids.remove(at: at) } else { ids.append(concern.id) }
        let repository = work.repository
        let current = consultation
        await attempt { () async throws(APIError) in
            consultation = try await repository.setConcerns(current, concernIds: ids)
        }
    }

    /// Records a concern of the patient and selects it for this consultation.
    func addConcern(area: ConcernArea, description: String) async -> Bool {
        let repository = work.repository
        let patientId = patient.id
        return await attempt { () async throws(APIError) in
            guard let concern = try await repository.addConcern(patientId: patientId, area: area, description: description,
                                                                idempotencyKey: newIdempotencyKey()) else { return }
            concerns.append(concern)
            consultation = try await repository.setConcerns(consultation, concernIds: consultation.concernIds + [concern.id])
        }
    }

    func setResolved(_ concern: PatientConcern, resolved: Bool) async {
        let repository = work.repository
        let patientId = patient.id
        await attempt { () async throws(APIError) in
            guard let updated = try await repository.setResolved(concern, patientId: patientId, resolved: resolved) else { return }
            if let at = concerns.firstIndex(where: { $0.id == updated.id }) { concerns[at] = updated }
        }
    }

    func addHistory(category: HistoryCategory, description: String) async -> Bool {
        let repository = work.repository
        let patientId = patient.id
        return await attempt { () async throws(APIError) in
            guard let entry = try await repository.addHistory(patientId: patientId, category: category, description: description,
                                                              idempotencyKey: newIdempotencyKey()) else { return }
            history.append(entry)
        }
    }

    // MARK: State changes and the summary

    @discardableResult
    func perform(_ action: ConsultationAction, reason: String? = nil) async -> Bool {
        let repository = work.repository
        let current = consultation
        return await attempt { () async throws(APIError) in
            consultation = try await repository.perform(action, on: current, reason: reason)
        }
    }

    /// A new version of the consultation's summary document (K3-17).
    func generateSummary() async {
        let repository = work.repository
        let current = consultation
        let generated = await attempt { () async throws(APIError) in
            _ = try await repository.generateSummary(current, idempotencyKey: newIdempotencyKey())
        }
        if generated {
            summaries += 1
            await refreshConsultation()
        }
    }

    // MARK: Notes

    /// Saves a draft: a new note or addendum, or an edit of one's own draft. Without a
    /// connection, or when the draft moved on meanwhile, it waits in the queue (K3-06).
    func saveNote(_ note: ConsultationNote?, body: String, correctsNoteId: String?) async -> Bool {
        let repository = work.repository
        let store = work.store
        let patientId = patient.id
        let consultationId = consultation.id
        busy = true
        defer { busy = false }
        if let note {
            if note.version == 0 || offline || queuedNotes.contains(note.id) {
                await store.queueEdit(patientId: patientId, consultationId: consultationId, noteId: note.id, body: body,
                                      baseVersion: note.version)
                notes = await withQueued(notes)
                return true
            }
            do throws(APIError) {
                let saved = try await repository.updateNote(patientId: patientId, consultationId: consultationId,
                                                            noteId: note.id, body: body, version: note.version)
                replace(saved)
                message = nil
                return true
            } catch {
                work.photography.note(error)
                guard error.status == 0 || error.status == 412 else {
                    message = error.displayMessage
                    return false
                }
                await store.queueEdit(patientId: patientId, consultationId: consultationId, noteId: note.id, body: body,
                                      baseVersion: note.version)
                // A version that moved on: the replay keeps both texts for the author (spec §8 rule 4).
                if error.status == 412 { await work.sync() }
                notes = await withQueued(notes)
                return true
            }
        }
        let noteId = UUIDv7.make()
        if !offline {
            do throws(APIError) {
                let created = try await repository.createNote(patientId: patientId, consultationId: consultationId,
                                                              noteId: noteId, body: body, correctsNoteId: correctsNoteId,
                                                              idempotencyKey: newIdempotencyKey())
                notes.append(created)
                message = nil
                await refreshConsultation()
                return true
            } catch {
                work.photography.note(error)
                guard error.status == 0 else {
                    message = error.displayMessage
                    return false
                }
            }
        }
        // The same client ID is sent on replay, so the note is created once (spec §8 rule 1).
        await store.queueCreate(patientId: patientId, consultationId: consultationId, noteId: noteId, body: body,
                                correctsNoteId: correctsNoteId)
        notes = await withQueued(notes)
        return true
    }

    /// Discards one's own draft: a draft only on this device leaves the queue; a sent one is deleted online.
    func discard(_ note: ConsultationNote) async {
        let store = work.store
        let queued = await store.queue().filter { $0.noteId == note.id }
        if note.version == 0 {
            for operation in queued { await store.discard(operation.id) }
            notes.removeAll { $0.id == note.id }
            await work.refreshQueue()
            queuedNotes.remove(note.id)
            return
        }
        let repository = work.repository
        let patientId = patient.id
        let deleted = await attempt { () async throws(APIError) in
            try await repository.deleteNote(note, patientId: patientId)
        }
        guard deleted else { return }
        for operation in queued { await store.discard(operation.id) }
        notes.removeAll { $0.id == note.id }
        notes = await withQueued(notes)
        await refreshConsultation()
    }

    /// Finalizes one's own draft, online only: it then never changes (K3-07).
    func finalize(_ note: ConsultationNote) async {
        guard !queuedNotes.contains(note.id) else {
            message = String(localized: "This draft is still waiting to be sent. Finalize it once it has been sent.")
            return
        }
        let repository = work.repository
        let patientId = patient.id
        let finalized = await attempt { () async throws(APIError) in
            let final = try await repository.finalize(note, patientId: patientId)
            replace(final)
        }
        if finalized { await refreshConsultation() }
    }

    /// Keeps the author's text over the server's: sent again on top of the server's version.
    func keepMine(_ operation: NoteOperation) async {
        await work.store.keepMine(operation.id)
        await work.sync()
        await load()
    }

    /// Keeps the server's text (or gives up a refused draft): the queued text is dropped.
    func dropQueued(_ operation: NoteOperation) async {
        await work.store.discard(operation.id)
        await work.refreshQueue()
        await load()
    }

    private func replace(_ note: ConsultationNote) {
        if let at = notes.firstIndex(where: { $0.id == note.id }) { notes[at] = note } else { notes.append(note) }
    }
}
