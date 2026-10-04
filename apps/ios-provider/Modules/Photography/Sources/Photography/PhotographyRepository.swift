// Photography through the generated client (spec §6.3 "Photography"; §3.4
// flow A). Every call is authorized by the server; a 403 or 404 is the real
// answer (spec §4.6). Generated types end here (ADR-0022).
// Bible §6, §7 · tier: feature · Layer 2.
import CoreNetworking
import Foundation
import Media

/// The upload content types the provider app sends (ADR-0023 K2-02).
enum ImageContentType: String {
    case jpeg = "image/jpeg"
}

enum ProtocolStatusFilter: String {
    case active = "ACTIVE"
}

/// Patient-wide, or one photo's exception (the UI offers these two; ADR-0023 K2-15).
enum PermissionScopeValue: String {
    case patientWide = "PATIENT_WIDE"
    case photo = "PHOTO"
}

/// Everything the capture flow records with a photo.
public struct CaptureRecord: Sendable, Equatable, Codable {
    public let photoId: String
    public let patientId: String
    public let sessionId: String
    public let viewKey: String
    public let capturedAt: Date
    public let byteSize: Int
    public let sha256: String
    public let widthPx: Int?
    public let heightPx: Int?
    public let deviceModel: String?
    public let pose: PoseSample
    public let positionMatchScore: Double?
    public let referencePhotoId: String?
    public let checks: [QualityCheckResult]

    public init(photoId: String, patientId: String, sessionId: String, viewKey: String, capturedAt: Date, byteSize: Int,
                sha256: String, widthPx: Int?, heightPx: Int?, deviceModel: String?, pose: PoseSample,
                positionMatchScore: Double?, referencePhotoId: String?, checks: [QualityCheckResult]) {
        self.photoId = photoId
        self.patientId = patientId
        self.sessionId = sessionId
        self.viewKey = viewKey
        self.capturedAt = capturedAt
        self.byteSize = byteSize
        self.sha256 = sha256
        self.widthPx = widthPx
        self.heightPx = heightPx
        self.deviceModel = deviceModel
        self.pose = pose
        self.positionMatchScore = positionMatchScore
        self.referencePhotoId = referencePhotoId
        self.checks = checks
    }

    /// The same capture under a new photo ID (an upload again after a rejection).
    func withPhotoId(_ id: String) -> CaptureRecord {
        CaptureRecord(photoId: id, patientId: patientId, sessionId: sessionId, viewKey: viewKey, capturedAt: capturedAt,
                      byteSize: byteSize, sha256: sha256, widthPx: widthPx, heightPx: heightPx, deviceModel: deviceModel,
                      pose: pose, positionMatchScore: positionMatchScore, referencePhotoId: referencePhotoId, checks: checks)
    }
}

