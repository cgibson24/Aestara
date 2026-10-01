// The offline capture queue (Bible §23.1–23.3; spec §8 rules 1–6; ADR-0023
// K2-03, K2-17): sessions started and photos accepted on the device wait here,
// sealed in the encrypted store of the user and organization that captured
// them, until they reach the server. Each operation carries a client UUIDv7
// and UUIDv7 idempotency keys (spec §8 rule 1), so a replay never creates
// anything twice. Sessions
// go first, then each photo: the upload intent, the write-once PUT, and
// completion. The local original is kept until the server has accepted the
// photo (scanned clean); a rejected photo keeps its original so the
// photographer can upload it again as a new photo or retake it.
// Bible §6.3, §23 · tier: feature · Layer 2.
import CoreNetworking
import CoreSecurity
import Foundation
import Media

/// The server operations the queue replays (implemented by `PhotographyRepository`).
public protocol UploadService: Sendable {
    func startSession(patientId: String, protocolId: String, sessionId: String, startedAt: Date, idempotencyKey: String) async throws(APIError) -> PhotoSessionModel
    func createUpload(_ record: CaptureRecord, idempotencyKey: String) async throws(APIError) -> UploadTicket
    func completeUpload(patientId: String, photoId: String, idempotencyKey: String) async throws(APIError) -> PhotoItem
    func photo(patientId: String, photoId: String) async throws(APIError) -> PhotoItem
}

extension PhotographyRepository: UploadService {}

/// The PUT of an original (implemented by `MediaTransfer`).
public protocol ObjectUploading: Sendable {
    func upload(_ data: Data, to url: URL, headers: [String: String]) async throws(TransferError)
}

extension MediaTransfer: ObjectUploading {}

/// A session started while offline.
public struct PendingSession: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let patientId: String
    public let protocolId: String
    public let startedAt: Date
    let idempotencyKey: String
}

/// A photo accepted by the photographer and not yet accepted by the server.
public struct PendingCapture: Codable, Sendable, Equatable, Identifiable {
    public enum Stage: Codable, Sendable, Equatable {
        /// Waiting to upload (or to retry).
        case queued
        /// Uploaded and verified; waiting for the malware scan.
        case scanning
        /// The server rejected it: the original stays so it can be uploaded again.
        case rejected(reason: String)
        /// The upload was refused for a reason a retry cannot fix.
        case failed(message: String)
    }

    public var id: String { record.photoId }
    public let record: CaptureRecord
    let intentKey: String
    let completeKey: String
    public internal(set) var stage: Stage
}

public struct QueueOutcome: Sendable, Equatable {
    public var sessionsCreated = 0
    public var uploaded = 0
    public var accepted = 0
    /// Processing stopped early: offline, the server unavailable, or the session ended.
    public var interrupted = false

    public init() {}
}

