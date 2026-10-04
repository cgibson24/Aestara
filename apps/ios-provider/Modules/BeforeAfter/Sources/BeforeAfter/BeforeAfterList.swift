// The patient's before/after sets (Bible §4.3, §8; ADR-0026 K3-11, K3-21):
// the profile's Before/After tab, or one consultation's sets in its
// workspace. A new set pairs two photos of the same view, the before one
// captured earlier; the server checks the pairing. Sets are created online.
// Bible §8 · tier: feature · Layer 3.
import CoreNetworking
import DesignSystem
import SwiftUI
import UIKit

public struct BeforeAfterList: View {
    let repository: BeforeAfterRepository
    let sources: ComparisonSources
    let patientId: String
    /// Only this consultation's sets, and new sets made for it.
    let consultationId: String?
    let canCreate: Bool
    let canAlign: Bool
    /// The export sheet of a set, when the role may export.
    let exportSheet: ((BeforeAfterSetItem) -> AnyView)?
    @State private var sets: [BeforeAfterSetItem] = []
    @State private var thumbnails: [String: Data] = [:]
    @State private var state: DSViewState? = .loading("Loading comparisons")
    @State private var creating = false
    @State private var created: BeforeAfterSetItem?
    @State private var opened: BeforeAfterSetItem?
    @State private var reloads = 0

    public init(repository: BeforeAfterRepository, sources: ComparisonSources, patientId: String, consultationId: String? = nil,
                canCreate: Bool, canAlign: Bool, exportSheet: ((BeforeAfterSetItem) -> AnyView)?) {
        self.repository = repository
        self.sources = sources
        self.patientId = patientId
        self.consultationId = consultationId
        self.canCreate = canCreate
        self.canAlign = canAlign
        self.exportSheet = exportSheet
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            if canCreate {
                Button("New comparison", systemImage: "plus") { creating = true }
                    .buttonStyle(DSButtonStyle(.primary))
                    .accessibilityIdentifier("beforeAfter.new")
            }
            if let state {
                DSStateView(state) { reloads += 1 }
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: DSSpacing.md)], spacing: DSSpacing.md) {
                    ForEach(sets) { set in
                        SetTile(set: set, before: thumbnails[set.beforePhotoId], after: thumbnails[set.afterPhotoId]) {
                            opened = set
                        }
                    }
                }
            }
        }
        .task(id: reloads) { await load() }
        .sheet(isPresented: $creating, onDismiss: {
            guard let set = created else { return }
            created = nil
            opened = set
            reloads += 1
        }) {
            NewComparisonSheet(repository: repository, sources: sources, patientId: patientId, consultationId: consultationId) { set in
                created = set
                creating = false
            }
        }
        .fullScreenCover(item: $opened, onDismiss: { reloads += 1 }) { set in
            NavigationStack {
                BeforeAfterScreen(repository: repository, sources: sources, patientId: patientId, set: set,
                                  canAlign: canAlign, exportSheet: exportSheet)
                    .navigationTitle(set.title ?? String(localized: "Before and after"))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close") { opened = nil }
                                .accessibilityIdentifier("beforeAfter.close")
                        }
                    }
            }
        }
    }

    private func load() async {
        if sets.isEmpty { state = .loading("Loading comparisons") }
        do throws(APIError) {
            sets = try await repository.sets(patientId: patientId, consultationId: consultationId)
            state = sets.isEmpty
                ? .empty(title: String(localized: "No comparisons yet"),
                         message: String(localized: "Pair two photos of the same view to compare them."))
                : nil
            let ids = Array(Set(sets.flatMap { [$0.beforePhotoId, $0.afterPhotoId] }).filter { thumbnails[$0] == nil }.prefix(60))
            if !ids.isEmpty {
                let loaded = await sources.images(ids, false)
                thumbnails.merge(loaded) { _, new in new }
            }
        } catch {
            state = error.status == 0 ? .offline
                : error.status == 403 ? .permissionDenied
                : .error(message: error.displayMessage, reference: error.requestId)
        }
    }
}

struct SetTile: View {
    let set: BeforeAfterSetItem
    let before: Data?
    let after: Data?
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                HStack(spacing: DSSpacing.xs) {
                    thumbnail(before, label: String(localized: "Before"))
                    thumbnail(after, label: String(localized: "After"))
                }
                Text(set.title ?? set.viewKey.map(words) ?? String(localized: "Before and after"))
                    .font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                HStack(spacing: DSSpacing.sm) {
                    DSBadge(set.mode.title)
                    Text(set.createdAt, format: .dateTime.day().month().year())
                        .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                }
            }
            .padding(DSSpacing.md)
            .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text("Opens the comparison"))
        .accessibilityIdentifier("beforeAfter.set.\(set.id)")
    }

    private func thumbnail(_ data: Data?, label: String) -> some View {
        ZStack(alignment: .topLeading) {
            DSColor.photoStage
            if let data, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
            }
            DSBadge(label).padding(DSSpacing.xs)
        }
        .aspectRatio(3 / 4, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm))
        .accessibilityHidden(true)
    }
}

