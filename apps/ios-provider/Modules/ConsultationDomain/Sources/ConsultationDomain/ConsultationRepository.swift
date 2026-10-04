// Consultations, notes, concerns and medical history through the generated
// client (spec §6.3 "Consultations"; ADR-0026 K3-01 to K3-09, K3-17). Every
// call is authorized by the server: a 403 or 404 is the real answer (spec
// §4.6). Changes carry If-Match; creates carry an Idempotency-Key, and a note
// drafted offline carries its client UUIDv7 (spec §8). Generated types end
// here (ADR-0022).
// Bible §5 · tier: domain · Layer 3.
import CoreNetworking
import Foundation

public actor ConsultationRepository {
    private let client: Client

    public init(client: Client) {
        self.client = client
    }

    // MARK: Consultations

    /// The patient's consultations, newest first; archived ones only when asked for.
    public func consultations(patientId: String, includeArchived: Bool = false) async throws(APIError) -> [Consultation] {
        let client = self.client
        let page = try await callAPI {
            try await client.listConsultations(
                path: .init(patientId: patientId),
                query: .init(limit: 100, includeArchived: .init(rawValue: includeArchived ? "true" : "false"))
            ).ok.body.json
        }
        return page.data.map(Self.consultation)
    }

    public func consultation(patientId: String, id: String) async throws(APIError) -> Consultation {
        let client = self.client
        let c = try await callAPI {
            try await client.getConsultation(path: .init(patientId: patientId, consultationId: id)).ok.body.json.data
        }
        return Self.consultation(c)
    }

    /// The organization's active practices; the server decides which the caller may use.
    public func practices() async throws(APIError) -> [PracticeOption] {
        let client = self.client
        let page = try await callAPI {
            try await client.listPractices(query: .init(limit: 100)).ok.body.json
        }
        return page.data.filter { $0.status.rawValue == "ACTIVE" }.map { PracticeOption(id: $0.id, name: $0.name) }
    }

    /// Creates a DRAFT consultation in a practice the caller's grants cover.
    public func create(patientId: String, practiceId: String, providerUserId: String?, reason: String?,
                       idempotencyKey: String) async throws(APIError) -> Consultation {
        let client = self.client
        let body = Components.Schemas.ConsultationCreate(practiceId: practiceId, primaryProviderUserId: providerUserId, reason: reason)
        let c = try await callAPI {
            try await client.createConsultation(
                path: .init(patientId: patientId),
                headers: .init(idempotencyKey: idempotencyKey),
                body: .json(body)
            ).created.body.json.data
        }
        return Self.consultation(c)
    }

    /// Records the reason while the content is open (ADR-0026 K3-02).
    public func updateReason(_ consultation: Consultation, reason: String) async throws(APIError) -> Consultation {
        let client = self.client
        let c = try await callAPI {
            try await client.updateConsultation(
                path: .init(patientId: consultation.patientId, consultationId: consultation.id),
                headers: .init(ifMatch: ifMatch(consultation.version)),
                body: .json(.init(reason: reason))
            ).ok.body.json.data
        }
        return Self.consultation(c)
    }

    /// One transition of spec §5.4.1. `reason` is required to cancel.
    public func perform(_ action: ConsultationAction, on consultation: Consultation,
                        reason: String? = nil) async throws(APIError) -> Consultation {
        let client = self.client
        let patientId = consultation.patientId
        let consultationId = consultation.id
        let version = ifMatch(consultation.version)
        let c = try await callAPI { () async throws -> Components.Schemas.Consultation in
            switch action {
            case .start:
                return try await client.startConsultation(
                    path: .init(patientId: patientId, consultationId: consultationId),
                    headers: .init(ifMatch: version)
                ).ok.body.json.data
            case .requestInformation:
                return try await client.requestConsultationInformation(
                    path: .init(patientId: patientId, consultationId: consultationId),
                    headers: .init(ifMatch: version)
                ).ok.body.json.data
            case .resume:
                return try await client.resumeConsultation(
                    path: .init(patientId: patientId, consultationId: consultationId),
                    headers: .init(ifMatch: version)
                ).ok.body.json.data
            case .submitForReview:
                return try await client.submitConsultationForReview(
                    path: .init(patientId: patientId, consultationId: consultationId),
                    headers: .init(ifMatch: version)
                ).ok.body.json.data
            case .returnToProgress:
                return try await client.returnConsultationToProgress(
                    path: .init(patientId: patientId, consultationId: consultationId),
                    headers: .init(ifMatch: version)
                ).ok.body.json.data
            case .cancel:
                return try await client.cancelConsultation(
                    path: .init(patientId: patientId, consultationId: consultationId),
                    headers: .init(ifMatch: version),
                    body: .json(.init(reason: reason ?? ""))
                ).ok.body.json.data
            case .complete:
                return try await client.completeConsultation(
                    path: .init(patientId: patientId, consultationId: consultationId),
                    headers: .init(ifMatch: version),
                    body: .json(.init(releaseDecision: wire(ReleaseDecision.nothingToRelease)))
                ).ok.body.json.data
            case .archive:
                return try await client.archiveConsultation(
                    path: .init(patientId: patientId, consultationId: consultationId),
                    headers: .init(ifMatch: version)
                ).ok.body.json.data
            }
        }
        return Self.consultation(c)
    }

    /// Replaces the consultation's concern set while its content is open.
    public func setConcerns(_ consultation: Consultation, concernIds: [String]) async throws(APIError) -> Consultation {
        let client = self.client
        let c = try await callAPI {
            try await client.putConsultationConcerns(
                path: .init(patientId: consultation.patientId, consultationId: consultation.id),
                body: .json(.init(concernIds: concernIds))
            ).ok.body.json.data
        }
        return Self.consultation(c)
    }

    /// Renders the summary PDF as a new version of the consultation's summary document (K3-17).
    public func generateSummary(_ consultation: Consultation, idempotencyKey: String) async throws(APIError) -> SummaryVersion {
        let client = self.client
        let document = try await callAPI {
            try await client.generateConsultationSummary(
                path: .init(patientId: consultation.patientId, consultationId: consultation.id),
                headers: .init(idempotencyKey: idempotencyKey)
            ).created.body.json.data
        }
        return SummaryVersion(documentId: document.id, versionNumber: document.versions.first?.versionNumber ?? 1)
    }

    // MARK: Notes

    /// Oldest first, each addendum after the note it corrects.
    public func notes(_ consultation: Consultation) async throws(APIError) -> [ConsultationNote] {
        let client = self.client
        let page = try await callAPI {
            try await client.listConsultationNotes(
                path: .init(patientId: consultation.patientId, consultationId: consultation.id),
                query: .init(limit: 100)
            ).ok.body.json
        }
        return page.data.map(Self.note)
    }

    /// A draft note, or an addendum to a final note. `noteId` is a client UUIDv7, so a replay creates it once.
    public func createNote(patientId: String, consultationId: String, noteId: String, body: String,
                           correctsNoteId: String?, idempotencyKey: String) async throws(APIError) -> ConsultationNote {
        let client = self.client
        let request = Components.Schemas.ConsultationNoteCreate(id: noteId, body: body, correctsNoteId: correctsNoteId)
        let n = try await callAPI {
            try await client.createConsultationNote(
                path: .init(patientId: patientId, consultationId: consultationId),
                headers: .init(idempotencyKey: idempotencyKey),
                body: .json(request)
            ).created.body.json.data
        }
        return Self.note(n)
    }

    /// Edits one's own draft. A version that moved on answers 412 with the current version (spec §8 rule 4).
    public func updateNote(patientId: String, consultationId: String, noteId: String, body: String,
                           version: Int) async throws(APIError) -> ConsultationNote {
        let client = self.client
        let n = try await callAPI {
            try await client.updateConsultationNote(
                path: .init(patientId: patientId, consultationId: consultationId, noteId: noteId),
                headers: .init(ifMatch: ifMatch(version)),
                body: .json(.init(body: body))
            ).ok.body.json.data
        }
        return Self.note(n)
    }

    public func note(patientId: String, consultationId: String, noteId: String) async throws(APIError) -> ConsultationNote? {
        let all = try await notes(patientId: patientId, consultationId: consultationId)
        return all.first { $0.id == noteId }
    }

    private func notes(patientId: String, consultationId: String) async throws(APIError) -> [ConsultationNote] {
        let client = self.client
        let page = try await callAPI {
            try await client.listConsultationNotes(
                path: .init(patientId: patientId, consultationId: consultationId),
                query: .init(limit: 100)
            ).ok.body.json
        }
        return page.data.map(Self.note)
    }

    /// Discards one's own draft.
    public func deleteNote(_ note: ConsultationNote, patientId: String) async throws(APIError) {
        let client = self.client
        _ = try await callAPI {
            try await client.deleteConsultationNote(
                path: .init(patientId: patientId, consultationId: note.consultationId, noteId: note.id),
                headers: .init(ifMatch: ifMatch(note.version))
            ).noContent
        }
    }

    /// Finalizes one's own draft: it then never changes (UD-15); corrections are addenda.
    public func finalize(_ note: ConsultationNote, patientId: String) async throws(APIError) -> ConsultationNote {
        let client = self.client
        let n = try await callAPI {
            try await client.finalizeConsultationNote(
                path: .init(patientId: patientId, consultationId: note.consultationId, noteId: note.id),
                headers: .init(ifMatch: ifMatch(note.version))
            ).ok.body.json.data
        }
        return Self.note(n)
    }

    // MARK: Concerns and medical history

    public func concerns(patientId: String) async throws(APIError) -> [PatientConcern] {
        let client = self.client
        let page = try await callAPI {
            try await client.listPatientConcerns(path: .init(patientId: patientId), query: .init(limit: 100)).ok.body.json
        }
        return page.data.compactMap(Self.concern)
    }

    public func addConcern(patientId: String, area: ConcernArea, description: String,
                           idempotencyKey: String) async throws(APIError) -> PatientConcern? {
        let client = self.client
        let c = try await callAPI {
            try await client.createPatientConcern(
                path: .init(patientId: patientId),
                headers: .init(idempotencyKey: idempotencyKey),
                body: .json(.init(area: wire(area), description: description))
            ).created.body.json.data
        }
        return Self.concern(c)
    }

    public func setResolved(_ concern: PatientConcern, patientId: String, resolved: Bool) async throws(APIError) -> PatientConcern? {
        let client = self.client
        let c = try await callAPI {
            try await client.updatePatientConcern(
                path: .init(patientId: patientId, concernId: concern.id),
                headers: .init(ifMatch: ifMatch(concern.version)),
                body: .json(.init(resolved: resolved))
            ).ok.body.json.data
        }
        return Self.concern(c)
    }

    public func history(patientId: String) async throws(APIError) -> [MedicalHistoryEntry] {
        let client = self.client
        let page = try await callAPI {
            try await client.listMedicalHistory(path: .init(patientId: patientId), query: .init(limit: 100)).ok.body.json
        }
        return page.data.compactMap(Self.historyEntry)
    }

    public func addHistory(patientId: String, category: HistoryCategory, description: String,
                           idempotencyKey: String) async throws(APIError) -> MedicalHistoryEntry? {
        let client = self.client
        let e = try await callAPI {
            try await client.createMedicalHistoryEntry(
                path: .init(patientId: patientId),
                headers: .init(idempotencyKey: idempotencyKey),
                body: .json(.init(category: wire(category), description: description))
            ).created.body.json.data
        }
        return Self.historyEntry(e)
    }

    // MARK: Mapping

    static func consultation(_ c: Components.Schemas.Consultation) -> Consultation {
        Consultation(
            id: c.id,
            patientId: c.patientId,
            practiceId: c.practiceId,
            locationId: c.locationId,
            primaryProviderUserId: c.primaryProviderUserId,
            status: ConsultationStatus(rawValue: c.status.rawValue) ?? .draft,
            reason: c.reason,
            concernIds: c.concernIds,
            startedAt: c.startedAt,
            readyForReviewAt: c.readyForReviewAt,
            completedAt: c.completedAt,
            cancelledAt: c.cancelledAt,
            cancellationReason: c.cancellationReason,
            unmet: c.unmetCompletionPreconditions.compactMap { CompletionPrecondition(rawValue: $0.rawValue) },
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            version: c.version
        )
    }

    static func note(_ n: Components.Schemas.ConsultationNote) -> ConsultationNote {
        ConsultationNote(
            id: n.id,
            consultationId: n.consultationId,
            authorUserId: n.authorUserId,
            status: NoteStatus(rawValue: n.status.rawValue) ?? .draft,
            body: n.body,
            correctsNoteId: n.correctsNoteId,
            finalizedAt: n.finalizedAt,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
            version: n.version
        )
    }

    static func concern(_ c: Components.Schemas.PatientConcern) -> PatientConcern? {
        guard let area = ConcernArea(rawValue: c.area.rawValue) else { return nil }
        return PatientConcern(id: c.id, area: area, description: c.description, resolvedAt: c.resolvedAt,
                              createdAt: c.createdAt, version: c.version)
    }

    static func historyEntry(_ e: Components.Schemas.MedicalHistoryEntry) -> MedicalHistoryEntry? {
        guard let category = HistoryCategory(rawValue: e.category.rawValue) else { return nil }
        return MedicalHistoryEntry(id: e.id, category: category, description: e.description, onsetDate: e.onsetDate,
                                   resolvedOn: e.resolvedOn, recordedAt: e.recordedAt, version: e.version)
    }
}
