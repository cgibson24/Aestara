// One before/after set (Bible §8; ADR-0026 K3-12, K3-13, K3-15; ADR-0027):
// the comparison viewer over the two display previews, manual alignment,
// automatic alignment on request (when the organization allows it) and reset,
// and the way into an export. The previews are fetched through the batch
// access-URL endpoint, so each view is audited. Changing the alignment needs
// `photo.annotate` and a connection; the server decides.
// Bible §8 · tier: feature · Layer 3.
import CoreNetworking
import DesignSystem
import SwiftUI
import UIKit

public struct BeforeAfterScreen: View {
    let repository: BeforeAfterRepository
    let sources: ComparisonSources
    let patientId: String
    let canAlign: Bool
    /// The export sheet of the set, when the role may export.
    let exportSheet: ((BeforeAfterSetItem) -> AnyView)?
    @State private var set: BeforeAfterSetItem
    @State private var exporting: BeforeAfterSetItem?
    @State private var before: UIImage?
    @State private var after: UIImage?
    @State private var state: DSViewState? = .loading("Loading the photos")
    @State private var mode: ComparisonMode = .sideBySide
    @State private var aligning: SimilarityTransform?
    @State private var autoRegistration = false
    @State private var busy = false
    @State private var message: String?
    @State private var confirmingReset = false

    public init(repository: BeforeAfterRepository, sources: ComparisonSources, patientId: String, set: BeforeAfterSetItem,
                canAlign: Bool, exportSheet: ((BeforeAfterSetItem) -> AnyView)?) {
        self.repository = repository
        self.sources = sources
        self.patientId = patientId
        self.canAlign = canAlign
        self.exportSheet = exportSheet
        _set = State(initialValue: set)
    }

    public var body: some View {
        Group {
            if let state {
                DSStateView(state) { Task { await load() } }
            } else if let before, let after {
                VStack(alignment: .leading, spacing: DSSpacing.md) {
                    header
                    if let aligning {
                        AlignmentEditor(before: before, after: after, transform: Binding(get: { aligning }, set: { self.aligning = $0 }))
                        alignmentActions
                    } else {
                        ComparisonViewer(before: before, after: after, transform: set.effectiveTransform, mode: $mode)
                        actions
                    }
                }
                .padding(DSSpacing.lg)
            }
        }
        .background(DSColor.canvas)
        .task { await load() }
        .sheet(item: $exporting) { set in exportSheet?(set) }
        .confirmationDialog("Reset the alignment?", isPresented: $confirmingReset, titleVisibility: .visible) {
            Button("Reset alignment", role: .destructive) { Task { await reset() } }
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
            if let message { DSBanner(message, tone: .danger) }
            Text("Display previews for comparison only. A comparison shows what was photographed; it does not predict any result.")
                .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
        }
    }

    private var actions: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DSSpacing.sm) {
                if canAlign {
                    Button("Align by hand", systemImage: "move.3d") { aligning = set.effectiveTransform }
                        .buttonStyle(DSButtonStyle(.secondary))
                        .disabled(busy || set.job?.isRunning == true)
                        .accessibilityIdentifier("beforeAfter.alignManually")
                    if autoRegistration {
                        Button("Align automatically", systemImage: "wand.and.stars") { Task { await requestRegistration() } }
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
            Button("Save alignment") { Task { await saveAlignment() } }
                .buttonStyle(DSButtonStyle(.primary))
                .disabled(busy)
                .accessibilityIdentifier("alignment.save")
            Button("Cancel") { aligning = nil }
                .buttonStyle(DSButtonStyle(.secondary))
                .accessibilityIdentifier("alignment.cancel")
        }
    }

    private func load() async {
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

    private func saveAlignment() async {
        guard let transform = aligning else { return }
        let repository = self.repository
        let patientId = self.patientId
        let current = set
        if await run({ () async throws(APIError) in try await repository.align(patientId: patientId, set: current, transform: transform) }) {
            aligning = nil
        }
    }

    private func reset() async {
        let repository = self.repository
        let patientId = self.patientId
        let current = set
        _ = await run { () async throws(APIError) in try await repository.reset(patientId: patientId, set: current) }
    }

    private func requestRegistration() async {
        let repository = self.repository
        let patientId = self.patientId
        let current = set
        if await run({ () async throws(APIError) in try await repository.requestRegistration(patientId: patientId, set: current) }) {
            await followRegistration()
        }
    }

    /// Follows the registration job until it ends; nothing runs in the background unseen.
    private func followRegistration() async {
        for _ in 0..<60 where set.job?.isRunning == true {
            try? await Task.sleep(for: .seconds(2))
            if Task.isCancelled { return }
            if let current = try? await repository.set(patientId: patientId, setId: set.id) { set = current }
        }
    }
}
