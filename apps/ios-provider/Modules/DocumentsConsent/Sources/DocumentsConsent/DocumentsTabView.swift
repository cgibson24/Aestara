// The patient profile's Documents tab (Bible §4.3, §12; ADR-0026 K3-16, K3-21):
// uploaded PDFs and consultation summaries with their versions. A version is
// opened from the server each time (the server records DOCUMENT_VIEWED) in a
// preview, from a temporary file deleted when the preview closes; documents
// are never kept on the device. Uploading needs document.manage; the server
// decides. Consent documents arrive with Layer 4.
// Bible §12 · tier: feature · Layer 3.
import CoreNetworking
import DesignSystem
import QuickLook
import SwiftUI
import UniformTypeIdentifiers

public struct DocumentsTabView: View {
    let repository: DocumentsRepository
    let patientId: String
    let canManage: Bool
    /// Only one consultation's documents (the workspace's summary step), or all.
    let consultationId: String?
    @State private var documents: [DocumentItem] = []
    @State private var loadState: DSViewState? = .loading("Loading documents")
    @State private var preview: URL?
    @State private var opening: String?
    @State private var importing = false
    @State private var pending: PendingUpload?
    @State private var message: String?
    @State private var reloads = 0

    public init(repository: DocumentsRepository, patientId: String, canManage: Bool, consultationId: String? = nil) {
        self.repository = repository
        self.patientId = patientId
        self.canManage = canManage
        self.consultationId = consultationId
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            if canManage, consultationId == nil {
                Button("Upload a PDF", systemImage: "square.and.arrow.up") { importing = true }
                    .buttonStyle(DSButtonStyle(.secondary))
                    .accessibilityIdentifier("documents.upload")
            }
            if let message { DSBanner(message, tone: .danger) }
            if let loadState {
                DSStateView(loadState) { reloads += 1 }
            } else {
                ForEach(documents) { document in
                    DocumentRow(document: document, opening: opening == document.id) {
                        Task { await open(document) }
                    }
                }
            }
        }
        .task(id: reloads) { await load() }
        .quickLookPreview($preview)
        .onChange(of: preview) { old, new in
            // The preview closed: its file goes at once.
            if let old, new == nil { try? FileManager.default.removeItem(at: old) }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf]) { result in
            guard case let .success(url) = result else { return }
            pending = PendingUpload(url: url, title: url.deletingPathExtension().lastPathComponent)
        }
        .sheet(item: $pending) { upload in
            UploadDocumentSheet(upload: upload, documents: documents.filter(\.isUploaded)) { title, documentId in
                pending = nil
                Task { await send(upload, title: title, documentId: documentId) }
            } cancel: {
                pending = nil
            }
        }
    }

    private func load() async {
        if documents.isEmpty { loadState = .loading("Loading documents") }
        do throws(APIError) {
            documents = try await repository.documents(patientId: patientId, consultationId: consultationId)
            loadState = documents.isEmpty
                ? .empty(title: "No documents", message: consultationId == nil
                    ? "Uploaded documents and consultation summaries appear here."
                    : "The summary appears here once it is generated.")
                : nil
        } catch {
            // Documents are not kept on the device: offline there is nothing to show.
            loadState = error.status == 0 ? .offline
                : error.status == 403 ? .permissionDenied
                : .error(message: error.displayMessage, reference: error.requestId)
        }
    }

    private func open(_ document: DocumentItem) async {
        guard let version = document.latestAvailable else {
            message = document.versions.first?.state == .rejected
                ? String(localized: "This document was blocked by the malware scan and cannot be opened.")
                : String(localized: "This document is still being checked. Try again shortly.")
            return
        }
        opening = document.id
        defer { opening = nil }
        do throws(APIError) {
            let data = try await repository.download(patientId: patientId, documentId: document.id, versionId: version.id)
            let url = FileManager.default.temporaryDirectory
                .appending(path: "document-\(UUID().uuidString.lowercased())")
                .appendingPathExtension("pdf")
            try? data.write(to: url, options: [.completeFileProtection])
            message = nil
            preview = url
        } catch {
            message = error.displayMessage
        }
    }

    private func send(_ upload: PendingUpload, title: String, documentId: String?) async {
        let accessed = upload.url.startAccessingSecurityScopedResource()
        defer { if accessed { upload.url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: upload.url) else {
            message = String(localized: "The file could not be read.")
            return
        }
        do throws(DocumentUploadError) {
            _ = try await repository.upload(patientId: patientId, data: data, title: documentId == nil ? title : nil,
                                            documentId: documentId)
            message = nil
            reloads += 1
        } catch {
            message = switch error {
            case .tooLarge: String(localized: "The file is larger than 50 MB.")
            case .notPDF: String(localized: "Only PDF files can be uploaded.")
            case .transfer: String(localized: "The upload did not finish. Check the connection and try again.")
            case let .api(apiError): apiError.displayMessage
            }
        }
    }
}

struct PendingUpload: Identifiable {
    let url: URL
    let title: String
    var id: URL { url }
}

struct DocumentRow: View {
    let document: DocumentItem
    let opening: Bool
    let open: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Button(action: open) {
            HStack(spacing: DSSpacing.md) {
                Image(systemName: document.isSummary ? "doc.text" : "doc")
                    .font(DSFont.title3)
                    .foregroundStyle(DSColor.accent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                    Text(document.title).font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                    // Side by side, or stacked at accessibility sizes so nothing is squeezed.
                    let details = typeSize.isAccessibilitySize
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: DSSpacing.xs))
                        : AnyLayout(HStackLayout(spacing: DSSpacing.sm))
                    details {
                        DSBadge(document.typeTitle)
                        if let latest = document.versions.first {
                            Text("Version \(latest.versionNumber)")
                            if latest.state != .available { DSBadge(latest.state.title, color: DSColor.warning, background: DSColor.warningSoft) }
                        }
                    }
                    .font(DSFont.footnote)
                    .foregroundStyle(DSColor.textSecondary)
                    Text(document.updatedAt, format: .dateTime.day().month().year())
                        .font(DSFont.footnote)
                        .foregroundStyle(DSColor.textSecondary)
                }
                Spacer()
                if opening { ProgressView() }
            }
            .padding(DSSpacing.md)
            .frame(minHeight: DSSize.touchTarget)
            .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("documents.row.\(document.id)")
        .accessibilityHint(Text("Opens the document"))
    }
}

/// Names a new upload, or adds it as a new version of an uploaded document.
struct UploadDocumentSheet: View {
    let upload: PendingUpload
    let documents: [DocumentItem]
    let send: (String, String?) -> Void
    let cancel: () -> Void
    @State private var title: String
    @State private var versionOf: String?

    init(upload: PendingUpload, documents: [DocumentItem], send: @escaping (String, String?) -> Void,
         cancel: @escaping () -> Void) {
        self.upload = upload
        self.documents = documents
        self.send = send
        self.cancel = cancel
        _title = State(initialValue: upload.title)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Add as", selection: $versionOf) {
                        Text("A new document").tag(String?.none)
                        ForEach(documents) { document in
                            Text("New version of \(document.title)").tag(Optional(document.id))
                        }
                    }
                    .accessibilityIdentifier("documents.uploadTarget")
                }
                if versionOf == nil {
                    Section("Title") {
                        TextField("Title", text: $title)
                            .accessibilityIdentifier("documents.title")
                    }
                }
            }
            .navigationTitle("Upload PDF")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Upload") { send(title.trimmingCharacters(in: .whitespacesAndNewlines), versionOf) }
                        .disabled(versionOf == nil && title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("documents.send")
                }
            }
        }
    }
}
