// Annotation work offline (spec §8; ADR-0026 K3-06, K3-10; ADR-0027), sealed
// in the encrypted store of the signed-in user and organization:
// - the layers of each photo as last loaded online, to show them offline,
//   within the practice's cache policy;
// - the queue of layers drawn or changed offline over cached photos. Each
//   keeps its Idempotency-Key, the layer's client UUIDv7 and, for a change,
//   the version it was based on. They replay in order after the session is
//   checked again; a version that moved on is never overwritten silently.
// Everything here goes with sign-out.
// Bible §6.6, §23 · tier: feature · Layer 3.
import CoreNetworking
import CoreSecurity
import Foundation

/// One queued layer change (spec §8 rule 1).
public struct AnnotationOperation: Sendable, Equatable, Codable, Identifiable {
    public enum Kind: String, Sendable, Codable { case create, update }

    /// The Idempotency-Key of a create; for a change, identifies the queued entry.
    public let id: String
    public let kind: Kind
    public let patientId: String
    public let photoId: String
    public let layerId: String
    public var label: String?
    public var drawing: AnnotationDrawing
    /// The server version a change was based on (If-Match).
    public let baseVersion: Int?
    public let queuedAt: Date
    /// Why the server refused it, kept for the author to decide (spec §8 rule 4).
    public var problem: AnnotationProblem?
}

public enum AnnotationProblem: Sendable, Equatable, Codable {
    /// The layer changed on the server meanwhile: both drawings are shown.
    case conflict(serverDrawing: AnnotationDrawing, serverVersion: Int)
    /// The server refused the change for good (the photo was archived, the layer deleted).
    case refused(message: String)
}

public struct AnnotationReplay: Sendable, Equatable {
    public let sent: Int
    public let problems: Int
    /// Stopped for want of a connection.
    public let interrupted: Bool
}

