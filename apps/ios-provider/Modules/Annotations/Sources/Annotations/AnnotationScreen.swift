// One photo with its annotation layers (Bible §5.1 "Annotate if needed",
// §6.6; ADR-0026 K3-10; ADR-0027): every layer can be shown or hidden; one's
// own layers are edited, new ones drawn. Offline, the copy saved on the
// device is shown and drawings wait to be sent. Annotations are visual notes,
// never measurements.
// Bible §6.6 · tier: feature · Layer 3.
import DesignSystem
import SwiftUI
import UIKit

public struct AnnotationScreen: View {
    let workbench: AnnotationWorkbench
    let image: UIImage
    @State private var hidden: Set<String> = []
    @State private var editing: EditingLayer?
    @State private var deleting: AnnotationLayerItem?

    struct EditingLayer: Equatable {
        let layer: AnnotationLayerItem?
        var drawing: AnnotationDrawing
        var label: String
    }

    public init(workbench: AnnotationWorkbench, image: UIImage) {
        self.workbench = workbench
        self.image = image
    }

    public var body: some View {
        Group {
            if let failure = workbench.failure {
                DSStateView(.error(message: failure, reference: nil)) { Task { await workbench.load() } }
            } else if !workbench.loaded {
                DSStateView(.loading("Loading annotations"))
            } else if let editing {
                editor(editing)
            } else {
                viewer
            }
        }
        .task { await workbench.load() }
        .confirmationDialog("Delete this layer?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible, presenting: deleting) { layer in
            Button("Delete layer", role: .destructive) {
                editing = nil
                Task { await workbench.delete(layer) }
            }
            .accessibilityIdentifier("annotation.confirmDelete")
        } message: { _ in
            Text("The layer is removed from the photo. The photo itself is not changed.")
        }
    }

    // MARK: Viewing

    private var viewer: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                banners
                ForEach(workbench.problems) { operation in
                    ProblemCard(workbench: workbench, operation: operation, image: image)
                }
                AnnotatedImage(image: image, drawings: workbench.layers.filter { !hidden.contains($0.id) }.map(\.drawing))
                    .aspectRatio(image.size.width / max(1, image.size.height), contentMode: .fit)
                    .background(DSColor.photoStage)
                    .clipShape(RoundedRectangle(cornerRadius: DSRadius.md))
                    .accessibilityElement()
                    .accessibilityLabel(Text("Photo with \(visibleCount) annotation layers shown"))
                    .accessibilityIdentifier("annotation.photo")
                Text("Annotations are visual notes drawn over the photo. They are not measurements, and the original photo never changes.")
                    .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                if workbench.canAnnotate {
                    Button("New layer", systemImage: "plus") {
                        editing = EditingLayer(layer: nil, drawing: AnnotationDrawing(), label: "")
                    }
                    .buttonStyle(DSButtonStyle(.primary))
                    .disabled(workbench.busy)
                    .accessibilityIdentifier("annotation.newLayer")
                }
                if workbench.layers.isEmpty {
                    DSStateView(.empty(title: String(localized: "No annotations"),
                                       message: String(localized: "Layers drawn over this photo appear here.")))
                } else {
                    ForEach(workbench.layers) { layer in
                        layerRow(layer)
                    }
                }
            }
            .padding(DSSpacing.lg)
        }
    }

    private var visibleCount: Int { workbench.layers.filter { !hidden.contains($0.id) }.count }

    @ViewBuilder private var banners: some View {
        if workbench.offline {
            DSBanner(String(localized: "You are offline. These are the layers saved on this device; what you draw is sent when you reconnect."),
                     tone: .info)
        }
        if let message = workbench.message { DSBanner(message, tone: .danger) }
    }

    private func layerRow(_ layer: AnnotationLayerItem) -> some View {
        let mine = workbench.isMine(layer)
        let shown = !hidden.contains(layer.id)
        return HStack(spacing: DSSpacing.md) {
            Button {
                if shown { hidden.insert(layer.id) } else { hidden.remove(layer.id) }
            } label: {
                Image(systemName: shown ? "eye" : "eye.slash")
                    .font(DSFont.headline)
                    .frame(width: DSSize.touchTarget, height: DSSize.touchTarget)
            }
            .buttonStyle(.plain)
            .foregroundStyle(DSColor.accent)
            .accessibilityLabel(Text(shown ? "Hide layer" : "Show layer"))
            .accessibilityIdentifier("annotation.toggle.\(layer.id)")
            VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                Text(layer.label ?? (mine ? String(localized: "Your layer") : String(localized: "A colleague's layer")))
                    .font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                HStack(spacing: DSSpacing.sm) {
                    Text(layer.drawing.shapes.count == 1 ? String(localized: "1 shape") : String(localized: "\(layer.drawing.shapes.count) shapes"))
                    if workbench.queuedLayers.contains(layer.id) { DSBadge(String(localized: "Waiting to send")) }
                }
                .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            }
            Spacer()
            if mine, workbench.canAnnotate {
                Button("Edit") {
                    hidden.remove(layer.id)
                    editing = EditingLayer(layer: layer, drawing: layer.drawing, label: layer.label ?? "")
                }
                .buttonStyle(DSButtonStyle(.secondary))
                .frame(maxWidth: 120)
                .disabled(workbench.busy)
                .accessibilityIdentifier("annotation.edit.\(layer.id)")
            }
        }
        .padding(DSSpacing.sm)
        .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
    }

    // MARK: Editing

    private func editor(_ current: EditingLayer) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            banners
            AnnotationEditor(
                image: image,
                beneath: workbench.layers.filter { $0.id != current.layer?.id && !hidden.contains($0.id) }.map(\.drawing),
                drawing: Binding(get: { editing?.drawing ?? AnnotationDrawing() }, set: { editing?.drawing = $0 })
            )
            // Multi-line, so the name grows with the text size instead of being cut off.
            TextField("Layer name (optional)", text: Binding(get: { editing?.label ?? "" }, set: { editing?.label = $0 }),
                      axis: .vertical)
                .lineLimit(1...3)
                .padding(DSSpacing.sm)
                .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.sm))
                .overlay(RoundedRectangle(cornerRadius: DSRadius.sm).stroke(DSColor.controlBorder))
                .accessibilityIdentifier("annotation.label")
            HStack(spacing: DSSpacing.sm) {
                Button("Save layer") { Task { await save(current) } }
                    .buttonStyle(DSButtonStyle(.primary))
                    .disabled(workbench.busy || current.drawing.shapes.isEmpty || trimmedLabel(current).count > AnnotationLimits.maxLabelLength)
                    .accessibilityIdentifier("annotation.save")
                Button("Cancel") { editing = nil }
                    .buttonStyle(DSButtonStyle(.secondary))
                    .accessibilityIdentifier("annotation.cancel")
                if let layer = current.layer {
                    Button("Delete") { deleting = layer }
                        .buttonStyle(DSButtonStyle(.destructive))
                        .disabled(workbench.busy || (workbench.offline && layer.version > 0))
                        .accessibilityIdentifier("annotation.delete")
                }
            }
        }
        .padding(DSSpacing.lg)
    }

    private func trimmedLabel(_ current: EditingLayer) -> String {
        current.label.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func save(_ current: EditingLayer) async {
        let label = trimmedLabel(current)
        if await workbench.save(current.layer, drawing: current.drawing, label: label.isEmpty ? nil : label) {
            editing = nil
        }
    }
}

