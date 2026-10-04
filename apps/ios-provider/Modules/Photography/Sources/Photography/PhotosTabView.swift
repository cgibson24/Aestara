// The patient profile's Photos tab (Bible §4.3, §6.1–6.3; spec §6.3;
// ADR-0023 K2-13, K2-14): the patient's photos as thumbnails, open sessions,
// photos still waiting to upload, and the ways into a new photo session and
// the media permissions. Archived photos are hidden unless asked for and then
// carry a badge; photos being checked or rejected show their state, never an
// image. The buttons follow the role's permissions; the server decides. In a
// consultation's workspace it shows only that consultation's sessions and
// photos, and new sessions are taken for it (ADR-0027).
// Bible §6 · tier: feature · Layers 2–3.
import CoreNetworking
import DesignSystem
import Media
import SwiftUI
import UIKit

/// A session on screen, with the views of its protocol.
struct ActiveSession: Identifiable, Equatable {
    var id: String { session.id }
    var session: PhotoSessionModel
    let views: [ProtocolViewSpec]
}

public struct PhotosTabView: View {
    let context: PhotographyContext
    let patientId: String
    /// Only this consultation's sessions and photos, and new sessions taken for it.
    let consultationId: String?
    /// False while the consultation is not under way (ADR-0026 K3-09).
    let allowsNewSessions: Bool
    @State private var photos: [PhotoItem] = []
    /// The sessions taken for the consultation, as last loaded.
    @State private var consultationSessions: Set<String> = []
    @State private var thumbnails: [String: Data] = [:]
    @State private var openSessions: [PhotoSessionModel] = []
    @State private var loadState: DSViewState? = .loading("Loading photos")
    @State private var showArchived = false
    @State private var startingSession = false
    @State private var activeSession: ActiveSession?
    /// Started from the protocol sheet; shown once that sheet has gone.
    @State private var startedSession: ActiveSession?
    @State private var selectedPhoto: PhotoItem?
    @State private var showingPermissions = false
    @State private var message: String?
    /// Bumped when a session or photo closes, which restarts the refresh loop.
    @State private var reloads = 0
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    public init(context: PhotographyContext, patientId: String, consultationId: String? = nil, allowsNewSessions: Bool = true) {
        self.context = context
        self.patientId = patientId
        self.consultationId = consultationId
        self.allowsNewSessions = allowsNewSessions
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            actions
            if context.unsentCount > 0 {
                DSBanner(
                    context.unsentCount == 1
                        ? String(localized: "1 photo is waiting to upload.")
                        : String(localized: "\(context.unsentCount) photos are waiting to upload."),
                    tone: .info
                )
                .accessibilityIdentifier("photos.unsent")
            }
            if let message { DSBanner(message, tone: .danger) }
            ForEach(openSessions) { session in
                HStack {
                    VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                        Text(session.protocolName).font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                        Text(missingText(session)).font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                    }
                    Spacer()
                    if context.can("photo.capture") {
                        Button("Continue") { Task { await resume(session) } }
                            .buttonStyle(DSButtonStyle(.secondary))
                            .frame(maxWidth: 160)
                            .accessibilityIdentifier("photos.continueSession")
                    }
                }
                .padding(DSSpacing.md)
                .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
            }
            content
        }
        .task(id: RefreshKey(showArchived: showArchived, reloads: reloads)) { await refreshLoop() }
        .sheet(isPresented: $startingSession, onDismiss: {
            activeSession = startedSession
            startedSession = nil
        }) {
            StartSessionView(context: context, patientId: patientId, consultationId: consultationId) { started in
                startedSession = started
                startingSession = false
            }
        }
        .fullScreenCover(item: $activeSession, onDismiss: { reloads += 1 }) { active in
            SessionView(context: context, patientId: patientId, active: active)
        }
        .sheet(item: $selectedPhoto, onDismiss: { reloads += 1 }) { photo in
            PhotoDetailView(context: context, patientId: patientId, photo: photo)
        }
        .sheet(isPresented: $showingPermissions) {
            NavigationStack { MediaPermissionsView(context: context, patientId: patientId) }
        }
    }

    private struct RefreshKey: Hashable {
        let showArchived: Bool
        let reloads: Int
    }

    /// Side by side on a regular-width screen at the standard text size, otherwise
    /// stacked, so a label never wraps inside a half-width button (DESIGN_SYSTEM.md §11:
    /// nothing clips). One layout that changes, so each button keeps its identity.
    private var actions: some View {
        let layout = sizeClass == .regular && dynamicTypeSize <= .large
            ? AnyLayout(HStackLayout(spacing: DSSpacing.md))
            : AnyLayout(VStackLayout(spacing: DSSpacing.sm))
        return layout {
            if context.can("photo.capture"), allowsNewSessions {
                Button("Start photo session", systemImage: "camera") { startingSession = true }
                    .buttonStyle(DSButtonStyle(.primary))
                    .accessibilityIdentifier("photos.startSession")
            }
            if context.can("photo.permission.read"), consultationId == nil {
                Button("Media permissions", systemImage: "hand.raised") { showingPermissions = true }
                    .buttonStyle(DSButtonStyle(.secondary))
                    .accessibilityIdentifier("photos.permissions")
            }
        }
    }

    @ViewBuilder private var content: some View {
        if let loadState {
            DSStateView(loadState) { Task { await load() } }
        } else {
            Toggle("Show archived photos", isOn: $showArchived)
                .font(DSFont.subheadline)
                .accessibilityIdentifier("photos.showArchived")
            let visible = photos.filter { photo in
                (showArchived || !photo.isArchived)
                    && (consultationId == nil || photo.sessionId.map { consultationSessions.contains($0) } == true)
            }
            if visible.isEmpty {
                DSStateView(.empty(title: String(localized: "No photos yet"),
                                   message: consultationId == nil
                                       ? String(localized: "This patient has no clinical photos yet.")
                                       : String(localized: "Photos taken in this consultation appear here.")))
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: DSSpacing.md)], spacing: DSSpacing.md) {
                    ForEach(visible) { photo in
                        Button { selectedPhoto = photo } label: {
                            PhotoTile(photo: photo, image: thumbnails[photo.id])
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("photos.tile.\(photo.viewKey ?? photo.id)")
                    }
                }
            }
        }
    }

    private func missingText(_ session: PhotoSessionModel) -> String {
        let count = session.missingRequiredViews.count
        return count == 0
            ? String(localized: "Every required view is captured")
            : count == 1 ? String(localized: "1 required view left") : String(localized: "\(count) required views left")
    }

    /// Loads now, then again every few seconds while photos are still being checked or uploaded.
    private func refreshLoop() async {
        await load()
        while !Task.isCancelled {
            let busy = context.unsentCount > 0 || photos.contains { !$0.isViewable && !$0.isRejected }
                || photos.contains { $0.isViewable && $0.thumbnail == .pending }
            guard busy else { return }
            try? await Task.sleep(for: .seconds(3))
            if Task.isCancelled { return }
            await context.sync()
            await load()
        }
    }

    private func load() async {
        do throws(APIError) {
            let loaded = try await context.repository.photos(patientId: patientId, includeArchived: showArchived)
            context.reachedServer()
            photos = loaded
            context.savePhotos(loaded, patientId: patientId)
            if context.can("photo.view") {
                let sessions = try await context.repository.sessions(patientId: patientId, consultationId: consultationId)
                openSessions = sessions.filter(\.isOpen)
                if consultationId != nil { consultationSessions = Set(sessions.map(\.id)) }
            }
            loadState = nil
        } catch {
            context.note(error)
            if error.status == 0 {
                photos = context.cachedPhotos(patientId: patientId)
                loadState = nil
            } else {
                loadState = error.status == 403 ? .permissionDenied : .error(message: error.displayMessage, reference: error.requestId)
                return
            }
        }
        let ready = photos.filter { $0.isViewable && $0.thumbnail == .available }.map(\.id)
        let missing = ready.filter { thumbnails[$0] == nil }
        if !missing.isEmpty {
            let loaded = await context.derivatives(patientId: patientId, photoIds: missing, variant: .thumbnail)
            thumbnails.merge(loaded) { _, new in new }
        }
        await context.refreshUnsent()
    }

    private func resume(_ session: PhotoSessionModel) async {
        let protocols = context.cachedProtocols()
        let views: [ProtocolViewSpec]
        if let known = protocols.first(where: { $0.id == session.protocolId }) {
            views = known.views
        } else {
            do throws(APIError) {
                let active = try await context.repository.activeProtocols()
                context.saveProtocols(active)
                views = active.first { $0.id == session.protocolId }?.views ?? []
            } catch {
                message = error.displayMessage
                return
            }
        }
        // A retired protocol keeps its session's views: fall back to the session's own list.
        let fallback = session.views.map {
            ProtocolViewSpec(viewKey: $0.viewKey, name: $0.name, sortOrder: $0.sortOrder, isRequired: $0.isRequired,
                             instructions: nil, poseTarget: nil)
        }
        activeSession = ActiveSession(session: session, views: views.isEmpty ? fallback : views)
    }
}

