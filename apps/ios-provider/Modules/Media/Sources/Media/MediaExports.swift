// Purpose-specific exports (spec §6.3 "Photography" and "Before / after";
// Bible §7.3, §8.3, §22.4; ADR-0026 K3-14, K3-15; ADR-0027). An export is a
// new image rendered by the server from the original for one purpose, under
// the patient's current grant for it; the server checks the grant, records
// PHOTO_EXPORTED and renders asynchronously. Every call needs `photo.export`
// and a recent second factor (step-up). The file comes down through a signed
// URL valid 10 minutes and is never cached. Generated types end here
// (ADR-0022).
// Bible §7.3, §8.3 · tier: platform · Layer 3.
import CoreNetworking
import Foundation

/// The purposes an export serves; each needs the patient's current grant of the same category.
public enum ExportPurpose: String, Sendable, CaseIterable, Identifiable, Hashable {
    case clinicalUse = "CLINICAL_USE"
    case education = "EDUCATION"
    case website = "WEBSITE"
    case socialMedia = "SOCIAL_MEDIA"
    case paidAdvertising = "PAID_ADVERTISING"
    case research = "RESEARCH"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .clinicalUse: "Clinical use"
        case .education: "Education"
        case .website: "Website"
        case .socialMedia: "Social media"
        case .paidAdvertising: "Paid advertising"
        case .research: "Research"
        }
    }
}

public enum ExportState: String, Sendable, Equatable {
    case pending = "PENDING"
    case ready = "READY"
    case failed = "FAILED"
    case revoked = "REVOKED"
}

public struct MediaExportItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let purpose: ExportPurpose?
    public let state: ExportState
    /// SOURCE_CHANGED or RENDER_FAILED when the render produced no file.
    public let failure: String?
    public let widthPx: Int?
    public let heightPx: Int?

    public var failureMessage: String {
        failure == "SOURCE_CHANGED"
            ? "The annotation layer changed before the export was rendered. Export again."
            : "The image could not be rendered. No file was produced."
    }
}

public enum ExportDownloadError: Error, Sendable, Equatable {
    case api(APIError)
    case transfer
}

public actor ExportRepository {
    private let client: Client
    private let transfer = MediaTransfer()

    public init(client: Client) {
        self.client = client
    }

    /// One photo, optionally with one of its annotation layers drawn in.
    public func exportPhoto(patientId: String, photoId: String, purpose: ExportPurpose,
                            annotationId: String?) async throws(APIError) -> MediaExportItem {
        let client = self.client
        let body = Components.Schemas.PhotoExportCreate(purpose: wire(purpose), annotationId: annotationId)
        let created = try await callAPI {
            try await client.createPhotoExport(
                path: .init(patientId: patientId, photoId: photoId),
                headers: .init(idempotencyKey: newIdempotencyKey()),
                body: .json(body)
            ).accepted.body.json.data
        }
        return Self.item(created)
    }

    /// A before/after set side by side, the after photo placed by the set's alignment.
    public func exportSet(patientId: String, setId: String, purpose: ExportPurpose) async throws(APIError) -> MediaExportItem {
        let client = self.client
        let body = Components.Schemas.BeforeAfterExportCreate(purpose: wire(purpose))
        let created = try await callAPI {
            try await client.createBeforeAfterExport(
                path: .init(patientId: patientId, setId: setId),
                headers: .init(idempotencyKey: newIdempotencyKey()),
                body: .json(body)
            ).accepted.body.json.data
        }
        return Self.item(created)
    }

    public func export(patientId: String, exportId: String) async throws(APIError) -> MediaExportItem {
        let client = self.client
        let current = try await callAPI {
            try await client.getExport(path: .init(patientId: patientId, exportId: exportId)).ok.body.json.data
        }
        return Self.item(current)
    }

    /// The ready file; the server re-checks the grant and records PHOTO_VIEWED.
    public func download(patientId: String, exportId: String) async throws(ExportDownloadError) -> Data {
        let client = self.client
        let access: Components.Schemas.ExportAccessUrl
        do throws(APIError) {
            access = try await callAPI {
                try await client.createExportAccessUrl(path: .init(patientId: patientId, exportId: exportId))
                    .created.body.json.data
            }
        } catch {
            throw .api(error)
        }
        guard let url = URL(string: access.url) else { throw .transfer }
        do throws(TransferError) {
            return try await transfer.download(url)
        } catch {
            throw .transfer
        }
    }

    static func item(_ e: Components.Schemas.MediaExport) -> MediaExportItem {
        MediaExportItem(
            id: e.id,
            purpose: ExportPurpose(rawValue: e.purpose.rawValue),
            state: ExportState(rawValue: e.status.rawValue) ?? .pending,
            failure: e.failure?.rawValue,
            widthPx: e.widthPx,
            heightPx: e.heightPx
        )
    }
}