public actor PhotographyRepository {
    private let client: Client

    public init(client: Client) {
        self.client = client
    }

    // MARK: Protocols and sessions

    /// The active protocols the photographer may start sessions with.
    public func activeProtocols() async throws(APIError) -> [PhotoProtocol] {
        let client = self.client
        let page = try await callAPI {
            try await client.listPhotographyProtocols(query: .init(limit: 100, status: wire(ProtocolStatusFilter.active))).ok.body.json
        }
        return page.data.map(Self.photoProtocol)
    }

    /// Starts a session, for a consultation when one is named. `sessionId` is a client
    /// UUIDv7, so a queued replay creates it once.
    public func startSession(patientId: String, protocolId: String, consultationId: String?, sessionId: String,
                             startedAt: Date, idempotencyKey: String) async throws(APIError) -> PhotoSessionModel {
        let client = self.client
        let body = Components.Schemas.PhotoSessionCreate(id: sessionId, protocolId: protocolId, consultationId: consultationId,
                                                         startedAt: startedAt)
        let session = try await callAPI {
            try await client.createPhotoSession(
                path: .init(patientId: patientId),
                headers: .init(idempotencyKey: idempotencyKey),
                body: .json(body)
            ).created.body.json.data
        }
        return Self.session(session)
    }

    public func session(patientId: String, sessionId: String) async throws(APIError) -> PhotoSessionModel {
        let client = self.client
        let session = try await callAPI {
            try await client.getPhotoSession(path: .init(patientId: patientId, sessionId: sessionId)).ok.body.json.data
        }
        return Self.session(session)
    }

    /// The newest sessions, or every session taken for one consultation.
    public func sessions(patientId: String, consultationId: String? = nil) async throws(APIError) -> [PhotoSessionModel] {
        let client = self.client
        let page = try await callAPI {
            try await client.listPhotoSessions(path: .init(patientId: patientId),
                                               query: .init(limit: consultationId == nil ? 50 : 100, consultationId: consultationId))
                .ok.body.json
        }
        return page.data.map(Self.session)
    }

    /// Completes a session; with required views missing the server answers
    /// `422 REQUIRED_VIEWS_MISSING` unless the photographer acknowledged it (K2-13).
    public func completeSession(patientId: String, sessionId: String, acknowledgeMissing: Bool) async throws(APIError) -> PhotoSessionModel {
        let client = self.client
        let session = try await callAPI {
            try await client.completePhotoSession(
                path: .init(patientId: patientId, sessionId: sessionId),
                body: .json(.init(acknowledgeMissingRequiredViews: acknowledgeMissing))
            ).ok.body.json.data
        }
        return Self.session(session)
    }

    // MARK: Uploads

    /// The upload intent. Replaying it with the same key returns a fresh URL while the bytes are missing (K2-03).
    public func createUpload(_ record: CaptureRecord, idempotencyKey: String) async throws(APIError) -> UploadTicket {
        let client = self.client
        let metadata = Components.Schemas.CaptureMetadata(
            deviceModel: record.deviceModel,
            yawDeg: record.pose.yawDeg,
            pitchDeg: record.pose.pitchDeg,
            rollDeg: record.pose.rollDeg,
            frameFill: record.pose.frameFill,
            positionMatchScore: record.positionMatchScore,
            referencePhotoId: record.referencePhotoId
        )
        let body = Components.Schemas.PhotoUploadRequest(
            id: record.photoId,
            photoSessionId: record.sessionId,
            viewKey: record.viewKey,
            contentType: wire(ImageContentType.jpeg),
            byteSize: record.byteSize,
            sha256: record.sha256,
            capturedAt: record.capturedAt,
            widthPx: record.widthPx,
            heightPx: record.heightPx,
            captureMetadata: metadata,
            qualityChecks: record.checks.map {
                Components.Schemas.QualityCheck(code: wire($0.code), passed: $0.passed, value: $0.value)
            }
        )
        let patientId = record.patientId
        let intent = try await callAPI {
            try await client.createPhotoUpload(
                path: .init(patientId: patientId),
                headers: .init(idempotencyKey: idempotencyKey),
                body: .json(body)
            ).created.body.json.data
        }
        return UploadTicket(
            photoId: intent.photoId,
            status: intent.status.rawValue,
            url: intent.upload.flatMap { URL(string: $0.url) },
            // A free-form object is generated as a wrapper around its dictionary.
            headers: intent.upload?.headers.additionalProperties ?? [:]
        )
    }

    /// Verification at the api: size, checksum and first bytes; the photo then waits for its scan.
    public func completeUpload(patientId: String, photoId: String, idempotencyKey: String) async throws(APIError) -> PhotoItem {
        let client = self.client
        let photo = try await callAPI {
            try await client.completePhotoUpload(
                path: .init(patientId: patientId, photoId: photoId),
                headers: .init(idempotencyKey: idempotencyKey)
            ).ok.body.json.data
        }
        return Self.photo(photo)
    }

    // MARK: Photos

    public func photos(patientId: String, sessionId: String? = nil, viewKey: String? = nil, includeArchived: Bool = false) async throws(APIError) -> [PhotoItem] {
        let client = self.client
        let page = try await callAPI {
            try await client.listPhotos(
                path: .init(patientId: patientId),
                query: .init(
                    limit: 100,
                    photoSessionId: sessionId,
                    viewKey: viewKey,
                    includeArchived: .init(rawValue: includeArchived ? "true" : "false")
                )
            ).ok.body.json
        }
        return page.data.map(Self.photo)
    }

    public func photo(patientId: String, photoId: String) async throws(APIError) -> PhotoItem {
        let client = self.client
        let photo = try await callAPI {
            try await client.getPhoto(path: .init(patientId: patientId, photoId: photoId)).ok.body.json.data
        }
        return Self.photo(photo)
    }

    /// Signed URLs for up to 60 photos in one request; the server audits each view (K2-14).
    public func accessURLs(patientId: String, photoIds: [String], variant: DerivativeVariant) async throws(APIError) -> [String: URL] {
        guard !photoIds.isEmpty else { return [:] }
        let client = self.client
        var result: [String: URL] = [:]
        var start = 0
        while start < photoIds.count {
            let chunk = Array(photoIds[start..<min(start + 60, photoIds.count)])
            let batch = try await callAPI {
                try await client.createPhotoAccessUrls(
                    path: .init(patientId: patientId),
                    body: .json(.init(photoIds: chunk, variant: wire(variant)))
                ).created.body.json.data
            }
            for item in batch.urls {
                if let url = URL(string: item.url) { result[item.photoId] = url }
            }
            start += chunk.count
        }
        return result
    }

    public func replaceTags(patientId: String, photoId: String, tags: [String]) async throws(APIError) -> PhotoItem {
        let client = self.client
        let photo = try await callAPI {
            try await client.replacePhotoTags(
                path: .init(patientId: patientId, photoId: photoId),
                body: .json(.init(tags: tags))
            ).ok.body.json.data
        }
        return Self.photo(photo)
    }

    /// Archives an accepted photo; the original is kept and there is no unarchive (spec §5.4.10).
    public func archive(patientId: String, photoId: String) async throws(APIError) -> PhotoItem {
        let client = self.client
        let photo = try await callAPI {
            try await client.archivePhoto(path: .init(patientId: patientId, photoId: photoId)).ok.body.json.data
        }
        return Self.photo(photo)
    }

    // MARK: Media permissions (Bible §7; ADR-0023 K2-15)

    public func permissions(patientId: String) async throws(APIError) -> [PermissionCategoryState] {
        let client = self.client
        let summary = try await callAPI {
            try await client.getPhotoPermissions(path: .init(patientId: patientId)).ok.body.json.data
        }
        return summary.categories.compactMap { item in
            guard let category: PermissionCategory = unwire(item.category) else { return nil }
            return PermissionCategoryState(
                category: category,
                state: item.patientWideState.rawValue,
                current: item.patientWide.map(Self.permission),
                exceptions: item.exceptions.map(Self.permission)
            )
        }
    }

    /// Records a change, patient-wide or for one photo (`photoId`), attested by the
    /// staff member (the only evidence in Layer 2). Ending a grant revokes the releases on it.
    public func recordPermission(patientId: String, category: PermissionCategory, change: PermissionChange, photoId: String? = nil,
                                 expiresAt: Date?, reason: String?, idempotencyKey: String) async throws(APIError) -> PermissionRecord {
        let client = self.client
        let evidence: PermissionEvidence? = change == .granted ? .staffAttestation : nil
        let scope: PermissionScopeValue = photoId == nil ? .patientWide : .photo
        let body = Components.Schemas.PhotoPermissionChange(
            category: wire(category),
            scope: wire(scope),
            photoId: photoId,
            state: wire(change),
            evidence: evidence.map { wire($0) },
            expiresAt: change == .granted ? expiresAt : nil,
            reason: reason
        )
        let record = try await callAPI {
            try await client.recordPhotoPermission(
                path: .init(patientId: patientId),
                headers: .init(idempotencyKey: idempotencyKey),
                body: .json(body)
            ).created.body.json.data
        }
        return Self.permission(record)
    }

    public func permissionHistory(patientId: String) async throws(APIError) -> [PermissionRecord] {
        let client = self.client
        let page = try await callAPI {
            try await client.listPhotoPermissionHistory(path: .init(patientId: patientId), query: .init(limit: 100)).ok.body.json
        }
        return page.data.map(Self.permission)
    }

    // MARK: Media releases (Bible §7.3; ADR-0023 K2-15)

    public func releases(patientId: String) async throws(APIError) -> [MediaReleaseItem] {
        let client = self.client
        let page = try await callAPI {
            try await client.listMediaReleases(path: .init(patientId: patientId), query: .init(limit: 100)).ok.body.json
        }
        return page.data.compactMap(Self.release)
    }

    /// Releases an accepted photo for one purpose; the server re-checks the grant and pins it.
    public func release(patientId: String, photoId: String, purpose: PermissionCategory, idempotencyKey: String) async throws(APIError) -> MediaReleaseItem? {
        let client = self.client
        let release = try await callAPI {
            try await client.createMediaRelease(
                path: .init(patientId: patientId),
                headers: .init(idempotencyKey: idempotencyKey),
                body: .json(.init(purpose: wire(purpose), photoId: photoId))
            ).created.body.json.data
        }
        return Self.release(release)
    }

    /// Revokes a release; it stays on record with its pins.
    public func revokeRelease(patientId: String, releaseId: String, reason: String) async throws(APIError) -> MediaReleaseItem? {
        let client = self.client
        let release = try await callAPI {
            try await client.revokeMediaRelease(
                path: .init(patientId: patientId, releaseId: releaseId),
                body: .json(.init(reason: reason))
            ).ok.body.json.data
        }
        return Self.release(release)
    }

    // MARK: Configuration (ADR-0023 K2-17, K2-18)

    /// The strictest cache policy among the practices the user works in.
    public func offlineCachePolicy() async throws(APIError) -> CachePolicy {
        let client = self.client
        let policy = try await callAPI { try await client.getOfflineCachePolicy().ok.body.json.data }
        return CachePolicy(maxPatients: policy.maxPatients, maxAgeDays: policy.maxAgeDays)
    }

    /// Flag values by key; a flag only hides a feature and never grants access.
    public func featureFlags() async throws(APIError) -> [String: Bool] {
        let client = self.client
        let page = try await callAPI { try await client.listFeatureFlags().ok.body.json }
        return Dictionary(page.data.map { ($0.key.rawValue, $0.enabled) }, uniquingKeysWith: { first, _ in first })
    }

    // MARK: Mapping

    static func photoProtocol(_ p: Components.Schemas.PhotographyProtocol) -> PhotoProtocol {
        PhotoProtocol(
            id: p.id,
            name: p.name,
            bodyRegion: p.bodyRegion.rawValue,
            isStandard: p.standard,
            views: p.views.map { v in
                ProtocolViewSpec(
                    viewKey: v.viewKey,
                    name: v.name,
                    sortOrder: v.sortOrder,
                    isRequired: v.isRequired,
                    instructions: v.captureInstructions,
                    poseTarget: v.poseTarget.map(Self.poseTarget)
                )
            }.sorted { $0.sortOrder < $1.sortOrder }
        )
    }

    static func poseTarget(_ t: Components.Schemas.PoseTarget) -> PoseTarget {
        PoseTarget(
            subject: PoseTarget.Subject(rawValue: t.subject.rawValue) ?? .face,
            yawDeg: t.yawDeg,
            yawToleranceDeg: t.yawToleranceDeg,
            pitchToleranceDeg: t.pitchToleranceDeg,
            rollToleranceDeg: t.rollToleranceDeg,
            centerToleranceFraction: t.centerToleranceFraction,
            frameFill: t.frameFill,
            frameFillTolerance: t.frameFillTolerance
        )
    }

    static func session(_ s: Components.Schemas.PhotoSession) -> PhotoSessionModel {
        PhotoSessionModel(
            id: s.id,
            patientId: s.patientId,
            protocolId: s.protocolId,
            protocolName: s.protocolName,
            status: s.status.rawValue,
            startedAt: s.startedAt,
            views: s.views.map {
                SessionViewState(viewKey: $0.viewKey, name: $0.name, sortOrder: $0.sortOrder, isRequired: $0.isRequired,
                                 captured: $0.captured, photoCount: $0.photoCount)
            }.sorted { $0.sortOrder < $1.sortOrder },
            missingRequiredViews: s.missingRequiredViews,
            consultationId: s.consultationId
        )
    }

    static func photo(_ p: Components.Schemas.Photo) -> PhotoItem {
        let state = { (kind: String) -> DerivativeState in
            p.derivatives.first { $0.kind.rawValue == kind }.flatMap { DerivativeState(rawValue: $0.status.rawValue) } ?? .pending
        }
        return PhotoItem(
            id: p.id,
            patientId: p.patientId,
            sessionId: p.photoSessionId,
            viewKey: p.viewKey,
            status: p.status.rawValue,
            capturedAt: p.capturedAt,
            scanStatus: p.scanStatus.rawValue,
            rejectionReason: p.rejectionReason?.rawValue,
            thumbnail: state(DerivativeVariant.thumbnail.rawValue),
            preview: state(DerivativeVariant.displayPreview.rawValue),
            tags: p.tags,
            pose: PoseSample(
                yawDeg: p.captureMetadata?.yawDeg,
                pitchDeg: p.captureMetadata?.pitchDeg,
                rollDeg: p.captureMetadata?.rollDeg,
                frameFill: p.captureMetadata?.frameFill
            ),
            positionMatchScore: p.positionMatchScore
        )
    }

    static func permission(_ r: Components.Schemas.PhotoPermission) -> PermissionRecord {
        PermissionRecord(
            id: r.id,
            category: r.category.rawValue,
            scope: r.scope.rawValue,
            photoSessionId: r.photoSessionId,
            photoId: r.photoId,
            state: r.state.rawValue,
            versionNumber: r.versionNumber,
            effectiveAt: r.effectiveAt,
            expiresAt: r.expiresAt,
            evidence: r.evidence?.rawValue,
            reason: r.reason
        )
    }

    static func release(_ r: Components.Schemas.MediaRelease) -> MediaReleaseItem? {
        guard let purpose: PermissionCategory = unwire(r.purpose) else { return nil }
        return MediaReleaseItem(
            id: r.id,
            purpose: purpose,
            photoId: r.photoId,
            releasedAt: r.releasedAt,
            revokedAt: r.revokedAt,
            revocationReason: r.revocationReason,
            isActive: r.active
        )
    }
}