/// One photo in the grid: its thumbnail, or its state in words.
public struct PhotoTile: View {
    let photo: PhotoItem
    let image: Data?

    public init(photo: PhotoItem, image: Data?) {
        self.photo = photo
        self.image = image
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            ZStack {
                DSColor.photoStage
                if let image, let uiImage = UIImage(data: image) {
                    Image(uiImage: uiImage).resizable().scaledToFill()
                } else {
                    Text(stateText).font(DSFont.footnote).foregroundStyle(DSColor.photoStageText)
                        .multilineTextAlignment(.center).padding(DSSpacing.sm)
                }
            }
            .frame(height: 150)
            .clipShape(RoundedRectangle(cornerRadius: DSRadius.md))
            HStack(spacing: DSSpacing.xs) {
                Text(photo.viewKey.map(words) ?? String(localized: "Photo")).font(DSFont.subheadline)
                    .foregroundStyle(DSColor.textPrimary)
                if photo.isArchived { DSBadge(String(localized: "Archived")) }
            }
            Text(photo.capturedAt.formatted(date: .abbreviated, time: .shortened)).font(DSFont.caption1)
                .foregroundStyle(DSColor.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var stateText: String {
        if photo.isRejected { return String(localized: "This photo could not be checked and is not shown.") }
        if !photo.isViewable { return String(localized: "Being checked") }
        return photo.thumbnail == .failed ? String(localized: "Preview unavailable") : String(localized: "Preparing preview")
    }
}

/// Choosing the protocol of a new session (Bible §6.3 step 1). Offline, the
/// session is queued with a client ID and created when the device reconnects.
struct StartSessionView: View {
    let context: PhotographyContext
    let patientId: String
    let consultationId: String?
    let onStart: (ActiveSession) -> Void
    @State private var protocols: [PhotoProtocol] = []
    @State private var state: DSViewState? = .loading("Loading protocols")
    @State private var busy = false
    @State private var message: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let state {
                    DSStateView(state) { Task { await load() } }
                } else {
                    List {
                        if let message { DSBanner(message, tone: .danger) }
                        ForEach(protocols) { item in
                            Button { Task { await start(item) } } label: {
                                VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                                    Text(item.name).font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                                    Text(item.views.map(\.name).joined(separator: " · ")).font(DSFont.footnote)
                                        .foregroundStyle(DSColor.textSecondary)
                                }
                            }
                            .disabled(busy)
                            .accessibilityIdentifier("session.protocol.\(item.name)")
                        }
                    }
                }
            }
            .navigationTitle("Start a photo session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .task { await load() }
    }