/// "LEFT_45" → "Left 45".
func words(_ key: String) -> String {
    key.split(separator: "_").map { $0.lowercased() }.joined(separator: " ").capitalizedFirst
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

/// Choosing the two photos of a new set: first the before photo, then an after photo of the
/// same view captured later. The server checks the pairing again.
struct NewComparisonSheet: View {
    let repository: BeforeAfterRepository
    let sources: ComparisonSources
    let patientId: String
    let consultationId: String?
    let created: (BeforeAfterSetItem) -> Void
    @State private var photos: [ComparisonPhoto] = []
    @State private var thumbnails: [String: Data] = [:]
    @State private var state: DSViewState? = .loading("Loading photos")
    @State private var before: ComparisonPhoto?
    @State private var after: ComparisonPhoto?
    @State private var title = ""
    @State private var busy = false
    @State private var message: String?
    @Environment(\.dismiss) private var dismiss

    private var candidates: [ComparisonPhoto] {
        guard let before else { return photos }
        return photos.filter { $0.id != before.id && $0.viewKey == before.viewKey && $0.capturedAt > before.capturedAt }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let state {
                    DSStateView(state) { Task { await load() } }
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: DSSpacing.lg) {
                            if let message { DSBanner(message, tone: .danger) }
                            Text(before == nil
                                ? String(localized: "Choose the before photo.")
                                : String(localized: "Choose an after photo of the same view, taken later."))
                                .font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                            if before != nil, candidates.isEmpty {
                                DSStateView(.empty(title: String(localized: "No later photo of this view"),
                                                   message: String(localized: "Take a photo of the same view later, then compare them.")))
                            }
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: DSSpacing.sm)], spacing: DSSpacing.sm) {
                                ForEach(candidates) { photo in
                                    choice(photo)
                                }
                            }
                            if before != nil, after != nil {
                                TextField("Title (optional)", text: $title, axis: .vertical)
                                    .lineLimit(1...3)
                                    .padding(DSSpacing.sm)
                                    .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.sm))
                                    .overlay(RoundedRectangle(cornerRadius: DSRadius.sm).stroke(DSColor.controlBorder))
                                    .accessibilityIdentifier("beforeAfter.title")
                            }
                        }
                        .padding(DSSpacing.lg)
                    }
                }
            }
            .navigationTitle("New comparison")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if before != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Back") {
                            before = nil
                            after = nil
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { Task { await create() } }
                        .disabled(before == nil || after == nil || busy || trimmedTitle.count > 120)
                        .accessibilityIdentifier("beforeAfter.create")
                }
            }
        }
        .task { await load() }
    }

    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func choice(_ photo: ComparisonPhoto) -> some View {
        let chosen = after?.id == photo.id
        return Button {
            if before == nil { before = photo } else { after = photo }
        } label: {
            VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                ZStack {
                    DSColor.photoStage
                    if let data = thumbnails[photo.id], let image = UIImage(data: data) {
                        Image(uiImage: image).resizable().scaledToFill()
                    }
                }
                .aspectRatio(3 / 4, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm))
                .overlay(RoundedRectangle(cornerRadius: DSRadius.sm).stroke(chosen ? DSColor.accent : .clear, lineWidth: DSSpacing.xs))
                Text(photo.viewKey.map(words) ?? String(localized: "Photo")).font(DSFont.subheadline).foregroundStyle(DSColor.textPrimary)
                Text(photo.capturedAt, format: .dateTime.day().month().year())
                    .font(DSFont.caption1).foregroundStyle(DSColor.textSecondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(chosen ? .isSelected : [])
        .accessibilityIdentifier("beforeAfter.photo.\(photo.viewKey ?? photo.id)")
    }

    private func load() async {
        photos = await sources.photos().sorted { $0.capturedAt < $1.capturedAt }
        state = photos.count < 2
            ? .empty(title: String(localized: "Not enough photos"), message: String(localized: "A comparison needs two accepted photos of the same view."))
            : nil
        let ids = Array(photos.map(\.id).prefix(60))
        thumbnails = await sources.images(ids, false)
    }

    private func create() async {
        guard let before, let after else { return }
        busy = true
        defer { busy = false }
        do throws(APIError) {
            let set = try await repository.create(patientId: patientId, beforePhotoId: before.id, afterPhotoId: after.id,
                                                  consultationId: consultationId, title: trimmedTitle.isEmpty ? nil : trimmedTitle)
            created(set)
        } catch {
            message = error.status == 0 ? String(localized: "Creating a comparison needs a connection.") : error.displayMessage
        }
    }
}
