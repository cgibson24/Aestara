// Exporting a photo or a before/after set (Bible §7.3, §8.3, §22.4;
// ADR-0026 K3-14, K3-15; ADR-0027): one purpose at a time, under the
// patient's current grant for it, which the server checks on every photo
// shown. Purposes the patient has not granted are marked and cannot be
// chosen; the server decides. Exports need a second factor in the last 15
// minutes: when the server asks, the user confirms it is them. The export is
// followed until it is ready, failed or revoked; a ready file goes to the
// share sheet from a temporary file that is deleted when the sheet closes.
// Bible §7.3, §8.3 · tier: app · Layer 3.
import Annotations
import Authentication
import CoreNetworking
import DesignSystem
import Media
import Photography
import SwiftUI
import UIKit

/// What is exported: a photo with the layers that may be drawn in, or a set with its two photos.
enum ExportTarget: Identifiable {
    case photo(PhotoItem, layers: [AnnotationLayerItem])
    case comparison(setId: String, photoIds: [String])

    var id: String {
        switch self {
        case let .photo(photo, _): "photo.\(photo.id)"
        case let .comparison(setId, _): "set.\(setId)"
        }
    }
}

struct ExportSheet: View {
    let work: ConsultationWork
    let patientId: String
    let target: ExportTarget
    @State private var purpose: ExportPurpose?
    @State private var layerId: String?
    @State private var granted: Set<ExportPurpose>?
    @State private var export: MediaExportItem?
    @State private var message: String?
    @State private var busy = false
    @State private var confirming = false
    @State private var shared: SharedFile?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if let message {
                    Section { DSBanner(message, tone: .danger) }
                }
                Section {
                    ForEach(ExportPurpose.allCases) { item in
                        purposeRow(item)
                    }
                } header: {
                    Text("Purpose")
                } footer: {
                    Text("Each purpose needs the patient's current permission for it. The export is a new image with no names, dates or other details; the original photo never changes.")
                }
                if case let .photo(_, layers) = target, !layers.isEmpty {
                    Section("Annotations") {
                        Picker("Draw in", selection: $layerId) {
                            Text("No annotations").tag(String?.none)
                            ForEach(layers) { layer in
                                Text(layer.label ?? String(localized: "Layer of \(layer.updatedAt.formatted(date: .abbreviated, time: .shortened))"))
                                    .tag(Optional(layer.id))
                            }
                        }
                        .accessibilityIdentifier("export.layer")
                    }
                }
                if let export {
                    Section("Export") { status(export) }
                }
            }
            .navigationTitle("Export")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .accessibilityIdentifier("export.close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Export") { Task { await start() } }
                        .disabled(purpose == nil || busy || export?.state == .pending)
                        .accessibilityIdentifier("export.start")
                }
            }
        }
        .task { await loadGrants() }
        .sheet(isPresented: $confirming) {
            ConfirmIdentityView(store: work.auth, reason: String(localized: "Exports need you to confirm it's you. Sign in again to continue.")) {
                confirming = false
                Task { await start() }
            }
        }
        .sheet(item: $shared, onDismiss: removeShared) { file in
            ShareSheet(url: file.url) { removeShared() }
        }
    }

    private func purposeRow(_ item: ExportPurpose) -> some View {
        let allowed = granted?.contains(item) ?? true
        return Button {
            purpose = item
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                    Text(item.title).font(DSFont.body).foregroundStyle(allowed ? DSColor.textPrimary : DSColor.textTertiary)
                    if !allowed {
                        Text("Not permitted by the patient").font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                    }
                }
                Spacer()
                if purpose == item {
                    Image(systemName: "checkmark").foregroundStyle(DSColor.accent).accessibilityHidden(true)
                }
            }
            .frame(minHeight: DSSize.touchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!allowed)
        .accessibilityAddTraits(purpose == item ? .isSelected : [])
        .accessibilityIdentifier("export.purpose.\(item.rawValue)")
    }

    @ViewBuilder private func status(_ export: MediaExportItem) -> some View {
        switch export.state {
        case .pending:
            HStack(spacing: DSSpacing.sm) {
                ProgressView()
                Text("Preparing the image").font(DSFont.body).foregroundStyle(DSColor.textSecondary)
            }
            .accessibilityIdentifier("export.pending")
        case .ready:
            Button("Share", systemImage: "square.and.arrow.up") { Task { await share(export) } }
                .disabled(busy)
                .accessibilityIdentifier("export.share")
        case .failed:
            Text(export.failureMessage).font(DSFont.body).foregroundStyle(DSColor.danger)
                .accessibilityIdentifier("export.failed")
        case .revoked:
            Text("This export is no longer available: the patient's permission for it ended.")
                .font(DSFont.body).foregroundStyle(DSColor.textSecondary)
        }
    }

    /// The purposes the patient has granted for every photo shown; unknown without permission to read them.
    private func loadGrants() async {
        guard work.can("photo.permission.read") else { return }
        let repository = work.photography.repository
        do throws(APIError) {
            var photos: [PhotoItem] = []
            switch target {
            case let .photo(photo, _):
                photos = [photo]
            case let .comparison(_, photoIds):
                for photoId in photoIds { photos.append(try await repository.photo(patientId: patientId, photoId: photoId)) }
            }
            let states = try await repository.permissions(patientId: patientId)
            var allowed: Set<ExportPurpose> = []
            for item in ExportPurpose.allCases {
                guard let state = states.first(where: { $0.category.rawValue == item.rawValue }) else { continue }
                let all = photos.allSatisfy { state.effectiveState(forPhoto: $0.id, sessionId: $0.sessionId) == "GRANTED" }
                if all { allowed.insert(item) }
            }
            granted = allowed
        } catch {
            granted = nil
        }
    }

    private func start() async {
        guard let purpose else { return }
        busy = true
        defer { busy = false }
        do throws(APIError) {
            switch target {
            case let .photo(photo, _):
                export = try await work.exports.exportPhoto(patientId: patientId, photoId: photo.id, purpose: purpose, annotationId: layerId)
            case let .comparison(setId, _):
                export = try await work.exports.exportSet(patientId: patientId, setId: setId, purpose: purpose)
            }
            message = nil
            await follow()
        } catch {
            handle(error)
        }
    }

    /// Follows the render until it ends; nothing runs unseen in the background.
    private func follow() async {
        for _ in 0..<90 {
            guard let current = export, current.state == .pending else { return }
            try? await Task.sleep(for: .seconds(2))
            if Task.isCancelled { return }
            do throws(APIError) {
                export = try await work.exports.export(patientId: patientId, exportId: current.id)
            } catch {
                handle(error)
                return
            }
        }
    }

    private func share(_ ready: MediaExportItem) async {
        busy = true
        defer { busy = false }
        do throws(ExportDownloadError) {
            let data = try await work.exports.download(patientId: patientId, exportId: ready.id)
            let url = FileManager.default.temporaryDirectory
                .appending(path: "export-\(UUID().uuidString.lowercased())")
                .appendingPathExtension("jpg")
            try? data.write(to: url, options: [.completeFileProtection])
            shared = SharedFile(url: url)
        } catch {
            switch error {
            case let .api(apiError): handle(apiError)
            case .transfer: message = String(localized: "The file did not download. Check the connection and try again.")
            }
        }
    }

    private func handle(_ error: APIError) {
        if error.code == "REAUTHENTICATION_REQUIRED" {
            confirming = true
            return
        }
        message = error.status == 0 ? String(localized: "Exporting needs a connection.") : error.displayMessage
    }

    /// The shared file goes as soon as the share sheet closes.
    private func removeShared() {
        if let url = shared?.url { try? FileManager.default.removeItem(at: url) }
        shared = nil
    }
}

struct SharedFile: Identifiable {
    let url: URL
    var id: URL { url }
}

/// The system share sheet for one file; `finished` runs when it closes.
struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    let finished: () -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, _ in finished() }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