public actor UploadQueue {
    struct State: Codable {
        var sessions: [PendingSession] = []
        var captures: [PendingCapture] = []
    }

    private static let record = "upload-queue.json"
    private let store: EncryptedStore

    public init(store: EncryptedStore) {
        self.store = store
    }

    private static func imageName(_ photoId: String) -> String { "capture.\(photoId).jpg" }

    private func load() -> State {
        (try? store.readJSON(State.self, from: Self.record)) ?? State()
    }

    private func save(_ state: State) throws(EncryptedStoreError) {
        try store.writeJSON(state, as: Self.record)
    }

    // MARK: Adding work

    /// Queues a session the server has not seen yet; returns its client ID.
    public func enqueueSession(patientId: String, protocolId: String, startedAt: Date = Date()) throws(EncryptedStoreError) -> String {
        var state = load()
        let session = PendingSession(id: UUIDv7.make(at: startedAt), patientId: patientId, protocolId: protocolId,
                                     startedAt: startedAt, idempotencyKey: UUIDv7.make(at: Date()))
        state.sessions.append(session)
        try save(state)
        return session.id
    }

    /// Queues an accepted photo with its encoded original.
    public func enqueue(_ record: CaptureRecord, image: Data) throws(EncryptedStoreError) {
        try store.write(image, as: Self.imageName(record.photoId))
        var state = load()
        state.captures.append(PendingCapture(record: record, intentKey: UUIDv7.make(at: Date()), completeKey: UUIDv7.make(at: Date()), stage: .queued))
        try save(state)
    }

    // MARK: Reading

    public func captures() -> [PendingCapture] { load().captures }

    public func pendingSessions() -> [PendingSession] { load().sessions }

    /// Photos whose originals the server does not hold yet: lost if the user signs out.
    public func unsentCount() -> Int {
        load().captures.filter { if case .scanning = $0.stage { return false } else { return true } }.count
    }

    /// The kept original of a queued photo, for review or a new upload.
    public func image(of photoId: String) -> Data? {
        try? store.read(Self.imageName(photoId))
    }

    /// Uploads a rejected photo's kept original again, as a new photo with a new ID
    /// (ADR-0023 K2-04); the rejected photo stays on record at the server.
    public func requeueAsNew(_ photoId: String) throws(EncryptedStoreError) -> String? {
        var state = load()
        guard let index = state.captures.firstIndex(where: { $0.id == photoId }),
              let image = image(of: photoId) else { return nil }
        let record = state.captures[index].record.withPhotoId(UUIDv7.make(at: Date()))
        try store.write(image, as: Self.imageName(record.photoId))
        state.captures[index] = PendingCapture(record: record, intentKey: UUIDv7.make(at: Date()), completeKey: UUIDv7.make(at: Date()), stage: .queued)
        try save(state)
        store.remove(Self.imageName(photoId))
        return record.photoId
    }

    /// Removes a rejected or failed photo (the photographer chose to retake it).
    public func discard(_ photoId: String) {
        var state = load()
        state.captures.removeAll { $0.id == photoId }
        try? save(state)
        store.remove(Self.imageName(photoId))
    }

    // MARK: Processing

    /// Replays the queue once. Stops at the first network or server failure and
    /// leaves the rest for the next attempt.
    public func process(service: some UploadService, uploader: some ObjectUploading) async -> QueueOutcome {
        var outcome = QueueOutcome()
        for session in load().sessions {
            do throws(APIError) {
                _ = try await service.startSession(patientId: session.patientId, protocolId: session.protocolId,
                                                   sessionId: session.id, startedAt: session.startedAt,
                                                   idempotencyKey: session.idempotencyKey)
                update { $0.sessions.removeAll { $0.id == session.id } }
                outcome.sessionsCreated += 1
            } catch {
                outcome.interrupted = true
                return outcome
            }
        }
        for capture in load().captures {
            switch capture.stage {
            case .queued:
                guard let image = image(of: capture.id) else {
                    setStage(capture.id, .failed(message: String(localized: "The photo is no longer on this device.")))
                    continue
                }
                switch await upload(capture, image: image, service: service, uploader: uploader) {
                case .done: outcome.uploaded += 1
                case .retryLater: continue
                case .stop:
                    outcome.interrupted = true
                    return outcome
                }
            case .scanning:
                do throws(APIError) {
                    let photo = try await service.photo(patientId: capture.record.patientId, photoId: capture.id)
                    if photo.isViewable {
                        discard(capture.id)
                        outcome.accepted += 1
                    } else if photo.isRejected {
                        setStage(capture.id, .rejected(reason: photo.rejectionReason ?? "REJECTED"))
                    }
                } catch {
                    if Self.isTransient(error) {
                        outcome.interrupted = true
                        return outcome
                    }
                }
            case .rejected, .failed:
                continue
            }
        }
        return outcome
    }

    private enum Step { case done, retryLater, stop }

    private func upload(_ capture: PendingCapture, image: Data, service: some UploadService, uploader: some ObjectUploading) async -> Step {
        let record = capture.record
        do throws(APIError) {
            let ticket = try await service.createUpload(record, idempotencyKey: capture.intentKey)
            if let url = ticket.url {
                do throws(TransferError) {
                    try await uploader.upload(image, to: url, headers: ticket.headers)
                } catch {
                    switch error {
                    case .offline, .server: return .stop
                    // An expired URL: replaying the intent with the same key issues a fresh one.
                    case .refused: return .retryLater
                    }
                }
                _ = try await service.completeUpload(patientId: record.patientId, photoId: record.photoId, idempotencyKey: capture.completeKey)
            }
            setStage(capture.id, .scanning)
            return .done
        } catch {
            if Self.isTransient(error) { return .stop }
            setStage(capture.id, .failed(message: error.displayMessage))
            return .retryLater
        }
    }

    static func isTransient(_ error: APIError) -> Bool {
        error.status == 0 || error.status == 401 || error.status == 429 || error.status >= 500
    }

    private func setStage(_ photoId: String, _ stage: PendingCapture.Stage) {
        update { state in
            if let index = state.captures.firstIndex(where: { $0.id == photoId }) { state.captures[index].stage = stage }
        }
    }

    private func update(_ change: (inout State) -> Void) {
        var state = load()
        change(&state)
        try? save(state)
    }

    /// Sign-out deletes every queued session and photo of this user and organization.
    public func purge() {
        for name in store.names(withPrefix: "capture.") { store.remove(name) }
        store.remove(Self.record)
    }
}
