// Clinical documents through the generated client (spec §6.3 "Documents";
// ADR-0026 K3-16, K3-17). Uploads are PDFs of at most 50 MiB, sent through a
// write-once presigned PUT that carries their SHA-256, then verified and
// scanned by the server before any version is served. Downloads are signed
// URLs valid 10 minutes; each one is audited by the server. Documents are not
// kept on the device. Generated types end here (ADR-0022).
// Bible §12, §14.4 · tier: feature · Layer 3.
import CoreNetworking
import Foundation
import Media

public enum DocumentVersionState: String, Sendable, Equatable {
    case scanning = "SCANNING"
    case available = "AVAILABLE"
    case rejected = "REJECTED"

    public var title: String {
        switch self {
        case .scanning: "Being checked"
        case .available: "Available"
        case .rejected: "Blocked by the malware scan"
        }
    }
}

public struct DocumentVersionItem: Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    public let versionNumber: Int
    public let state: DocumentVersionState
    public let byteSize: Int?
    public let changeNote: String?
    public let createdAt: Date
}

public struct DocumentItem: Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    public let type: String
    public let title: String
    public let consultationId: String?
    public let updatedAt: Date
    /// Newest first.
    public let versions: [DocumentVersionItem]

    public var isSummary: Bool { type == "CONSULTATION_SUMMARY" }
    public var isUploaded: Bool { type == "UPLOADED_CLINICAL" }
    public var latestAvailable: DocumentVersionItem? { versions.first { $0.state == .available } }

    public var typeTitle: String {
        switch type {
        case "CONSULTATION_SUMMARY": "Consultation summary"
        case "UPLOADED_CLINICAL": "Uploaded document"
        default: "Document"
        }
    }
}

/// The only upload type (K3-16).
enum DocumentContentType: String {
    case pdf = "application/pdf"
}

public enum DocumentLimits {
    public static let maxBytes = 50 * 1024 * 1024
}

public enum DocumentUploadError: Error, Sendable, Equatable {
    case tooLarge
    case notPDF
    case api(APIError)
    case transfer
}

public actor DocumentsRepository {
    private let client: Client
    private let transfer = MediaTransfer()

    public init(client: Client) {
        self.client = client
    }

    public func documents(patientId: String, consultationId: String? = nil) async throws(APIError) -> [DocumentItem] {
        let client = self.client
        let page = try await callAPI {
            try await client.listDocuments(path: .init(patientId: patientId), query: .init(limit: 100, consultationId: consultationId))
                .ok.body.json
        }
        return page.data.map(Self.document)
    }

    /// Uploads a PDF as a new document (with a title) or as the next version of one (K3-16).
    public func upload(patientId: String, data: Data, title: String?, documentId: String?,
                       consultationId: String? = nil, changeNote: String? = nil) async throws(DocumentUploadError) -> DocumentItem {
        guard data.count <= DocumentLimits.maxBytes else { throw .tooLarge }
        guard data.starts(with: Array("%PDF-".utf8)) else { throw .notPDF }
        let client = self.client
        let request = Components.Schemas.DocumentUploadRequest(
            documentId: documentId,
            title: title,
            consultationId: consultationId,
            contentType: wire(DocumentContentType.pdf),
            byteSize: data.count,
            sha256: sha256Hex(data)
        )
        let intent: Components.Schemas.DocumentUploadIntent
        do throws(APIError) {
            intent = try await callAPI {
                try await client.createDocumentUpload(
                    path: .init(patientId: patientId),
                    headers: .init(idempotencyKey: newIdempotencyKey()),
                    body: .json(request)
                ).created.body.json.data
            }
        } catch {
            throw .api(error)
        }
        if let upload = intent.upload, let url = URL(string: upload.url) {
            do throws(TransferError) {
                try await transfer.upload(data, to: url, headers: upload.headers.additionalProperties)
            } catch {
                throw .transfer
            }
        }
        do throws(APIError) {
            let document = try await callAPI {
                try await client.completeDocumentUpload(
                    path: .init(patientId: patientId, documentId: intent.documentId),
                    headers: .init(idempotencyKey: newIdempotencyKey()),
                    body: .json(.init(uploadId: intent.uploadId, changeNote: changeNote))
                ).ok.body.json.data
            }
            return Self.document(document)
        } catch {
            throw .api(error)
        }
    }

    /// Downloads a version (default: the newest available); the server records DOCUMENT_VIEWED.
    public func download(patientId: String, documentId: String, versionId: String? = nil) async throws(APIError) -> Data {
        let client = self.client
        let access = try await callAPI {
            try await client.createDocumentAccessUrl(
                path: .init(patientId: patientId, documentId: documentId),
                body: .json(.init(versionId: versionId))
            ).created.body.json.data
        }
        guard let url = URL(string: access.url) else { throw APIError.unexpected }
        do throws(TransferError) {
            return try await transfer.download(url)
        } catch {
            throw error == .offline ? APIError.offline : APIError.unexpected
        }
    }

    static func document(_ d: Components.Schemas.Document) -> DocumentItem {
        DocumentItem(
            id: d.id,
            type: d._type.rawValue,
            title: d.title,
            consultationId: d.consultationId,
            updatedAt: d.updatedAt,
            versions: d.versions.map { v in
                DocumentVersionItem(
                    id: v.id,
                    versionNumber: v.versionNumber,
                    state: DocumentVersionState(rawValue: v.status.rawValue) ?? .scanning,
                    byteSize: v.byteSize,
                    changeNote: v.changeNote,
                    createdAt: v.createdAt
                )
            }
        )
    }
}
