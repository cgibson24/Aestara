// One photo (Bible §6.6, §7; spec §6.3; ADR-0023 K2-14, K2-15): its display
// preview, tags, archiving, its media permissions with photo exceptions, and
// its releases. A photo being checked or rejected shows its state in words,
// never an image. Archiving keeps the original and cannot be undone; a
// release is confirmed on its own sheet (DESIGN_SYSTEM.md C11).
// Bible §6, §7 · tier: feature · Layer 2.
import CoreNetworking
import DesignSystem
import SwiftUI
import UIKit

struct PhotoDetailView: View {
    let context: PhotographyContext
    let patientId: String
    @State private var photo: PhotoItem
    @State private var preview: Data?
    @State private var permissions: [PermissionCategoryState] = []
    @State private var releases: [MediaReleaseItem] = []
    @State private var tagDraft = ""
    @State private var editingPermission: PermissionCategoryState?
    @State private var releasing: PermissionCategory?
    @State private var revoking: MediaReleaseItem?
    @State private var confirmingArchive = false
    @State private var busy = false
    @State private var message: String?
    @Environment(\.dismiss) private var dismiss

    init(context: PhotographyContext, patientId: String, photo: PhotoItem) {
        self.context = context
        self.patientId = patientId
        _photo = State(initialValue: photo)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.xl) {
                    image
                    if let message { DSBanner(message, tone: .danger) }
                    details
                    if photo.isViewable { tags }
                    if photo.isViewable, context.can("photo.permission.read") { permissionSection }
                    if photo.isViewable { releaseSection }
                    if photo.status == "ACCEPTED", context.can("photo.capture") {
                        Button("Archive photo", role: .destructive) { confirmingArchive = true }
                            .buttonStyle(DSButtonStyle(.destructive))
                            .accessibilityIdentifier("photo.archive")
                    }
                }
                .padding(DSSpacing.lg)
            }
            .background(DSColor.canvas)
            .navigationTitle(photo.viewKey.map(words) ?? String(localized: "Photo"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .confirmationDialog("Archive this photo?", isPresented: $confirmingArchive, titleVisibility: .visible) {
                Button("Archive", role: .destructive) { Task { await archive() } }
                    .accessibilityIdentifier("photo.archiveConfirm")
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("It is hidden from the gallery and cannot be released or used in new work. The original is kept. Archiving cannot be undone.")
            }
        }
        .task { await load() }
        .sheet(item: $editingPermission, onDismiss: { Task { await loadPermissions() } }) { item in
            PermissionChangeSheet(context: context, patientId: patientId, category: item.category,
                                  currentState: item.photoRow(photo.id)?.effectiveState() ?? "NOT_REQUESTED", photoId: photo.id)
        }
        .sheet(item: $releasing, onDismiss: { Task { await loadReleases() } }) { purpose in
            ReleaseSheet(context: context, patientId: patientId, photoId: photo.id, purpose: purpose)
        }
        .sheet(item: $revoking, onDismiss: { Task { await loadReleases() } }) { release in
            RevokeReleaseSheet(context: context, patientId: patientId, release: release)
        }
    }

    // MARK: Sections

    private var image: some View {
        ZStack {
            DSColor.photoStage
            if let preview, let uiImage = UIImage(data: preview) {
                Image(uiImage: uiImage).resizable().scaledToFit()
                    .accessibilityLabel(String(localized: "Clinical photo: \(photo.viewKey.map(words) ?? "")"))
            } else {
                Text(stateText).font(DSFont.body).foregroundStyle(DSColor.photoStageText)
                    .multilineTextAlignment(.center).padding(DSSpacing.lg)
                    .accessibilityIdentifier("photo.state")
            }
        }
        .aspectRatio(3.0 / 4.0, contentMode: .fit)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: DSRadius.md))
    }

    private var stateText: String {
        if photo.isRejected {
            return String(localized: "This photo could not be checked and is not shown. Retake it, or upload the original kept on the capturing device again.")
        }
        if !photo.isViewable { return String(localized: "Being checked") }
        switch photo.preview {
        case .failed: return String(localized: "Preview unavailable")
        case .pending: return String(localized: "Preparing preview")
        case .available: return String(localized: "Loading preview")
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            HStack(spacing: DSSpacing.sm) {
                Text(photo.capturedAt.formatted(date: .long, time: .shortened)).font(DSFont.headline)
                if photo.isArchived { DSBadge(String(localized: "Archived")) }
            }
            if let reason = photo.rejectionReason {
                Text(String(localized: "Reason: \(words(reason))")).font(DSFont.footnote).foregroundStyle(DSColor.danger)
            }
            if let score = photo.positionMatchScore {
                Text(String(localized: "Position match \(score.formatted(.percent.precision(.fractionLength(0)))): \(PositionMatch.words(score))"))
                    .font(DSFont.subheadline)
                Text(PositionMatch.label).font(DSFont.caption1).foregroundStyle(DSColor.textSecondary)
            }
        }
        .foregroundStyle(DSColor.textPrimary)
        .accessibilityElement(children: .combine)
    }

    private var canTag: Bool { context.can("photo.annotate") && !photo.isArchived }

    private var tags: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text("Tags").font(DSFont.title3)
            if photo.tags.isEmpty {
                Text("No tags").font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            } else {
                FlowTags(tags: photo.tags, removable: canTag && !busy) { tag in
                    Task { await saveTags(photo.tags.filter { $0 != tag }) }
                }
            }
            if canTag {
                HStack(spacing: DSSpacing.sm) {
                    DSTextField(String(localized: "New tag"), text: $tagDraft, error: tagError)
                        .accessibilityIdentifier("photo.tagField")
                    Button("Add") { Task { await addTag() } }
                        .buttonStyle(DSButtonStyle(.secondary))
                        .frame(maxWidth: 100)
                        .disabled(normalizedDraft.isEmpty || tagError != nil || busy)
                        .accessibilityIdentifier("photo.addTag")
                }
            }
        }
    }

    /// Trimmed and lower-cased, as the server stores them (K2-14).
    private var normalizedDraft: String { tagDraft.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

    private var tagError: String? {
        if normalizedDraft.count > 40 { return String(localized: "A tag can have at most 40 characters.") }
        if photo.tags.count >= 20, !normalizedDraft.isEmpty { return String(localized: "A photo can have at most 20 tags.") }
        return nil
    }

    private var permissionSection: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text("Media permissions for this photo").font(DSFont.title3)
            if permissions.isEmpty {
                Text("Loading").font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            }
            ForEach(permissions) { item in
                let state = item.effectiveState(forPhoto: photo.id, sessionId: photo.sessionId)
                Button {
                    editingPermission = item
                } label: {
                    HStack(spacing: DSSpacing.md) {
                        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                            Text(item.category.title).font(DSFont.subheadline).foregroundStyle(DSColor.textPrimary)
                            if item.photoRow(photo.id) != nil {
                                Text("Exception for this photo").font(DSFont.caption1).foregroundStyle(DSColor.textSecondary)
                            }
                        }
                        Spacer()
                        PermissionStateBadge(state: state)
                    }
                    .frame(minHeight: DSSize.touchTarget)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!context.can("photo.permission.manage") || photo.isArchived)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("photo.permission.\(item.category.rawValue)")
            }
        }
    }

    /// The outward purposes a photo is released for. Clinical use needs no release, and AI
    /// datasets are built from grants plus a governance approval (spec §7.7), not from releases.
    static let releasePurposes: [PermissionCategory] = [.patientApp, .education, .website, .socialMedia, .paidAdvertising, .research]

    private func canRelease(_ purpose: PermissionCategory) -> Bool {
        context.can(purpose == .patientApp ? "consultation.complete" : "photo.export")
    }

    /// Purposes with a current grant for this photo and no active release yet.
    private var releasable: [PermissionCategory] {
        guard photo.status == "ACCEPTED" else { return [] }
        return Self.releasePurposes.filter { purpose in
            canRelease(purpose)
                && permissions.first { $0.category == purpose }?.effectiveState(forPhoto: photo.id, sessionId: photo.sessionId) == "GRANTED"
                && !releases.contains { $0.purpose == purpose && $0.isActive }
        }
    }

    @ViewBuilder private var releaseSection: some View {
        let mine = releases
        if !mine.isEmpty || !releasable.isEmpty {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                Text("Releases").font(DSFont.title3)
                ForEach(mine) { release in
                    HStack(spacing: DSSpacing.md) {
                        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                            Text(release.purpose.title).font(DSFont.subheadline)
                            Text(releaseDetail(release)).font(DSFont.caption1).foregroundStyle(DSColor.textSecondary)
                        }
                        Spacer()
                        if release.isActive {
                            DSBadge(String(localized: "Active"), color: DSColor.success, background: DSColor.successSoft)
                            if canRelease(release.purpose) {
                                Button("Revoke") { revoking = release }
                                    .buttonStyle(DSButtonStyle(.secondary))
                                    .frame(maxWidth: 120)
                                    .accessibilityIdentifier("photo.revoke.\(release.purpose.rawValue)")
                            }
                        } else {
                            DSBadge(String(localized: "Revoked"))
                        }
                    }
                    .foregroundStyle(DSColor.textPrimary)
                }
                if !releasable.isEmpty {
                    Menu {
                        ForEach(releasable) { purpose in
                            Button(purpose.title) { releasing = purpose }
                        }
                    } label: {
                        Label("Release for a purpose", systemImage: "square.and.arrow.up")
                            .font(DSFont.headline)
                            .foregroundStyle(DSColor.textPrimary)
                            .frame(maxWidth: .infinity, minHeight: DSSize.controlHeight)
                            .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
                            .overlay(RoundedRectangle(cornerRadius: DSRadius.md).stroke(DSColor.controlBorder))
                    }
                    .accessibilityIdentifier("photo.release")
                }
            }
        }
    }

    private func releaseDetail(_ release: MediaReleaseItem) -> String {
        if let revokedAt = release.revokedAt {
            let date = revokedAt.formatted(date: .abbreviated, time: .omitted)
            if let reason = release.revocationReason { return String(localized: "Revoked \(date): \(reason)") }
            return String(localized: "Revoked \(date)")
        }
        return String(localized: "Released \(release.releasedAt.formatted(date: .abbreviated, time: .omitted))")
    }

    // MARK: Loading and changes

    private func load() async {
        do throws(APIError) {
            photo = try await context.repository.photo(patientId: patientId, photoId: photo.id)
            context.reachedServer()
        } catch {
            context.note(error)
        }
        if photo.isViewable, photo.preview == .available {
            preview = await context.derivatives(patientId: patientId, photoIds: [photo.id], variant: .displayPreview)[photo.id]
        }
        await loadPermissions()
        await loadReleases()
    }

    private func loadPermissions() async {
        guard photo.isViewable, context.can("photo.permission.read") else { return }
        do throws(APIError) {
            permissions = try await context.repository.permissions(patientId: patientId)
        } catch {
            context.note(error)
        }
    }

    private func loadReleases() async {
        guard photo.isViewable else { return }
        do throws(APIError) {
            let photoId = photo.id
            releases = try await context.repository.releases(patientId: patientId).filter { $0.photoId == photoId }
        } catch {
            context.note(error)
        }
    }

    private func addTag() async {
        let tag = normalizedDraft
        guard !tag.isEmpty, !photo.tags.contains(tag) else {
            tagDraft = ""
            return
        }
        await saveTags(photo.tags + [tag])
        if message == nil { tagDraft = "" }
    }

    private func saveTags(_ tags: [String]) async {
        busy = true
        defer { busy = false }
        message = nil
        do throws(APIError) {
            photo = try await context.repository.replaceTags(patientId: patientId, photoId: photo.id, tags: tags)
            context.reachedServer()
        } catch {
            context.note(error)
            message = error.status == 0 ? String(localized: "Tags can be changed only while online.") : error.displayMessage
        }
    }

    private func archive() async {
        busy = true
        defer { busy = false }
        message = nil
        do throws(APIError) {
            photo = try await context.repository.archive(patientId: patientId, photoId: photo.id)
            context.reachedServer()
        } catch {
            context.note(error)
            message = error.status == 0 ? String(localized: "Photos can be archived only while online.") : error.displayMessage
        }
    }
}

