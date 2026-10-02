// A photo session (Bible §6.1–6.3 steps 2 and 11; PHOTO_PROTOCOLS.md §5;
// ADR-0023 K2-13): the protocol's views, each marked required or optional,
// the required views left in words, the photos of this session still on the
// device, and completing the session. Completing with required views missing
// needs the photographer's explicit acknowledgement; the server checks again.
// A session started offline is created on the server first when the device
// reconnects, then its photos follow.
// Bible §6 · tier: feature · Layer 2.
import CoreNetworking
import DesignSystem
import SwiftUI

struct SessionView: View {
    let context: PhotographyContext
    let patientId: String
    @State private var session: PhotoSessionModel
    private let views: [ProtocolViewSpec]
    @State private var local: [PendingCapture] = []
    @State private var capturing: ProtocolViewSpec?
    @State private var confirmingMissing = false
    @State private var busy = false
    /// Set once the server has completed the session: the screen is closing.
    @State private var closing = false
    @State private var message: String?
    @Environment(\.dismiss) private var dismiss

    init(context: PhotographyContext, patientId: String, active: ActiveSession) {
        self.context = context
        self.patientId = patientId
        _session = State(initialValue: active.session)
        self.views = active.views.sorted { $0.sortOrder < $1.sortOrder }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    Text(remainingText)
                        .font(DSFont.headline)
                        .foregroundStyle(missing.isEmpty ? DSColor.success : DSColor.textPrimary)
                        .accessibilityIdentifier("session.remaining")
                    if let message { DSBanner(message, tone: .danger) }
                    ForEach(views) { view in
                        viewRow(view)
                    }
                }
                .padding(DSSpacing.lg)
            }
            .background(DSColor.canvas)
            .safeAreaInset(edge: .bottom) { bottomBar }
            .navigationTitle(session.protocolName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.accessibilityIdentifier("session.close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Complete") { Task { await complete(acknowledge: false) } }
                        .disabled(busy || closing)
                        .accessibilityIdentifier("session.complete")
                }
            }
            .confirmationDialog(missingTitle, isPresented: $confirmingMissing, titleVisibility: .visible) {
                Button("Complete without them", role: .destructive) { Task { await complete(acknowledge: true) } }
                    .accessibilityIdentifier("session.completeAnyway")
                Button("Keep capturing", role: .cancel) {}
            } message: {
                Text("Missing: \(missingNames). The session will be recorded as incomplete.")
            }
        }
        .task { await refresh() }
        .fullScreenCover(item: $capturing, onDismiss: { Task { await refresh() } }) { view in
            CaptureView(context: context, patientId: patientId, sessionId: session.id, views: views, start: view)
        }
    }

    // MARK: Views

    private func viewRow(_ view: ProtocolViewSpec) -> some View {
        let captured = isCaptured(view.viewKey)
        let pending = local.filter { $0.record.viewKey == view.viewKey }
        return VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack(spacing: DSSpacing.md) {
                Image(systemName: captured ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(captured ? DSColor.success : DSColor.textTertiary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                    Text(view.name).font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                    if let instructions = view.instructions {
                        Text(instructions).font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                    }
                }
                Spacer()
                if captured {
                    DSBadge(String(localized: "Captured"), color: DSColor.success, background: DSColor.successSoft)
                } else if view.isRequired {
                    DSBadge(String(localized: "Required"), color: DSColor.warning, background: DSColor.warningSoft)
                } else {
                    DSBadge(String(localized: "Optional"))
                }
            }
            .accessibilityElement(children: .combine)
            ForEach(pending) { capture in
                pendingRow(capture)
            }
            if context.can("photo.capture") {
                Button(captured ? String(localized: "Capture again") : String(localized: "Capture")) { capturing = view }
                    .buttonStyle(DSButtonStyle(.secondary))
                    .accessibilityIdentifier("session.capture.\(view.viewKey)")
            }
        }
        .padding(DSSpacing.md)
        .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
    }

    @ViewBuilder private func pendingRow(_ capture: PendingCapture) -> some View {
        switch capture.stage {
        case .queued:
            Label("Waiting to upload", systemImage: "arrow.up.circle").font(DSFont.footnote).foregroundStyle(DSColor.info)
        case .scanning:
            Label("Uploaded; being checked", systemImage: "hourglass").font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
        case .rejected:
            VStack(alignment: .leading, spacing: DSSpacing.xs) {
                Label("This photo could not be checked and is not shown.", systemImage: "exclamationmark.triangle")
                    .font(DSFont.footnote).foregroundStyle(DSColor.danger)
                HStack(spacing: DSSpacing.sm) {
                    Button("Upload again") { Task { await uploadAgain(capture) } }
                        .buttonStyle(DSButtonStyle(.secondary))
                    Button("Discard") { Task { await discard(capture) } }
                        .buttonStyle(DSButtonStyle(.secondary))
                }
            }
        case let .failed(failure):
            VStack(alignment: .leading, spacing: DSSpacing.xs) {
                Label(failure, systemImage: "exclamationmark.triangle").font(DSFont.footnote).foregroundStyle(DSColor.danger)
                Button("Discard") { Task { await discard(capture) } }
                    .buttonStyle(DSButtonStyle(.secondary))
            }
        }
    }

    /// The one primary action (DESIGN_SYSTEM.md C2): the next required view still missing.
    @ViewBuilder private var bottomBar: some View {
        if context.can("photo.capture"), let next = views.first(where: { $0.isRequired && !isCaptured($0.viewKey) }) {
            Button(String(localized: "Capture \(next.name)"), systemImage: "camera") { capturing = next }
                .buttonStyle(DSButtonStyle(.primary))
                .padding(DSSpacing.lg)
                .background(DSColor.canvas)
                .accessibilityIdentifier("session.captureNext")
        }
    }

    // MARK: State

    /// On the server, or accepted on this device and waiting to upload.
    private func isCaptured(_ viewKey: String) -> Bool {
        if session.views.first(where: { $0.viewKey == viewKey })?.captured == true { return true }
        return local.contains { capture in
            guard capture.record.viewKey == viewKey else { return false }
            switch capture.stage {
            case .queued, .scanning: return true
            case .rejected, .failed: return false
            }
        }
    }

    private var missing: [ProtocolViewSpec] {
        views.filter { $0.isRequired && !isCaptured($0.viewKey) }
    }

    private var remainingText: String {
        switch missing.count {
        case 0: String(localized: "Every required view is captured")
        case 1: String(localized: "1 required view left")
        default: String(localized: "\(missing.count) required views left")
        }
    }

    private var missingTitle: String {
        missing.count == 1
            ? String(localized: "1 required view is missing")
            : String(localized: "\(missing.count) required views are missing")
    }

    private var missingNames: String { missing.map(\.name).joined(separator: ", ") }

    private func refresh() async {
        await context.sync()
        local = await context.queue.captures().filter { $0.record.sessionId == session.id }
        do throws(APIError) {
            session = try await context.repository.session(patientId: patientId, sessionId: session.id)
            context.reachedServer()
        } catch {
            // Offline, or a session still queued on this device: the local state stands.
            context.note(error)
        }
    }

    private func uploadAgain(_ capture: PendingCapture) async {
        do {
            _ = try await context.queue.requeueAsNew(capture.id)
        } catch {
            message = String(localized: "The photo could not be saved on this device.")
        }
        await refresh()
    }

    private func discard(_ capture: PendingCapture) async {
        await context.queue.discard(capture.id)
        await refresh()
    }

    // MARK: Completing

    private func complete(acknowledge: Bool) async {
        busy = true
        defer { busy = false }
        message = nil
        await refresh()
        if !missing.isEmpty, !acknowledge {
            confirmingMissing = true
            return
        }
        // The server must hold every photo before the session closes to new uploads.
        let waiting = local.contains { if case .queued = $0.stage { return true } else { return false } }
        let sessionQueued = await context.queue.pendingSessions().contains { $0.id == session.id }
        if waiting || sessionQueued {
            message = String(localized: "Photos are still waiting to upload. Complete the session once they have reached the server.")
            return
        }
        do throws(APIError) {
            session = try await context.repository.completeSession(patientId: patientId, sessionId: session.id, acknowledgeMissing: acknowledge)
            context.reachedServer()
            // Not completed twice while the screen closes.
            closing = true
            dismiss()
        } catch {
            context.note(error)
            if error.code == "REQUIRED_VIEWS_MISSING" {
                await refresh()
                confirmingMissing = true
            } else {
                message = error.status == 0
                    ? String(localized: "You are offline. The session stays open; complete it when the device is back online.")
                    : error.displayMessage
            }
        }
    }
}
