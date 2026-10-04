// The workspace's Annotate and Before/after steps (Bible §5.1; ADR-0026
// K3-10 to K3-15, K3-21; ADR-0027). Annotate lists the consultation's
// accepted photos, or offline the photos saved on this device, and opens one
// with its layers over its display preview. Before/after lists the
// consultation's comparisons. Exports start from either, when the role may
// export; the server checks every grant.
// Bible §5.1, §6.6, §8 · tier: app · Layer 3.
import Annotations
import BeforeAfter
import CoreNetworking
import DesignSystem
import Media
import Photography
import SwiftUI
import UIKit

struct AnnotateStep: View {
    let model: WorkspaceModel
    @State private var photos: [PhotoItem] = []
    @State private var thumbnails: [String: Data] = [:]
    @State private var state: DSViewState? = .loading("Loading photos")
    @State private var offline = false
    @State private var opened: PhotoItem?

    private var work: ConsultationWork { model.work }

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            Text("Draw over a photo to explain it to the patient. Annotations are visual notes, never measurements, and the original photo never changes.")
                .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            if offline {
                DSBanner(String(localized: "You are offline. These are the photos saved on this device."), tone: .info)
            }
            if let state {
                DSStateView(state) { Task { await load() } }
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: DSSpacing.md)], spacing: DSSpacing.md) {
                    ForEach(photos) { photo in
                        Button { opened = photo } label: {
                            PhotoTile(photo: photo, image: thumbnails[photo.id])
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(Text("Opens the photo's annotations"))
                        .accessibilityIdentifier("annotate.photo.\(photo.viewKey ?? photo.id)")
                    }
                }
            }
        }
        .task { await load() }
        .fullScreenCover(item: $opened) { photo in
            AnnotatePhotoScreen(work: work, patientId: model.patient.id, photo: photo)
        }
    }

    private func load() async {
        let patientId = model.patient.id
        let repository = work.photography.repository
        do throws(APIError) {
            let sessions = try await repository.sessions(patientId: patientId, consultationId: model.consultation.id)
            let ids = Set(sessions.map(\.id))
            let all = try await repository.photos(patientId: patientId)
            work.photography.reachedServer()
            photos = all.filter { photo in
                photo.status == "ACCEPTED" && photo.sessionId.map { ids.contains($0) } == true
            }
            offline = false
        } catch {
            work.photography.note(error)
            guard error.status == 0 else {
                state = error.viewState
                return
            }
            offline = true
            photos = work.photography.cachedPhotos(patientId: patientId).filter { $0.status == "ACCEPTED" }
        }
        state = photos.isEmpty
            ? .empty(title: String(localized: "No photos to annotate"),
                     message: String(localized: "Photos taken in this consultation appear here once they are accepted."))
            : nil
        let missing = photos.map(\.id).filter { thumbnails[$0] == nil }
        if !missing.isEmpty {
            let loaded = await work.photography.derivatives(patientId: patientId, photoIds: missing, variant: .thumbnail)
            thumbnails.merge(loaded) { _, new in new }
        }
    }
}

/// One photo and its annotation layers, full screen, with the way into an export.
struct AnnotatePhotoScreen: View {
    let work: ConsultationWork
    let patientId: String
    let photo: PhotoItem
    @State private var workbench: AnnotationWorkbench
    @State private var image: UIImage?
    @State private var state: DSViewState? = .loading("Loading the photo")
    @State private var exporting: ExportTarget?
    @Environment(\.dismiss) private var dismiss

    init(work: ConsultationWork, patientId: String, photo: PhotoItem) {
        self.work = work
        self.patientId = patientId
        self.photo = photo
        _workbench = State(initialValue: work.annotationWorkbench(patientId: patientId, photoId: photo.id))
    }

    var body: some View {
        NavigationStack {
            Group {
                if let state {
                    DSStateView(state) { Task { await load() } }
                } else if let image {
                    AnnotationScreen(workbench: workbench, image: image)
                }
            }
            .background(DSColor.canvas)
            .navigationTitle(photo.viewKey.map(viewTitle) ?? String(localized: "Photo"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .accessibilityIdentifier("annotate.close")
                }
                if work.can("photo.export") {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Export", systemImage: "square.and.arrow.up") {
                            exporting = .photo(photo, layers: workbench.layers.filter { $0.version > 0 })
                        }
                        .accessibilityIdentifier("annotate.export")
                    }
                }
            }
        }
        .task { await load() }
        .sheet(item: $exporting) { target in
            ExportSheet(work: work, patientId: patientId, target: target)
        }
    }

    private func load() async {
        let loaded = await work.photography.derivatives(patientId: patientId, photoIds: [photo.id], variant: .displayPreview)
        guard let data = loaded[photo.id], let preview = UIImage(data: data) else {
            state = .error(message: String(localized: "The photo could not be shown. Offline, only photos saved on this device open."),
                           reference: nil)
            return
        }
        image = preview
        state = nil
    }
}

/// "LEFT_45" → "Left 45".
func viewTitle(_ key: String) -> String {
    let text = key.split(separator: "_").map { $0.lowercased() }.joined(separator: " ")
    return text.prefix(1).uppercased() + text.dropFirst()
}

struct BeforeAfterStep: View {
    let model: WorkspaceModel

    var body: some View {
        ComparisonList(work: model.work, patientId: model.patient.id, consultationId: model.consultation.id)
    }
}

/// The comparisons of a patient (profile tab) or of a consultation (workspace step).
struct ComparisonList: View {
    let work: ConsultationWork
    let patientId: String
    let consultationId: String?

    var body: some View {
        BeforeAfterList(
            repository: work.comparisons,
            sources: work.comparisonSources(patientId: patientId),
            patientId: patientId,
            consultationId: consultationId,
            canCreate: work.can("photo.view"),
            canAlign: work.can("photo.annotate"),
            exportSheet: exportSheet
        )
    }

    private var exportSheet: ((BeforeAfterSetItem) -> AnyView)? {
        guard work.can("photo.export") else { return nil }
        let work = self.work
        let patientId = self.patientId
        return { set in
            AnyView(ExportSheet(work: work, patientId: patientId,
                                target: .comparison(setId: set.id, photoIds: [set.beforePhotoId, set.afterPhotoId])))
        }
    }
}