/// Tags as chips, wrapping onto new lines.
struct FlowTags: View {
    let tags: [String]
    let removable: Bool
    let remove: (String) -> Void

    var body: some View {
        FlowLayout(spacing: DSSpacing.sm) {
            ForEach(tags, id: \.self) { tag in
                HStack(spacing: DSSpacing.xs) {
                    Text(tag).font(DSFont.subheadline)
                    if removable {
                        Button { remove(tag) } label: {
                            Image(systemName: "xmark").font(DSFont.caption1)
                                .frame(width: DSSize.touchTarget, height: DSSize.touchTarget)
                        }
                        .accessibilityLabel(String(localized: "Remove tag \(tag)"))
                    }
                }
                .padding(.leading, DSSpacing.md)
                .padding(.trailing, removable ? 0 : DSSpacing.md)
                .frame(minHeight: DSSize.touchTarget)
                .background(DSColor.accentSoft, in: Capsule())
                .foregroundStyle(DSColor.accentText)
            }
        }
    }
}

/// A minimal wrapping layout for chips.
struct FlowLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(width: bounds.width, subviews: subviews)
        for row in rows {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
        }
    }

    private struct Row {
        var indices: [Int] = []
        var y: CGFloat = 0
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !row.indices.isEmpty, row.width + spacing + size.width > width {
                rows.append(row)
                row = Row(y: row.y + row.height + spacing)
            }
            row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}