public actor AnnotationStore {
    struct Entry: Codable {
        let patientId: String
        let savedAt: Date
    }

    private static let index = "annotation-index.json"
    private static let queueRecord = "annotation-queue.json"
    private let store: EncryptedStore
    private var maxPatients = 25
    private var maxAge: TimeInterval = 7 * 24 * 60 * 60

    public init(store: EncryptedStore) {
        self.store = store
    }

    private static func record(_ photoId: String) -> String {
        "annotations.\(photoId.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "-" }).json"
    }

    /// The server's cache policy, applied at once (spec §8 rule 7).
    public func apply(maxPatients: Int, maxAgeDays: Int, now: Date = Date()) {
        self.maxPatients = maxPatients
        maxAge = TimeInterval(maxAgeDays) * 24 * 60 * 60
        enforce(now: now)
    }

    // MARK: The offline copy

    public func save(_ layers: [AnnotationLayerItem], patientId: String, photoId: String, now: Date = Date()) {
        guard (try? store.writeJSON(layers, as: Self.record(photoId))) != nil else { return }
        var index = loadIndex()
        index[photoId] = Entry(patientId: patientId, savedAt: now)
        saveIndex(index)
        enforce(now: now)
    }

    /// The layers as last loaded online, while within the policy.
    public func layers(photoId: String, now: Date = Date()) -> [AnnotationLayerItem]? {
        enforce(now: now)
        guard loadIndex()[photoId] != nil else { return nil }
        return try? store.readJSON([AnnotationLayerItem].self, from: Self.record(photoId))
    }

    // MARK: The queue

    public func queue() -> [AnnotationOperation] {
        (try? store.readJSON([AnnotationOperation].self, from: Self.queueRecord)) ?? []
    }

    private func saveQueue(_ operations: [AnnotationOperation]) {
        if operations.isEmpty {
            store.remove(Self.queueRecord)
        } else {
            try? store.writeJSON(operations, as: Self.queueRecord)
        }
    }

    /// A new layer drawn offline, with its client UUIDv7.
    public func queueCreate(patientId: String, photoId: String, layerId: String, label: String?, drawing: AnnotationDrawing,
                            now: Date = Date()) {
        var operations = queue()
        operations.append(AnnotationOperation(id: newIdempotencyKey(), kind: .create, patientId: patientId, photoId: photoId,
                                              layerId: layerId, label: label, drawing: drawing, baseVersion: nil,
                                              queuedAt: now, problem: nil))
        saveQueue(operations)
    }

    /// A change of one's own layer. A layer still waiting to be sent takes the new drawing;
    /// successive changes of a sent layer keep the version the first one was based on.
    public func queueEdit(patientId: String, photoId: String, layerId: String, label: String?, drawing: AnnotationDrawing,
                          baseVersion: Int, now: Date = Date()) {
        var operations = queue()
        if let at = operations.lastIndex(where: { $0.layerId == layerId && $0.problem == nil }) {
            operations[at].drawing = drawing
            operations[at].label = label
        } else {
            operations.append(AnnotationOperation(id: newIdempotencyKey(), kind: .update, patientId: patientId, photoId: photoId,
                                                  layerId: layerId, label: label, drawing: drawing, baseVersion: baseVersion,
                                                  queuedAt: now, problem: nil))
        }
        saveQueue(operations)
    }

    public func discard(_ operationId: String) {
        saveQueue(queue().filter { $0.id != operationId })
    }

    /// Drops every queued change of a layer (the author discarded it).
    public func discardLayer(_ layerId: String) {
        saveQueue(queue().filter { $0.layerId != layerId })
    }

    /// Keeps the author's drawing over the server's: sent again on top of the server's version.
    public func keepMine(_ operationId: String, now: Date = Date()) {
        var operations = queue()
        guard let at = operations.firstIndex(where: { $0.id == operationId }),
              case let .conflict(_, serverVersion) = operations[at].problem else { return }
        let old = operations[at]
        operations[at] = AnnotationOperation(id: newIdempotencyKey(), kind: .update, patientId: old.patientId,
                                             photoId: old.photoId, layerId: old.layerId, label: old.label,
                                             drawing: old.drawing, baseVersion: serverVersion, queuedAt: now, problem: nil)
        saveQueue(operations)
    }

    /// Sends the queue in order (spec §8 rule 2): a refused layer keeps its drawing and its
    /// problem; the others continue. No connection stops the run.
    public func replay(using repository: AnnotationsRepository) async -> AnnotationReplay {
        var sent = 0
        var problems = 0
        for operation in queue() where operation.problem == nil {
            do throws(APIError) {
                switch operation.kind {
                case .create:
                    _ = try await repository.create(
                        patientId: operation.patientId, photoId: operation.photoId, layerId: operation.layerId,
                        label: operation.label, drawing: operation.drawing, idempotencyKey: operation.id
                    )
                case .update:
                    _ = try await repository.update(
                        patientId: operation.patientId, photoId: operation.photoId, layerId: operation.layerId,
                        label: operation.label, drawing: operation.drawing, version: operation.baseVersion ?? 1
                    )
                }
                discard(operation.id)
                sent += 1
            } catch {
                if error.status == 0 { return AnnotationReplay(sent: sent, problems: problems, interrupted: true) }
                problems += 1
                let problem: AnnotationProblem
                if error.status == 412,
                   let current = try? await repository.layers(patientId: operation.patientId, photoId: operation.photoId)
                       .first(where: { $0.id == operation.layerId }) {
                    problem = .conflict(serverDrawing: current.drawing, serverVersion: current.version)
                } else {
                    problem = .refused(message: error.displayMessage)
                }
                mark(operation.id, problem: problem)
            }
        }
        return AnnotationReplay(sent: sent, problems: problems, interrupted: false)
    }

    private func mark(_ operationId: String, problem: AnnotationProblem) {
        var operations = queue()
        guard let at = operations.firstIndex(where: { $0.id == operationId }) else { return }
        operations[at].problem = problem
        saveQueue(operations)
    }

    /// Sign-out: the copies and the queue go.
    public func removeAll() {
        for photoId in loadIndex().keys { store.remove(Self.record(photoId)) }
        store.remove(Self.index)
        store.remove(Self.queueRecord)
    }

    /// Drops copies older than the policy allows, then the photos of all but the most recent patients.
    func enforce(now: Date) {
        let index = loadIndex()
        let fresh = index.filter { now.timeIntervalSince($0.value.savedAt) <= maxAge }
        var latest: [String: Date] = [:]
        for entry in fresh.values { latest[entry.patientId] = max(latest[entry.patientId] ?? .distantPast, entry.savedAt) }
        let patients = Set(latest.sorted { $0.value > $1.value }.prefix(maxPatients).map(\.key))
        let kept = fresh.filter { patients.contains($0.value.patientId) }
        guard kept.count != index.count else { return }
        for photoId in index.keys where kept[photoId] == nil { store.remove(Self.record(photoId)) }
        saveIndex(kept)
    }

    private func loadIndex() -> [String: Entry] {
        (try? store.readJSON([String: Entry].self, from: Self.index)) ?? [:]
    }

    private func saveIndex(_ index: [String: Entry]) {
        try? store.writeJSON(index, as: Self.index)
    }
}
