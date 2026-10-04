// The offline capture queue (Bible §23; spec §8 rules 1–6; ADR-0023 K2-03,
// K2-04, K2-17): sessions first, then each photo's intent, write-once PUT and
// completion, each replayed with the same idempotency keys; the original stays
// until the server accepts the photo; a rejected one can go again as a new photo.
import CoreNetworking
import CoreSecurity
import Foundation
import HTTPTypes
import Media
import OpenAPIRuntime
@testable import Photography
import Testing

private func store() -> EncryptedStore {
    EncryptedStore(
        scope: StoreScope(userId: UUID().uuidString, organizationId: UUID().uuidString),
        keys: InMemoryStoreKeys(),
        baseDirectory: FileManager.default.temporaryDirectory.appending(path: "queue-\(UUID().uuidString)")
    )
}

private let offline = APIError(status: 0, code: "OFFLINE", message: "offline")

private func record(_ photoId: String = UUIDv7.make(at: Date()), session: String = "s1") -> CaptureRecord {
    CaptureRecord(photoId: photoId, patientId: "p1", sessionId: session, viewKey: "FRONT", capturedAt: Date(), byteSize: 4,
                  sha256: sha256Hex(Data("jpeg".utf8)), widthPx: 3, heightPx: 4, deviceModel: "Test", pose: PoseSample(yawDeg: 0),
                  positionMatchScore: nil, referencePhotoId: nil, checks: [QualityCheckResult(code: .levelCamera, passed: true, value: 0)])
}

private func makePhoto(_ id: String, status: String) -> PhotoItem {
    PhotoItem(id: id, patientId: "p1", sessionId: "s1", viewKey: "FRONT", status: status, capturedAt: Date(),
              scanStatus: status == "ACCEPTED" ? "CLEAN" : "PENDING", rejectionReason: status == "REJECTED" ? "MALWARE_DETECTED" : nil,
              thumbnail: .pending, preview: .pending, tags: [], pose: PoseSample(), positionMatchScore: nil)
}

/// The server, as the queue sees it: records every call and its idempotency key.
private actor FakeServer: UploadService {
    var failWith: APIError?
    var status = "QUARANTINED"
    private(set) var sessions: [(id: String, key: String)] = []
    private(set) var intents: [(photoId: String, key: String)] = []
    private(set) var completions: [String] = []

    func fail(_ error: APIError?) { failWith = error }
    func setStatus(_ value: String) { status = value }

    func startSession(patientId: String, protocolId: String, consultationId: String?, sessionId: String,
                      startedAt: Date, idempotencyKey: String) async throws(APIError) -> PhotoSessionModel {
        if let failWith { throw failWith }
        sessions.append((sessionId, idempotencyKey))
        return PhotoSessionModel(id: sessionId, patientId: patientId, protocolId: protocolId, protocolName: "Face", status: "IN_PROGRESS",
                                 startedAt: startedAt, views: [], missingRequiredViews: [])
    }

    func createUpload(_ record: CaptureRecord, idempotencyKey: String) async throws(APIError) -> UploadTicket {
        if let failWith { throw failWith }
        intents.append((record.photoId, idempotencyKey))
        return UploadTicket(photoId: record.photoId, status: "UPLOAD_PENDING", url: URL(string: "https://storage.test/\(record.photoId)"),
                            headers: ["If-None-Match": "*"])
    }

    func completeUpload(patientId: String, photoId: String, idempotencyKey: String) async throws(APIError) -> PhotoItem {
        if let failWith { throw failWith }
        completions.append(idempotencyKey)
        return makePhoto(photoId, status: "QUARANTINED")
    }

    func photo(patientId: String, photoId: String) async throws(APIError) -> PhotoItem {
        if let failWith { throw failWith }
        return makePhoto(photoId, status: status)
    }
}

private actor FakeStorage: ObjectUploading {
    var failWith: TransferError?
    private(set) var puts: [(url: URL, headers: [String: String], bytes: Data)] = []

    func fail(_ error: TransferError?) { failWith = error }

    func upload(_ data: Data, to url: URL, headers: [String: String]) async throws(TransferError) {
        if let failWith { throw failWith }
        puts.append((url, headers, data))
    }
}