/// Confirming a release on its own sheet (C11): what it does and what it relies on.
struct ReleaseSheet: View {
    let context: PhotographyContext
    let patientId: String
    let photoId: String
    let purpose: PermissionCategory
    @State private var busy = false
    @State private var message: String?
    @State private var idempotencyKey = newIdempotencyKey()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                if let message { DSBanner(message, tone: .danger) }
                Text(String(localized: "Release this photo for \(purpose.title.lowercased())?")).font(DSFont.title3)
                Text("The release records that this photo may be used for this purpose only. It relies on the patient's current permission, which is kept with it; if that permission ends, the release ends too.")
                    .font(DSFont.body).foregroundStyle(DSColor.textSecondary)
                if purpose == .patientApp {
                    Text("The patient sees released photos once the patient app shows photos.")
                        .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                }
                Spacer()
                Button(String(localized: "Release for \(purpose.title.lowercased())")) { Task { await release() } }
                    .buttonStyle(DSButtonStyle(.primary))
                    .disabled(busy)
                    .accessibilityIdentifier("release.confirm")
            }
            .padding(DSSpacing.lg)
            .navigationTitle("Release photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func release() async {
        busy = true
        defer { busy = false }
        do throws(APIError) {
            _ = try await context.repository.release(patientId: patientId, photoId: photoId, purpose: purpose, idempotencyKey: idempotencyKey)
            context.reachedServer()
            dismiss()
        } catch {
            context.note(error)
            message = error.status == 0 ? String(localized: "Photos can be released only while online.") : error.displayMessage
        }
    }
}

