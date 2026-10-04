// One photo's annotation layers on screen (Bible §5.1, §6.6; spec §8;
// ADR-0026 K3-06, K3-10; ADR-0027). Online, layers load from the server and
// are saved on the device for offline use; offline, the saved copy is shown
// and one's own layers can still be drawn and changed: they wait in the
// encrypted queue and are sent on reconnect. A layer that changed meanwhile
// is never overwritten silently: both drawings are shown for its author.
// Only the author changes or deletes a layer; the server decides.
// Bible §6.6 · tier: feature · Layer 3.
import CoreNetworking
import Foundation
import Observation

@MainActor
@Observable
public final class AnnotationWorkbench {
    public let patientId: String
    public let photoId: String
    public let userId: String
    /// `photo.annotate`: only shapes the UI; the server decides.
    public let canAnnotate: Bool
    private let repository: AnnotationsRepository
    private let store: AnnotationStore

    /// The photo's layers, oldest first, with queued changes applied.
    public private(set) var layers: [AnnotationLayerItem] = []
    /// Queued changes of this photo that need their author's decision.
    public private(set) var problems: [AnnotationOperation] = []
    /// Layers with a change still waiting to be sent.
    public private(set) var queuedLayers: Set<String> = []
    public private(set) var offline = false
    public private(set) var loaded = false
    /// The layers could not be loaded at all.
    public private(set) var failure: String?
    public private(set) var busy = false
    /// The last change the server refused, in words.
    public var message: String?
    /// The layer being drawn, and the layers hidden from view. Kept here rather than in the
    /// screen, so a screen that SwiftUI builds again keeps the drawing in progress: the iPad
    /// rebuilds a presented screen when the text size changes (F-70).
    var draft: AnnotationDraft?
    var hidden: Set<String> = []

    public init(repository: AnnotationsRepository, store: AnnotationStore, patientId: String, photoId: String,
                userId: String, canAnnotate: Bool) {
        self.repository = repository
        self.store = store
        self.patientId = patientId
        self.photoId = photoId
        self.userId = userId
        self.canAnnotate = canAnnotate
    }

    /// One's own layer; a layer drawn offline has no server author yet.
    public func isMine(_ layer: AnnotationLayerItem) -> Bool {
        layer.authorUserId == userId || layer.version == 0
    }

    /// Loads once; a screen built again shows what is already loaded.
    public func loadIfNeeded() async {
        guard !loaded else { return }
        await load()
    }

    public func load() async {
        do throws(APIError) {
            let current = try await repository.layers(patientId: patientId, photoId: photoId)
            await store.save(current, patientId: patientId, photoId: photoId)
            offline = false
            failure = nil
            layers = await withQueued(current)
        } catch {
            if error.status == 0 {
                offline = true
                failure = nil
                let saved = await store.layers(photoId: photoId) ?? []
                layers = await withQueued(saved)
            } else {
                failure = error.status == 404 ? String(localized: "This photo is not available.") : error.displayMessage
            }
        }
        loaded = true
    }

    /// Shows the queued drawing of each layer waiting to be sent; layers with a problem keep
    /// the server's drawing here and show both in their own card.
    private func withQueued(_ base: [AnnotationLayerItem]) async -> [AnnotationLayerItem] {
        let operations = await store.queue().filter { $0.photoId == photoId }
        problems = operations.filter { $0.problem != nil }
        var result = base
        var queued: Set<String> = []
        for operation in operations where operation.problem == nil {
            queued.insert(operation.layerId)
            if let at = result.firstIndex(where: { $0.id == operation.layerId }) {
                let old = result[at]
                result[at] = AnnotationLayerItem(id: old.id, photoId: old.photoId, authorUserId: old.authorUserId,
                                                 label: operation.label, drawing: operation.drawing,
                                                 updatedAt: operation.queuedAt, version: old.version)
            } else {
                result.append(AnnotationLayerItem(id: operation.layerId, photoId: photoId, authorUserId: userId,
                                                  label: operation.label, drawing: operation.drawing,
                                                  updatedAt: operation.queuedAt, version: 0))
            }
        }
        queuedLayers = queued
        return result
    }

    /// Saves a new layer, or a change of one's own layer. Without a connection, or when the
    /// layer moved on meanwhile, it waits in the queue (K3-06).
    public func save(_ layer: AnnotationLayerItem?, drawing: AnnotationDrawing, label: String?) async -> Bool {
        guard drawing.isWithinLimits else {
            message = String(localized: "This layer is larger than allowed. Remove some shapes or start another layer.")
            return false
        }
        busy = true
        defer { busy = false }
        if let layer {
            if layer.version == 0 || offline || queuedLayers.contains(layer.id) {
                await store.queueEdit(patientId: patientId, photoId: photoId, layerId: layer.id, label: label,
                                      drawing: drawing, baseVersion: layer.version)
                layers = await withQueued(layers)
                return true
            }
            do throws(APIError) {
                _ = try await repository.update(patientId: patientId, photoId: photoId, layerId: layer.id, label: label,
                                                drawing: drawing, version: layer.version)
                message = nil
                await load()
                return true
            } catch {
                guard error.status == 0 || error.status == 412 else {
                    message = error.displayMessage
                    return false
                }
                await store.queueEdit(patientId: patientId, photoId: photoId, layerId: layer.id, label: label,
                                      drawing: drawing, baseVersion: layer.version)
                // A version that moved on: the replay keeps both drawings for the author (spec §8 rule 4).
                if error.status == 412 { _ = await store.replay(using: repository) } else { offline = true }
                layers = await withQueued(layers)
                return true
            }
        }
        let layerId = UUIDv7.make()
        if !offline {
            do throws(APIError) {
                _ = try await repository.create(patientId: patientId, photoId: photoId, layerId: layerId, label: label,
                                                drawing: drawing, idempotencyKey: newIdempotencyKey())
                message = nil
                await load()
                return true
            } catch {
                guard error.status == 0 else {
                    message = error.displayMessage
                    return false
                }
                offline = true
            }
        }
        // The same client ID is sent on replay, so the layer is created once (spec §8 rule 1).
        await store.queueCreate(patientId: patientId, photoId: photoId, layerId: layerId, label: label, drawing: drawing)
        layers = await withQueued(layers)
        return true
    }

    /// Deletes one's own layer: a layer only on the device leaves the queue; a sent one is deleted online.
    public func delete(_ layer: AnnotationLayerItem) async {
        if layer.version == 0 {
            await store.discardLayer(layer.id)
            await load()
            return
        }
        busy = true
        defer { busy = false }
        do throws(APIError) {
            try await repository.delete(patientId: patientId, layer: layer)
            await store.discardLayer(layer.id)
            message = nil
            await load()
        } catch {
            message = error.status == 0
                ? String(localized: "Deleting a layer needs a connection.")
                : error.displayMessage
        }
    }

    /// Keeps the author's drawing over the server's: sent again on top of the server's version.
    public func keepMine(_ operation: AnnotationOperation) async {
        await store.keepMine(operation.id)
        _ = await store.replay(using: repository)
        await load()
    }

    /// Keeps the server's drawing (or gives up a refused change): the queued drawing is dropped.
    public func keepSaved(_ operation: AnnotationOperation) async {
        await store.discard(operation.id)
        await load()
    }
}

/// A layer being drawn: a new one, or a change to one's own layer.
struct AnnotationDraft: Equatable {
    let layer: AnnotationLayerItem?
    var drawing: AnnotationDrawing
    var label: String
}
