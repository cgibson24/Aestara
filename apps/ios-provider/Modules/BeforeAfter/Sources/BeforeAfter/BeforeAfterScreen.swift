// One before/after set (Bible §8; ADR-0026 K3-12, K3-13, K3-15; ADR-0027):
// the comparison viewer over the two display previews, manual alignment,
// automatic alignment on request (when the organization allows it) and reset,
// and the way into an export. The previews are fetched through the batch
// access-URL endpoint, so each view is audited. Changing the alignment needs
// `photo.annotate` and a connection; the server decides.
// Bible §8 · tier: feature · Layer 3.
import CoreNetworking
import DesignSystem
import Observation
import SwiftUI
import UIKit

/// One open set: the set, its two display previews once loaded, the viewing mode and an
/// alignment in progress. Owned by the list rather than by the screen, so a screen SwiftUI
/// builds again keeps all of it and fetches nothing again (F-70).
@MainActor
@Observable
public final class ComparisonSession: Identifiable, Hashable {
    nonisolated public let id: String
    let repository: BeforeAfterRepository
    let sources: ComparisonSources
    let patientId: String
    var set: BeforeAfterSetItem
    var before: UIImage?
    var after: UIImage?
    var state: DSViewState? = .loading("Loading the photos")
    var mode: ComparisonMode = .sideBySide
    var aligning: SimilarityTransform?
    var autoRegistration = false
    var busy = false
    var message: String?

    public nonisolated static func == (lhs: ComparisonSession, rhs: ComparisonSession) -> Bool { lhs === rhs }

    public nonisolated func hash(into hasher: inout Hasher) { hasher.combine(ObjectIdentifier(self)) }

    public init(repository: BeforeAfterRepository, sources: ComparisonSources, patientId: String, set: BeforeAfterSetItem) {
        id = set.id
        self.repository = repository
        self.sources = sources
        self.patientId = patientId
        self.set = set
    }

    /// Loads the photos the first time; afterwards only follows a running alignment job.
    func appear() async {
        if before == nil || after == nil {
            await load()
        } else if set.job?.isRunning == true {
            await followRegistration()
        }
    }

    func load() async {
        if before == nil { state = .loading("Loading the photos") }
        let images = await sources.images([set.beforePhotoId, set.afterPhotoId], true)
        guard let beforeData = images[set.beforePhotoId], let afterData = images[set.afterPhotoId],
              let beforeImage = UIImage(data: beforeData), let afterImage = UIImage(data: afterData) else {
            state = .error(message: String(localized: "The photos could not be shown. Check the connection; offline, only photos saved on this device can be compared."),
                           reference: nil)
            return
        }
        before = beforeImage
        after = afterImage
        state = nil
        autoRegistration = await sources.autoRegistration()
        if set.job?.isRunning == true { await followRegistration() }
    }

    private func run(_ change: () async throws(APIError) -> BeforeAfterSetItem) async -> Bool {
        busy = true
        defer { busy = false }
        do throws(APIError) {
            set = try await change()
            message = nil
            return true
        } catch {
            message = error.status == 0 ? String(localized: "Changing the alignment needs a connection.") : error.displayMessage
            if error.status == 412, let current = try? await repository.set(patientId: patientId, setId: set.id) { set = current }
            return false
        }
    }

    func saveAlignment() async {
        guard let transform = aligning else { return }
        let repository = self.repository
        let patientId = self.patientId
        let current = set
        if await run({ () async throws(APIError) in try await repository.align(patientId: patientId, set: current, transform: transform) }) {
            aligning = nil
        }
    }

    func reset() async {
        let repository = self.repository
        let patientId = self.patientId
        let current = set
        _ = await run { () async throws(APIError) in try await repository.reset(patientId: patientId, set: current) }
    }

    func requestRegistration() async {
        let repository = self.repository
        let patientId = self.patientId
        let current = set
        if await run({ () async throws(APIError) in try await repository.requestRegistration(patientId: patientId, set: current) }) {
            await followRegistration()
        }
    }

    /// Follows the registration job until it ends; nothing runs in the background unseen.
    func followRegistration() async {
        for _ in 0..<60 where set.job?.isRunning == true {
            try? await Task.sleep(for: .seconds(2))
            if Task.isCancelled { return }
            if let current = try? await repository.set(patientId: patientId, setId: set.id) { set = current }
        }
    }
}

