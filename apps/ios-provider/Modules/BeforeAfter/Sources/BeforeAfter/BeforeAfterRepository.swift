// Before/after sets through the generated client (spec §6.3 "Before /
// after"; ADR-0026 K3-11, K3-13; ADR-0027). The server checks every pairing
// rule and answers one indistinguishable 404 for photos of another patient
// or tenant. Alignment changes need `photo.annotate` and If-Match. Generated
// types end here (ADR-0022).
// Bible §8 · tier: feature · Layer 3.
import CoreNetworking
import Foundation

public actor BeforeAfterRepository {
    private let client: Client

    public init(client: Client) {
        self.client = client
    }

    /// The patient's sets, newest first, or one consultation's.
    public func sets(patientId: String, consultationId: String? = nil) async throws(APIError) -> [BeforeAfterSetItem] {
        let client = self.client
        let page = try await callAPI {
            try await client.listBeforeAfterSets(path: .init(patientId: patientId),
                                                 query: .init(limit: 100, consultationId: consultationId)).ok.body.json
        }
        return page.data.map(Self.item)
    }

    public func set(patientId: String, setId: String) async throws(APIError) -> BeforeAfterSetItem {
        let client = self.client
        let current = try await callAPI {
            try await client.getBeforeAfterSet(path: .init(patientId: patientId, setId: setId)).ok.body.json.data
        }
        return Self.item(current)
    }

    /// Two accepted photos of the same view, the before one earlier (`422 INCOMPATIBLE_VIEWS`, `422 BEFORE_AFTER_ORDER`).
    public func create(patientId: String, beforePhotoId: String, afterPhotoId: String, consultationId: String?,
                       title: String?) async throws(APIError) -> BeforeAfterSetItem {
        let client = self.client
        let body = Components.Schemas.BeforeAfterSetCreate(beforePhotoId: beforePhotoId, afterPhotoId: afterPhotoId,
                                                           consultationId: consultationId, title: title)
        let created = try await callAPI {
            try await client.createBeforeAfterSet(
                path: .init(patientId: patientId),
                headers: .init(idempotencyKey: newIdempotencyKey()),
                body: .json(body)
            ).created.body.json.data
        }
        return Self.item(created)
    }

    /// Aligns by hand.
    public func align(patientId: String, set: BeforeAfterSetItem, transform: SimilarityTransform) async throws(APIError) -> BeforeAfterSetItem {
        try await update(patientId: patientId, set: set, body: UpdateBody(registration: .init(mode: "MANUAL", transform: transform.clamped)))
    }

    /// Back to no transform.
    public func reset(patientId: String, set: BeforeAfterSetItem) async throws(APIError) -> BeforeAfterSetItem {
        try await update(patientId: patientId, set: set, body: UpdateBody(registration: .init(mode: "NONE", transform: nil)))
    }

    /// Queues automatic registration; the set changes only if nothing changed it meanwhile.
    public func requestRegistration(patientId: String, set: BeforeAfterSetItem) async throws(APIError) -> BeforeAfterSetItem {
        let client = self.client
        let queued = try await callAPI {
            try await client.requestBeforeAfterRegistration(
                path: .init(patientId: patientId, setId: set.id),
                headers: .init(idempotencyKey: newIdempotencyKey())
            ).accepted.body.json.data
        }
        return Self.item(queued)
    }

    // MARK: Private

    /// The PATCH body as the contract's JSON, decoded into the generated type.
    private struct UpdateBody: Encodable {
        struct Registration: Encodable {
            let mode: String
            let transform: SimilarityTransform?
        }

        let registration: Registration
    }

    private func update(patientId: String, set: BeforeAfterSetItem, body: UpdateBody) async throws(APIError) -> BeforeAfterSetItem {
        let request: Components.Schemas.BeforeAfterSetUpdate
        do {
            request = try JSONDecoder().decode(Components.Schemas.BeforeAfterSetUpdate.self, from: JSONEncoder().encode(body))
        } catch {
            throw APIError.unexpected
        }
        let client = self.client
        let updated = try await callAPI {
            try await client.updateBeforeAfterSet(
                path: .init(patientId: patientId, setId: set.id),
                headers: .init(ifMatch: ifMatch(set.version)),
                body: .json(request)
            ).ok.body.json.data
        }
        return Self.item(updated)
    }

    static func item(_ s: Components.Schemas.BeforeAfterSet) -> BeforeAfterSetItem {
        BeforeAfterSetItem(
            id: s.id,
            beforePhotoId: s.beforePhotoId,
            afterPhotoId: s.afterPhotoId,
            consultationId: s.consultationId,
            viewKey: s.viewKey,
            title: s.title,
            mode: RegistrationModeValue(rawValue: s.registrationMode.rawValue) ?? .none,
            transform: s.registrationTransform.map {
                SimilarityTransform(scale: $0.scale, rotationDeg: $0.rotationDeg, translateX: $0.translateX, translateY: $0.translateY)
            },
            job: s.registrationJob.map { RegistrationJobState(status: $0.status.rawValue, failure: $0.failure?.rawValue) },
            createdAt: s.createdAt,
            version: s.version
        )
    }
}