/// A queued drawing the server did not take: both drawings for a conflict, or the refusal in words.
private struct ProblemCard: View {
    let workbench: AnnotationWorkbench
    let operation: AnnotationOperation
    let image: UIImage

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            switch operation.problem {
            case let .conflict(serverDrawing, _):
                DSBanner(String(localized: "This layer changed elsewhere while you were offline. Choose which drawing to keep."), tone: .warning)
                HStack(alignment: .top, spacing: DSSpacing.md) {
                    preview(String(localized: "Your drawing"), drawing: operation.drawing)
                    preview(String(localized: "The saved drawing"), drawing: serverDrawing)
                }
                HStack(spacing: DSSpacing.sm) {
                    Button("Keep mine") { Task { await workbench.keepMine(operation) } }
                        .buttonStyle(DSButtonStyle(.primary))
                        .accessibilityIdentifier("annotation.conflict.keepMine")
                    Button("Keep the saved drawing") { Task { await workbench.keepSaved(operation) } }
                        .buttonStyle(DSButtonStyle(.secondary))
                        .accessibilityIdentifier("annotation.conflict.keepSaved")
                }
                .disabled(workbench.busy)
            case let .refused(message):
                DSBanner(String(localized: "This layer could not be saved: \(message)"), tone: .danger)
                preview(String(localized: "Your drawing"), drawing: operation.drawing)
                Button("Discard drawing", role: .destructive) { Task { await workbench.keepSaved(operation) } }
                    .buttonStyle(DSButtonStyle(.destructive))
                    .accessibilityIdentifier("annotation.refused.discard")
            case nil:
                EmptyView()
            }
        }
        .padding(DSSpacing.md)
        .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
    }

    private func preview(_ title: String, drawing: AnnotationDrawing) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text(title).font(DSFont.subheadline.weight(.semibold)).foregroundStyle(DSColor.textSecondary)
            AnnotatedImage(image: image, drawings: [drawing])
                .aspectRatio(image.size.width / max(1, image.size.height), contentMode: .fit)
                .background(DSColor.photoStage)
                .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm))
        }
        .frame(maxWidth: .infinity)
    }
}