public struct BeforeAfterScreen: View {
    @Bindable var session: ComparisonSession
    let canAlign: Bool
    /// The export sheet of the set, when the role may export.
    let exportSheet: ((BeforeAfterSetItem) -> AnyView)?
    @State private var exporting: BeforeAfterSetItem?
    @State private var confirmingReset = false

    public init(session: ComparisonSession, canAlign: Bool, exportSheet: ((BeforeAfterSetItem) -> AnyView)?) {
        self.session = session
        self.canAlign = canAlign
        self.exportSheet = exportSheet
    }

    private var set: BeforeAfterSetItem { session.set }
    private var busy: Bool { session.busy }

    public var body: some View {
        Group {
            if let state = session.state {
                DSStateView(state) { Task { await session.load() } }
            } else if let before = session.before, let after = session.after {
                VStack(alignment: .leading, spacing: DSSpacing.md) {
                    header
                    if let aligning = session.aligning {
                        AlignmentEditor(before: before, after: after,
                                        transform: Binding(get: { aligning }, set: { session.aligning = $0 }))
                        alignmentActions
                    } else {
                        ComparisonViewer(before: before, after: after, transform: set.effectiveTransform, mode: $session.mode)
                        actions
                    }
                }
                .padding(DSSpacing.lg)
            }
        }
        .background(DSColor.canvas)
        .task { await session.appear() }
        .traceLifecycle("BeforeAfterScreen")
        .sheet(item: $exporting) { set in exportSheet?(set) }
        .confirmationDialog("Reset the alignment?", isPresented: $confirmingReset, titleVisibility: .visible) {
            Button("Reset alignment", role: .destructive) { Task { await session.reset() } }
                .accessibilityIdentifier("beforeAfter.confirmReset")
        } message: {
            Text("The after photo is shown as captured again. The photos themselves never change.")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            HStack(spacing: DSSpacing.sm) {
                DSBadge(set.mode.title)
                    .accessibilityIdentifier("beforeAfter.mode")
                if set.job?.isRunning == true {
                    ProgressView()
                    Text("Aligning automatically").font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                }
            }
            if let failure = set.job?.failureMessage { DSBanner(failure, tone: .warning) }
            if let message = session.message { DSBanner(message, tone: .danger) }
            Text("Display previews for comparison only. A comparison shows what was photographed; it does not predict any result.")
                .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                // Its full height at every text size; the photos give way instead.
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var actions: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DSSpacing.sm) {
                if canAlign {
                    Button("Align by hand", systemImage: "move.3d") { session.aligning = set.effectiveTransform }
                        .buttonStyle(DSButtonStyle(.secondary))
                        .disabled(busy || set.job?.isRunning == true)
                        .accessibilityIdentifier("beforeAfter.alignManually")
                    if session.autoRegistration {
                        Button("Align automatically", systemImage: "wand.and.stars") { Task { await session.requestRegistration() } }
                            .buttonStyle(DSButtonStyle(.secondary))
                            .disabled(busy || set.job?.isRunning == true)
                            .accessibilityIdentifier("beforeAfter.alignAutomatically")
                    }
                    if set.mode != .none {
                        Button("Reset alignment", systemImage: "arrow.uturn.backward") { confirmingReset = true }
                            .buttonStyle(DSButtonStyle(.secondary))
                            .disabled(busy)
                            .accessibilityIdentifier("beforeAfter.reset")
                    }
                }
                if exportSheet != nil {
                    Button("Export", systemImage: "square.and.arrow.up") { exporting = set }
                        .buttonStyle(DSButtonStyle(.secondary))
                        .accessibilityIdentifier("beforeAfter.export")
                }
            }
        }
    }

    private var alignmentActions: some View {
        HStack(spacing: DSSpacing.sm) {
            Button("Save alignment") { Task { await session.saveAlignment() } }
                .buttonStyle(DSButtonStyle(.primary))
                .disabled(busy)
                .accessibilityIdentifier("alignment.save")
            Button("Cancel") { session.aligning = nil }
                .buttonStyle(DSButtonStyle(.secondary))
                .accessibilityIdentifier("alignment.cancel")
        }
    }
}