@Test func uploadsAQueuedPhotoWriteOnceAndWaitsForTheScan() async throws {
    let queue = UploadQueue(store: store())
    let server = FakeServer()
    let storage = FakeStorage()
    let capture = record()
    try await queue.enqueue(capture, image: Data("jpeg".utf8))
    #expect(await queue.unsentCount() == 1)

    let outcome = await queue.process(service: server, uploader: storage)
    #expect(outcome.uploaded == 1)
    #expect(!outcome.interrupted)
    let puts = await storage.puts
    #expect(puts.count == 1)
    #expect(puts.first?.headers["If-None-Match"] == "*")
    #expect(puts.first?.bytes == Data("jpeg".utf8))
    #expect(await server.completions.count == 1)
    // Held by the server now; the original stays on the device until it is accepted.
    #expect(await queue.unsentCount() == 0)
    #expect(await queue.captures().first?.stage == .scanning)
    #expect(await queue.image(of: capture.photoId) == Data("jpeg".utf8))
}

@Test func anAcceptedPhotoLeavesTheDevice() async throws {
    let queue = UploadQueue(store: store())
    let server = FakeServer()
    let capture = record()
    try await queue.enqueue(capture, image: Data("jpeg".utf8))
    _ = await queue.process(service: server, uploader: FakeStorage())
    await server.setStatus("ACCEPTED")
    let outcome = await queue.process(service: server, uploader: FakeStorage())
    #expect(outcome.accepted == 1)
    #expect(await queue.captures().isEmpty)
    #expect(await queue.image(of: capture.photoId) == nil)
}

@Test func offlineStopsAndReplaysWithTheSameKeys() async throws {
    let queue = UploadQueue(store: store())
    let server = FakeServer()
    let sessionId = try await queue.enqueueSession(patientId: "p1", protocolId: "face")
    try await queue.enqueue(record(session: sessionId), image: Data("jpeg".utf8))
    await server.fail(offline)

    let first = await queue.process(service: server, uploader: FakeStorage())
    #expect(first.interrupted)
    #expect(await queue.pendingSessions().count == 1)
    #expect(await queue.unsentCount() == 1)

    await server.fail(nil)
    let second = await queue.process(service: server, uploader: FakeStorage())
    #expect(second.sessionsCreated == 1)
    #expect(second.uploaded == 1)
    #expect(await server.sessions.map { $0.id } == [sessionId])
    #expect(await queue.pendingSessions().isEmpty)
}

@Test func anExpiredUploadURLIsRetriedWithTheSameIntentKey() async throws {
    let queue = UploadQueue(store: store())
    let server = FakeServer()
    let storage = FakeStorage()
    try await queue.enqueue(record(), image: Data("jpeg".utf8))
    // S3 answers 403 once a presigned URL has expired.
    await storage.fail(.refused(status: 403))
    let first = await queue.process(service: server, uploader: storage)
    #expect(first.uploaded == 0)
    #expect(await queue.captures().first?.stage == .queued)

    await storage.fail(nil)
    _ = await queue.process(service: server, uploader: storage)
    let keys = await server.intents.map { $0.key }
    #expect(keys.count == 2)
    #expect(Set(keys).count == 1)
    #expect(await queue.captures().first?.stage == .scanning)
}

@Test func aRefusedIntentIsMarkedFailedAndTheRestContinue() async throws {
    let queue = UploadQueue(store: store())
    let server = FakeServer()
    try await queue.enqueue(record(), image: Data("jpeg".utf8))
    await server.fail(APIError(status: 422, code: "INVALID_STATE_TRANSITION", message: "The session is finished; start a new one."))
    let outcome = await queue.process(service: server, uploader: FakeStorage())
    #expect(!outcome.interrupted)
    guard case .failed? = await queue.captures().first?.stage else {
        Issue.record("The refused photo is not marked failed")
        return
    }
    #expect(await queue.unsentCount() == 1)
}

@Test func aRejectedPhotoKeepsItsOriginalAndCanGoAgainAsANewPhoto() async throws {
    let queue = UploadQueue(store: store())
    let server = FakeServer()
    let capture = record()
    try await queue.enqueue(capture, image: Data("jpeg".utf8))
    _ = await queue.process(service: server, uploader: FakeStorage())
    await server.setStatus("REJECTED")
    _ = await queue.process(service: server, uploader: FakeStorage())
    #expect(await queue.captures().first?.stage == .rejected(reason: "MALWARE_DETECTED"))
    #expect(await queue.image(of: capture.photoId) == Data("jpeg".utf8))

    let requeued = try await queue.requeueAsNew(capture.photoId)
    let newId = try #require(requeued)
    #expect(newId != capture.photoId)
    let captures = await queue.captures()
    #expect(captures.map(\.id) == [newId])
    #expect(captures.first?.stage == .queued)
    #expect(captures.first?.record.sha256 == capture.sha256)
    #expect(await queue.image(of: newId) == Data("jpeg".utf8))
    #expect(await queue.image(of: capture.photoId) == nil)
}

