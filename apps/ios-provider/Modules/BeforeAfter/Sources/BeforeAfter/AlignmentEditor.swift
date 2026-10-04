// Manual alignment (Bible §8.2; ADR-0026 K3-13; ADR-0027): the after photo
// over the before photo, half transparent, moved with a drag, scaled with a
// pinch and turned with a rotation, or step by step with the buttons. A
// similarity transform only: alignment never reshapes anatomy. Saving
// records mode MANUAL with If-Match; nothing in the photos changes.
// Bible §8 · tier: feature · Layer 3.
import DesignSystem
import SwiftUI
import UIKit

public struct AlignmentEditor: View {
    let before: UIImage
    let after: UIImage
    @Binding var transform: SimilarityTransform
    @State private var base: SimilarityTransform?
    @State private var opacity: Double = 0.5

    /// One step of the buttons.
    static let moveStep = 0.005
    static let rotateStep = 0.5
    static let scaleStep = 0.01

    public init(before: UIImage, after: UIImage, transform: Binding<SimilarityTransform>) {
        self.before = before
        self.after = after
        _transform = transform
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            GeometryReader { geometry in
                let frame = fittedFrame(before.size, in: geometry.size)
                AlignedPair(before: before, after: after, transform: transform, afterOpacity: opacity)
                    .contentShape(Rectangle())
                    .gesture(gestures(frameHeight: frame.height))
                    .accessibilityElement()
                    .accessibilityLabel(Text("Alignment area"))
                    .accessibilityHint(Text("Drag to move the after photo, pinch to scale it and rotate with two fingers."))
                    .accessibilityIdentifier("alignment.canvas")
            }
            .background(DSColor.photoStage, in: RoundedRectangle(cornerRadius: DSRadius.md))
            .clipShape(RoundedRectangle(cornerRadius: DSRadius.md))
            HStack {
                Text("After photo").font(DSFont.subheadline).foregroundStyle(DSColor.textSecondary)
                Slider(value: $opacity, in: 0.2...0.8)
                    .accessibilityLabel(Text("After photo opacity"))
                    .accessibilityIdentifier("alignment.opacity")
            }
            steps
            readout
                .font(DSFont.footnote.monospacedDigit())
                .foregroundStyle(DSColor.textSecondary)
                .accessibilityIdentifier("alignment.readout")
        }
    }

    private var readout: Text {
        let t = transform
        return Text("Scale \(t.scale, specifier: "%.2f") · Rotation \(t.rotationDeg, specifier: "%.1f")° · Offset \(t.translateX, specifier: "%.3f"), \(t.translateY, specifier: "%.3f")")
    }

    private var steps: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DSSpacing.xs) {
                step("Move left", "arrow.left", id: "left") { $0.translateX -= Self.moveStep }
                step("Move right", "arrow.right", id: "right") { $0.translateX += Self.moveStep }
                step("Move up", "arrow.up", id: "up") { $0.translateY -= Self.moveStep }
                step("Move down", "arrow.down", id: "down") { $0.translateY += Self.moveStep }
                step("Turn left", "rotate.left", id: "rotateLeft") { $0.rotationDeg -= Self.rotateStep }
                step("Turn right", "rotate.right", id: "rotateRight") { $0.rotationDeg += Self.rotateStep }
                step("Smaller", "minus.magnifyingglass", id: "smaller") { $0.scale *= 1 - Self.scaleStep }
                step("Larger", "plus.magnifyingglass", id: "larger") { $0.scale *= 1 + Self.scaleStep }
            }
        }
    }

    private func step(_ title: LocalizedStringKey, _ systemImage: String, id: String,
                      change: @escaping (inout SimilarityTransform) -> Void) -> some View {
        Button {
            var next = transform
            change(&next)
            transform = next.clamped
        } label: {
            Image(systemName: systemImage)
                .font(DSFont.headline)
                .frame(width: DSSize.touchTarget, height: DSSize.touchTarget)
                .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.sm))
        }
        .buttonStyle(.plain)
        .foregroundStyle(DSColor.textPrimary)
        .accessibilityLabel(Text(title))
        .accessibilityIdentifier("alignment.\(id)")
    }

    /// Drag, pinch and rotation at once, each relative to where the gesture began.
    private func gestures(frameHeight: CGFloat) -> some Gesture {
        SimultaneousGesture(
            DragGesture()
                .onChanged { value in
                    guard frameHeight > 0 else { return }
                    let start = base ?? transform
                    base = start
                    var next = transform
                    next.translateX = start.translateX + value.translation.width / frameHeight
                    next.translateY = start.translateY + value.translation.height / frameHeight
                    transform = next.clamped
                }
                .onEnded { _ in base = nil },
            SimultaneousGesture(
                MagnifyGesture()
                    .onChanged { value in
                        let start = base ?? transform
                        base = start
                        var next = transform
                        next.scale = start.scale * value.magnification
                        transform = next.clamped
                    }
                    .onEnded { _ in base = nil },
                RotateGesture()
                    .onChanged { value in
                        let start = base ?? transform
                        base = start
                        var next = transform
                        next.rotationDeg = start.rotationDeg + value.rotation.degrees
                        transform = next.clamped
                    }
                    .onEnded { _ in base = nil }
            )
        )
    }
}