/// Revoking a release, with the reason kept on record.
struct RevokeReleaseSheet: View {
    let context: PhotographyContext
    let patientId: String
    let release: MediaReleaseItem
    @State private var reason = ""
    @State private var busy = false
    @State private var message: String?
    @Environment(\.dismiss) private var dismiss

    private var trimmed: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                if let message { DSBanner(message, tone: .danger) }
                Section {
                    TextField("Reason", text: $reason, axis: .vertical)
                        .lineLimit(2...5)
                        .accessibilityIdentifier("revoke.reason")
                } header: {
                    Text("Reason")
                } footer: {
                    Text("The release stays on record with the permission it relied on.")
                }
            }
            .navigationTitle(String(localized: "Revoke \(release.purpose.title.lowercased()) release"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Revoke") { Task { await revoke() } }
                        .disabled(trimmed.isEmpty || trimmed.count > 500 || busy)
                        .accessibilityIdentifier("revoke.confirm")
                }
            }
        }
    }

    private func revoke() async {
        busy = true
        defer { busy = false }
        do throws(APIError) {
            _ = try await context.repository.revokeRelease(patientId: patientId, releaseId: release.id, reason: trimmed)
            context.reachedServer()
            dismiss()
        } catch {
            context.note(error)
            message = error.status == 0 ? String(localized: "Releases can be revoked only while online.") : error.displayMessage
        }
    }
}
