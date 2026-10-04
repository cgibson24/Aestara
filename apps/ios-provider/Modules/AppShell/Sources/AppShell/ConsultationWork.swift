// Consultation work for one signed-in user in one organization (spec §8;
// ADR-0026 K3-06, K3-21; ADR-0027): the repositories, the encrypted copy of
// open consultations, and the queues of note drafts and annotation layers
// written offline, which replay after the photography sync has re-validated
// the session (spec §8 rule 5). The permissions only shape the UI; the server
// authorizes every request.
// Bible §5, §23 · tier: app · Layer 3.
import Annotations
import Authentication
import BeforeAfter
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
    let annotations: AnnotationsRepository
    let annotationStore: AnnotationStore
    let comparisons: BeforeAfterRepository
    let exports: ExportRepository
    let userId: String
    let photography: PhotographyContext
    /// For step-up: exports ask the user to confirm it is them (ADR-0027).
    let auth: AuthStore
    /// Drafts the server refused or that conflict, for their authors to decide (spec §8 rule 4).
    private(set) var problems: [NoteOperation] = []
    private(set) var waiting = 0
    private var syncing = false

    init(client: Client, scope: StoreScope, photography: PhotographyContext, auth: AuthStore,
         keys: any StoreKeyProviding = KeychainStoreKeys()) {
        let sealed = EncryptedStore(scope: scope, keys: keys)
        repository = ConsultationRepository(client: client)
        store = ConsultationStore(store: sealed)
        documents = DocumentsRepository(client: client)
        annotations = AnnotationsRepository(client: client)
        annotationStore = AnnotationStore(store: sealed)
        comparisons = BeforeAfterRepository(client: client)
        exports = ExportRepository(client: client)
        userId = scope.userId
        self.photography = photography
        self.auth = auth
    }

    func can(_ permission: String) -> Bool { photography.can(permission) }

    var isOnline: Bool { photography.isOnline }

    /// After the photography sync (offline views, then photos): the cache policy, then the
    /// note drafts, then the annotation layers.
    func sync() async {
        guard !syncing else { return }
        syncing = true
        defer { syncing = false }
        if photography.isOnline {
            if let policy = try? await photography.repository.offlineCachePolicy() {
                await store.apply(maxPatients: policy.maxPatients, maxAgeDays: policy.maxAgeDays)
                await annotationStore.apply(maxPatients: policy.maxPatients, maxAgeDays: policy.maxAgeDays)
            }
            _ = await store.replay(using: repository)
            _ = await annotationStore.replay(using: annotations)
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
        waiting = queue.count + (await annotationStore.queue()).count
    }

    /// A workbench for one photo's annotation layers.
    func annotationWorkbench(patientId: String, photoId: String) -> AnnotationWorkbench {
        AnnotationWorkbench(repository: annotations, store: annotationStore, patientId: patientId, photoId: photoId,
                            userId: userId, canAnnotate: can("photo.annotate"))
    }

    /// What the comparison screens borrow from photography: photos and images, each view audited.
    func comparisonSources(patientId: String) -> ComparisonSources {
        let photography = self.photography
        return ComparisonSources(
            photos: { await Self.comparisonPhotos(photography: photography, patientId: patientId) },
            images: { ids, preview in
                await photography.derivatives(patientId: patientId, photoIds: ids, variant: preview ? .displayPreview : .thumbnail)
            },
            autoRegistration: { await photography.flags["beforeAfter.autoRegistration"] ?? true }
        )
    }

    /// The patient's accepted photos, or offline the ones saved on this device.
    private static func comparisonPhotos(photography: PhotographyContext, patientId: String) async -> [ComparisonPhoto] {
        let photos: [PhotoItem]
        do throws(APIError) {
            photos = try await photography.repository.photos(patientId: patientId)
            photography.reachedServer()
        } catch {
            photography.note(error)
            photos = photography.cachedPhotos(patientId: patientId)
        }
        return photos.filter { $0.status == "ACCEPTED" }
            .map { ComparisonPhoto(id: $0.id, viewKey: $0.viewKey, capturedAt: $0.capturedAt) }
    }

    /// Before signing out: one more attempt, then what would be lost.
    func unsentBeforeSignOut() async -> Int {
        await sync()
        return waiting
    }

    func purge() async {
        await store.removeAll()
        await annotationStore.removeAll()
        await refreshQueue()
    }
}