    private func load() async {
        do throws(APIError) {
            let active = try await context.repository.activeProtocols()
            context.reachedServer()
            context.saveProtocols(active)
            protocols = active
            state = nil
        } catch {
            context.note(error)
            let cached = context.cachedProtocols()
            if error.status == 0, !cached.isEmpty {
                protocols = cached
                state = nil
            } else {
                state = error.status == 0 ? .offline : .error(message: error.displayMessage, reference: error.requestId)
            }
        }
    }

    private func start(_ item: PhotoProtocol) async {
        busy = true
        defer { busy = false }
        let startedAt = Date()
        let sessionId = UUIDv7.make(at: startedAt)
        do throws(APIError) {
            let session = try await context.repository.startSession(
                patientId: patientId, protocolId: item.id, consultationId: consultationId, sessionId: sessionId,
                startedAt: startedAt, idempotencyKey: newIdempotencyKey()
            )
            onStart(ActiveSession(session: session, views: item.views))
        } catch {
            context.note(error)
            guard error.status == 0 else {
                message = error.displayMessage
                return
            }
            // Offline: queue the session; it is created first when the device reconnects.
            do {
                let queuedId = try await context.queue.enqueueSession(patientId: patientId, protocolId: item.id,
                                                                      consultationId: consultationId, startedAt: startedAt)
                let session = PhotoSessionModel(
                    id: queuedId, patientId: patientId, protocolId: item.id, protocolName: item.name, status: "IN_PROGRESS",
                    startedAt: startedAt,
                    views: item.views.map {
                        SessionViewState(viewKey: $0.viewKey, name: $0.name, sortOrder: $0.sortOrder, isRequired: $0.isRequired,
                                         captured: false, photoCount: 0)
                    },
                    missingRequiredViews: item.views.filter(\.isRequired).map(\.viewKey),
                    consultationId: consultationId
                )
                onStart(ActiveSession(session: session, views: item.views))
            } catch {
                message = String(localized: "The session could not be saved on this device.")
            }
        }
    }
}