@Test func signOutDeletesTheQueueButNotOtherRecords() async throws {
    let store = store()
    let queue = UploadQueue(store: store)
    try await queue.enqueue(record(), image: Data("jpeg".utf8))
    try store.write(Data("[]".utf8), as: "offline-audit.json")
    await queue.purge()
    #expect(await queue.captures().isEmpty)
    #expect(store.names() == ["offline-audit.json"])
}

// MARK: Media permissions (spec §5.4.5; K2-15)

private func row(_ state: String, photoId: String? = nil, session: String? = nil, expires: Date? = nil) -> PermissionRecord {
    PermissionRecord(id: UUID().uuidString, category: "WEBSITE", scope: photoId != nil ? "PHOTO" : session != nil ? "PHOTO_SESSION" : "PATIENT_WIDE",
                     photoSessionId: session, photoId: photoId, state: state, versionNumber: 1, effectiveAt: Date(), expiresAt: expires,
                     evidence: nil, reason: nil)
}

@Test func theMostSpecificPermissionWins() {
    let summary = PermissionCategoryState(category: .website, state: "GRANTED", current: row("GRANTED"),
                                          exceptions: [row("DECLINED", photoId: "ph1"), row("REVOKED", session: "s2")])
    #expect(summary.effectiveState(forPhoto: "ph1", sessionId: "s2") == "DECLINED")
    #expect(summary.effectiveState(forPhoto: "ph2", sessionId: "s2") == "REVOKED")
    #expect(summary.effectiveState(forPhoto: "ph3", sessionId: "s3") == "GRANTED")
    #expect(summary.photoRow("ph1")?.state == "DECLINED")
}

@Test func aGrantPastItsExpiryReadsAsExpired() {
    let now = Date()
    let summary = PermissionCategoryState(category: .website, state: "GRANTED", current: nil,
                                          exceptions: [row("GRANTED", photoId: "ph1", expires: now.addingTimeInterval(-1))])
    #expect(summary.effectiveState(forPhoto: "ph1", sessionId: nil, at: now) == "EXPIRED")
}

@Test func onlyTheStateMachinesTransitionsAreOffered() {
    #expect(PermissionChange.allowed(from: "NOT_REQUESTED") == [.requested])
    #expect(PermissionChange.allowed(from: "REQUESTED") == [.granted, .declined])
    #expect(PermissionChange.allowed(from: "GRANTED") == [.revoked])
    for ended in ["DECLINED", "REVOKED", "EXPIRED"] {
        #expect(PermissionChange.allowed(from: ended) == [.requested])
    }
}

@MainActor
@Test func releasesAreOfferedOnlyForOutwardPurposes() {
    #expect(!PhotoDetailView.releasePurposes.contains(.clinicalUse))
    #expect(!PhotoDetailView.releasePurposes.contains(.aiTraining))
    #expect(!PhotoDetailView.releasePurposes.contains(.internalAIEvaluation))
    #expect(PhotoDetailView.releasePurposes.contains(.patientApp))
}

// MARK: Re-validation before replay (spec §8 rule 5)

/// A transport that answers every request with `401` and records the paths it saw.
private actor Unauthenticated {
    private(set) var paths: [String] = []
    func record(_ path: String) { paths.append(path) }
}

private struct StubTransport: ClientTransport {
    let respond: @Sendable (HTTPRequest) async throws -> (HTTPResponse, HTTPBody?)
    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        try await respond(request)
    }
}

@MainActor
@Test func nothingReplaysWhenTheSessionNoLongerValidates() async throws {
    let seen = Unauthenticated()
    let transport = StubTransport { request in
        await seen.record(request.path ?? "")
        let body = #"{"error":{"code":"UNAUTHENTICATED","message":"Sign in to continue.","requestId":"r"}}"#
        return (HTTPResponse(status: .unauthorized, headerFields: [.contentType: "application/json"]), HTTPBody(body))
    }
    let client = APIClientFactory.make(baseURL: URL(string: "https://api.example.test")!, transport: transport)
    let scope = StoreScope(userId: UUID().uuidString.lowercased(), organizationId: UUID().uuidString.lowercased())
    let context = PhotographyContext(client: client, scope: scope, permissions: ["photo.capture"], keys: InMemoryStoreKeys())
    try await context.queue.enqueue(record(), image: Data("jpeg".utf8))
    await context.sync()
    let paths = await seen.paths
    #expect(!paths.isEmpty)
    #expect(paths.allSatisfy { $0.hasSuffix("/auth/session") })
    #expect(await context.queue.captures().first?.stage == .queued)
    #expect(context.unsentCount == 1)
    await context.purgeForSignOut()
}

