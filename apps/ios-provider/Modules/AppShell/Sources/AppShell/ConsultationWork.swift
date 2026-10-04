// Consultation work for one signed-in user in one organization (spec §8;
// ADR-0026 K3-06, K3-21): the repositories, the encrypted copy of open
// consultations and the queue of note drafts written offline, which replays
// after the photography sync has re-validated the session (spec §8 rule 5).
// The permissions only shape the UI; the server authorizes every request.
// Bible §5, §23 · tier: app · Layer 3.
import ConsultationDomain
import CoreNetworking
import CoreSecurity
import DocumentsConsent
import Foundation
import Media
import Observation
import Photography

@MainActor
@Observable
final class ConsultationWork {
    let repository: ConsultationRepository
    let store: ConsultationStore
    let documents: DocumentsRepository
    let userId: String
    let photography: PhotographyContext
    /// Drafts the server refused or that conflict, for their authors to decide (spec §8 rule 4).
    private(set) var problems: [NoteOperation] = []
    private(set) var waiting = 0
    private var syncing = false

    init(client: Client, scope: StoreScope, photography: PhotographyContext, keys: any StoreKeyProviding = KeychainStoreKeys()) {
        repository = ConsultationRepository(client: client)
        store = ConsultationStore(store: EncryptedStore(scope: scope, keys: keys))
        documents = DocumentsRepository(client: client)
        userId = scope.userId
        self.photography = photography
    }

    func can(_ permission: String) -> Bool { photography.can(permission) }

    var isOnline: Bool { photography.isOnline }

    /// After the photography sync (offline views, then photos): the cache policy, then the drafts.
    func sync() async {
        guard !syncing else { return }
        syncing = true
        defer { syncing = false }
        if photography.isOnline {
            if let policy = try? await photography.repository.offlineCachePolicy() {
                await store.apply(maxPatients: policy.maxPatients, maxAgeDays: policy.maxAgeDays)
            }
            _ = await store.replay(using: repository)
        }
        await refreshQueue()
    }

    /// Keeps the patient's open consultations with their notes, concerns and history for
    /// offline use (K3-06). A load that fails part-way saves nothing: the last whole copy stays.
    func saveCopy(patientId: String, consultations: [Consultation]) async {
        do throws(APIError) {
            var notes: [String: [ConsultationNote]] = [:]
            for consultation in consultations where !consultation.status.isFinal {
                notes[consultation.id] = try await repository.notes(consultation)
            }
            let concerns = try await repository.concerns(patientId: patientId)
            let history = try await repository.history(patientId: patientId)
            await store.save(ConsultationSnapshot(patientId: patientId, consultations: consultations, notes: notes,
                                                  concerns: concerns, history: history, savedAt: Date()))
        } catch {
            photography.note(error)
        }
    }

    func refreshQueue() async {
        let queue = await store.queue()
        problems = queue.filter { $0.problem != nil }
        waiting = queue.count
    }

    /// Before signing out: one more attempt, then what would be lost.
    func unsentBeforeSignOut() async -> Int {
        await sync()
        return waiting
    }

    func purge() async {
        await store.removeAll()
        await refreshQueue()
    }
}
