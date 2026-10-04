// Annotation layers through the generated client (spec §6.3 "Photography";
// ADR-0026 K3-10; ADR-0027). Layers travel as the contract's JSON: the
// drawing is encoded by `AnnotationDrawing` and decoded into the generated
// types here, so generated types end here (ADR-0022). Only the author changes
// or deletes a layer; the server decides. Changes carry If-Match; a layer
// drawn offline carries its client UUIDv7.
// Bible §6.6 · tier: feature · Layer 3.
import CoreNetworking
import Foundation

public actor AnnotationsRepository {
    private let client: Client

    public init(client: Client) {
        self.client = client
    }

    /// The photo's layers, oldest first; deleted layers are not listed.
    public func layers(patientId: String, photoId: String) async throws(APIError) -> [AnnotationLayerItem] {
        let client = self.client
        let page = try await callAPI {
            try await client.listPhotoAnnotations(path: .init(patientId: patientId, photoId: photoId)).ok.body.json
        }
        return page.data.compactMap(Self.item)
    }

    /// A new layer. `layerId` is a client UUIDv7, so a replay creates it once.
    public func create(patientId: String, photoId: String, layerId: String, label: String?, drawing: AnnotationDrawing,
                       idempotencyKey: String) async throws(APIError) -> AnnotationLayerItem {
        let client = self.client
        let layer = try Self.wire(drawing)
        let body = Components.Schemas.PhotoAnnotationCreate(id: layerId, label: label, layer: layer)
        let created = try await callAPI {
            try await client.createPhotoAnnotation(
                path: .init(patientId: patientId, photoId: photoId),
                headers: .init(idempotencyKey: idempotencyKey),
                body: .json(body)
            ).created.body.json.data
        }
        guard let item = Self.item(created) else { throw APIError.unexpected }
        return item
    }

    /// Changes one's own layer. A version that moved on answers 412.
    public func update(patientId: String, photoId: String, layerId: String, label: String?, drawing: AnnotationDrawing,
                       version: Int) async throws(APIError) -> AnnotationLayerItem {
        let client = self.client
        let layer = try Self.wire(drawing)
        let body = Components.Schemas.PhotoAnnotationUpdate(label: label, layer: layer)
        let updated = try await callAPI {
            try await client.updatePhotoAnnotation(
                path: .init(patientId: patientId, photoId: photoId, annotationId: layerId),
                headers: .init(ifMatch: ifMatch(version)),
                body: .json(body)
            ).ok.body.json.data
        }
        guard let item = Self.item(updated) else { throw APIError.unexpected }
        return item
    }

    /// Deletes one's own layer; the server keeps the row, marked deleted.
    public func delete(patientId: String, layer: AnnotationLayerItem) async throws(APIError) {
        let client = self.client
        _ = try await callAPI {
            try await client.deletePhotoAnnotation(
                path: .init(patientId: patientId, photoId: layer.photoId, annotationId: layer.id),
                headers: .init(ifMatch: ifMatch(layer.version))
            ).noContent
        }
    }

    // MARK: Mapping

    /// The drawing as the generated type, through the contract's JSON.
    static func wire(_ drawing: AnnotationDrawing) throws(APIError) -> Components.Schemas.AnnotationLayer {
        do {
            let data = try JSONEncoder().encode(drawing)
            return try JSONDecoder().decode(Components.Schemas.AnnotationLayer.self, from: data)
        } catch {
            throw APIError.unexpected
        }
    }

    static func drawing(_ layer: Components.Schemas.AnnotationLayer) -> AnnotationDrawing? {
        guard let data = try? JSONEncoder().encode(layer) else { return nil }
        return try? JSONDecoder().decode(AnnotationDrawing.self, from: data)
    }

    static func item(_ a: Components.Schemas.PhotoAnnotation) -> AnnotationLayerItem? {
        guard let drawing = drawing(a.layer) else { return nil }
        return AnnotationLayerItem(id: a.id, photoId: a.photoId, authorUserId: a.authorUserId, label: a.label,
                                   drawing: drawing, updatedAt: a.updatedAt, version: a.version)
    }
}
