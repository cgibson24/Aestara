// The comparison viewer (Bible §8.2; ADR-0026 K3-12; ADR-0027): the two
// display previews, the after one placed by the set's alignment inside a
// frame the size of the before one, as the export renders it. Five modes:
// side by side, swipe, cross-fade, blink (never more than 3 changes a second,
// the WCAG flash threshold) and overlay. Zoom and pan follow both images
// unless unlinked; a double tap or Reset returns to the fitted view. Nothing
// is rendered on the server and the originals never change.
// Bible §8 · tier: feature · Layer 3.
import DesignSystem
import SwiftUI
import UIKit

/// The zoom and pan of a pane.
struct Viewport: Equatable {
    var zoom: CGFloat = 1
    var pan: CGSize = .zero

    static let maxZoom: CGFloat = 6
}

/// The zoom and pan of the side-by-side panes (ADR-0026 K3-12): one viewport for both while
/// linked, the default; each its own once unlinked. Linking again gives the after pane the
/// before pane's view. The single-pane modes use the before pane's.
struct PaneViewports: Equatable {
    enum Pane { case before, after }

    private(set) var linked = true
    private(set) var before = Viewport()
    private(set) var after = Viewport()

    func viewport(_ pane: Pane) -> Viewport {
        linked || pane == .before ? before : after
    }

    mutating func set(_ viewport: Viewport, for pane: Pane) {
        if linked {
            before = viewport
            after = viewport
        } else if pane == .before {
            before = viewport
        } else {
            after = viewport
        }
    }

    mutating func link(_ on: Bool) {
        linked = on
        if on { after = before }
    }

    /// Back to the fitted view.
    mutating func reset() {
        before = Viewport()
        after = Viewport()
    }
}

/// Where the before image sits when fitted into `container`.
func fittedFrame(_ image: CGSize, in container: CGSize) -> CGRect {
    guard image.width > 0, image.height > 0, container.width > 0, container.height > 0 else { return .zero }
    let scale = min(container.width / image.width, container.height / image.height)
    let size = CGSize(width: image.width * scale, height: image.height * scale)
    return CGRect(x: (container.width - size.width) / 2, y: (container.height - size.height) / 2, width: size.width, height: size.height)
}

/// The before image fitted to the pane, and the after image placed by the transform in the same
/// frame. `reveal` (swipe) shows the after image only right of that fraction of the width.
struct AlignedPair: View {
    let before: UIImage
    let after: UIImage
    let transform: SimilarityTransform
    var showBefore = true
    var afterOpacity: Double = 1
    var reveal: CGFloat?

    var body: some View {
        GeometryReader { geometry in
            let frame = fittedFrame(before.size, in: geometry.size)
            let afterWidth = frame.height * after.size.width / max(1, after.size.height)
            ZStack {
                if showBefore {
                    Image(uiImage: before).resizable().frame(width: frame.width, height: frame.height)
                }
                ZStack {
                    Image(uiImage: after)
                        .resizable()
                        .frame(width: afterWidth, height: frame.height)
                        .scaleEffect(transform.scale)
                        .rotationEffect(.degrees(transform.rotationDeg))
                        .offset(x: transform.translateX * frame.height, y: transform.translateY * frame.height)
                }
                .frame(width: frame.width, height: frame.height)
                .clipped()
                .opacity(afterOpacity)
                .mask(alignment: .trailing) {
                    Rectangle().frame(width: frame.width * (1 - (reveal ?? 0)))
                }
            }
            .frame(width: frame.width, height: frame.height)
            .clipped()
            .position(x: frame.midX, y: frame.midY)
        }
        .accessibilityHidden(true)
    }
}

/// Pinch to zoom, drag to pan and double tap to reset, on one pane.
struct ZoomPan: ViewModifier {
    @Binding var viewport: Viewport
    @State private var base: Viewport?

    func body(content: Content) -> some View {
        content
            .scaleEffect(viewport.zoom)
            .offset(viewport.pan)
            .contentShape(Rectangle())
            .gesture(
                SimultaneousGesture(
                    MagnifyGesture()
                        .onChanged { value in
                            let start = base ?? viewport
                            base = start
                            viewport.zoom = min(Viewport.maxZoom, max(1, start.zoom * value.magnification))
                        }
                        .onEnded { _ in base = nil },
                    DragGesture()
                        .onChanged { value in
                            let start = base ?? viewport
                            base = start
                            viewport.pan = CGSize(width: start.pan.width + value.translation.width,
                                                  height: start.pan.height + value.translation.height)
                        }
                        .onEnded { _ in base = nil }
                )
            )
            .onTapGesture(count: 2) { viewport = Viewport() }
    }
}

public struct ComparisonViewer: View {
    let before: UIImage
    let after: UIImage
    let transform: SimilarityTransform
    @Binding var mode: ComparisonMode
    @State private var panes = PaneViewports()
    @State private var divider: CGFloat = 0.5
    @State private var fade: Double = 0.5
    @State private var opacity: Double = 0.5
    @State private var rate: Double = 1
    @State private var blinking = false
    @State private var showingAfter = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Blink never changes more than 3 times a second (WCAG 2.3.1).
    nonisolated static let maxBlinkRate = 3.0

    public init(before: UIImage, after: UIImage, transform: SimilarityTransform, mode: Binding<ComparisonMode>) {
        self.before = before
        self.after = after
        self.transform = transform
        _mode = mode
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            modeBar
            stage
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(DSColor.photoStage, in: RoundedRectangle(cornerRadius: DSRadius.md))
                .clipShape(RoundedRectangle(cornerRadius: DSRadius.md))
                // A container, so the swipe divider inside stays adjustable.
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Before and after comparison, \(mode.title)"))
                .accessibilityIdentifier("comparison.viewer")
            controls
        }
        .onChange(of: mode) { blinking = false }
        .task(id: BlinkKey(on: blinking && mode == .blink, rate: rate)) { await blink() }
    }

    /// The modes as buttons that scroll sideways, so no title is cut at any text size.
    private var modeBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DSSpacing.xs) {
                ForEach(ComparisonMode.allCases) { item in
                    Button {
                        mode = item
                    } label: {
                        Label(item.title, systemImage: item.systemImage)
                            .font(DSFont.subheadline.weight(mode == item ? .semibold : .regular))
                            .padding(.horizontal, DSSpacing.md)
                            .frame(minHeight: DSSize.touchTarget)
                            .foregroundStyle(mode == item ? DSColor.accentText : DSColor.textSecondary)
                            .background(mode == item ? DSColor.accentSoft : DSColor.surface, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(mode == item ? .isSelected : [])
                    .accessibilityIdentifier("comparison.mode.\(item.rawValue)")
                }
            }
        }
    }

    private struct BlinkKey: Equatable {
        let on: Bool
        let rate: Double
    }

    @ViewBuilder private var stage: some View {
        switch mode {
        case .sideBySide:
            GeometryReader { geometry in
                let layout = geometry.size.width >= geometry.size.height
                    ? AnyLayout(HStackLayout(spacing: DSSpacing.xs))
                    : AnyLayout(VStackLayout(spacing: DSSpacing.xs))
                layout {
                    pane(label: String(localized: "Before"), viewport: binding(.before)) {
                        Image(uiImage: before).resizable().scaledToFit()
                    }
                    pane(label: String(localized: "After"), viewport: binding(.after)) {
                        AlignedPair(before: before, after: after, transform: transform, showBefore: false)
                    }
                }
            }
        case .swipe:
            GeometryReader { geometry in
                let frame = fittedFrame(before.size, in: geometry.size)
                let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
                // The divider follows the zoomed and panned photo: scale about the centre, then pan.
                let viewport = panes.viewport(.before)
                let screenX = center.x + (frame.minX + frame.width * divider - center.x) * viewport.zoom + viewport.pan.width
                let screenY = center.y + (frame.midY - center.y) * viewport.zoom + viewport.pan.height
                ZStack(alignment: .topLeading) {
                    AlignedPair(before: before, after: after, transform: transform, reveal: divider)
                        .modifier(ZoomPan(viewport: binding(.before)))
                    Rectangle()
                        .fill(DSColor.photoStageText)
                        .frame(width: DSSpacing.xxs, height: frame.height * viewport.zoom)
                        .overlay {
                            Circle().fill(DSColor.photoStageText).frame(width: DSSize.touchTarget, height: DSSize.touchTarget)
                                .overlay(Image(systemName: "arrow.left.and.right").foregroundStyle(DSColor.photoStage))
                        }
                        .frame(width: DSSize.touchTarget)
                        .contentShape(Rectangle())
                        .highPriorityGesture(DragGesture(coordinateSpace: .named("swipe")).onChanged { value in
                            guard frame.width > 0 else { return }
                            let x = (value.location.x - viewport.pan.width - center.x) / viewport.zoom + center.x
                            divider = min(1, max(0, (x - frame.minX) / frame.width))
                        })
                        .accessibilityElement()
                        .accessibilityLabel(Text("Divider"))
                        .accessibilityValue(Text("\(Int(divider * 100)) percent"))
                        .accessibilityAdjustableAction { direction in
                            switch direction {
                            case .increment: divider = min(1, divider + 0.05)
                            case .decrement: divider = max(0, divider - 0.05)
                            @unknown default: break
                            }
                        }
                        .accessibilityIdentifier("comparison.divider")
                        .position(x: screenX, y: screenY)
                    labels
                }
                .coordinateSpace(.named("swipe"))
            }
        case .crossFade:
            AlignedPair(before: before, after: after, transform: transform, afterOpacity: fade)
                .modifier(ZoomPan(viewport: binding(.before)))
        case .blink:
            AlignedPair(before: before, after: after, transform: transform, afterOpacity: showingAfter ? 1 : 0)
                .modifier(ZoomPan(viewport: binding(.before)))
                .overlay(alignment: .topLeading) {
                    DSBadge(showingAfter ? String(localized: "After") : String(localized: "Before"))
                        .padding(DSSpacing.sm)
                }
        case .overlay:
            AlignedPair(before: before, after: after, transform: transform, afterOpacity: opacity)
                .modifier(ZoomPan(viewport: binding(.before)))
        }
    }

    private func binding(_ pane: PaneViewports.Pane) -> Binding<Viewport> {
        Binding(get: { panes.viewport(pane) }, set: { panes.set($0, for: pane) })
    }

    private var labels: some View {
        HStack {
            DSBadge(String(localized: "Before"))
            Spacer()
            DSBadge(String(localized: "After"))
        }
        .padding(DSSpacing.sm)
        .allowsHitTesting(false)
    }

    private func pane<Content: View>(label: String, viewport: Binding<Viewport>, @ViewBuilder content: () -> Content) -> some View {
        content()
            .modifier(ZoomPan(viewport: viewport))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
            .overlay(alignment: .topLeading) {
                DSBadge(label).padding(DSSpacing.sm).allowsHitTesting(false)
            }
    }

    @ViewBuilder private var controls: some View {
        switch mode {
        case .sideBySide:
            Toggle("Zoom both together", isOn: Binding(get: { panes.linked }, set: { panes.link($0) }))
                .font(DSFont.subheadline)
                .accessibilityIdentifier("comparison.link")
        case .swipe:
            EmptyView()
        case .crossFade:
            slider(String(localized: "Before to after"), value: $fade, id: "comparison.fade")
        case .blink:
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                HStack(spacing: DSSpacing.sm) {
                    Button(blinking ? String(localized: "Pause") : String(localized: "Play"),
                           systemImage: blinking ? "pause.fill" : "play.fill") { blinking.toggle() }
                        .buttonStyle(DSButtonStyle(.secondary))
                        .accessibilityIdentifier("comparison.blink")
                    Button("Switch", systemImage: "arrow.left.arrow.right") { showingAfter.toggle() }
                        .buttonStyle(DSButtonStyle(.secondary))
                        .disabled(blinking)
                        .accessibilityIdentifier("comparison.switch")
                }
                HStack {
                    Text("Speed").font(DSFont.subheadline).foregroundStyle(DSColor.textSecondary)
                    Slider(value: $rate, in: 0.5...Self.maxBlinkRate, step: 0.5)
                        .accessibilityValue(Text("\(rate, specifier: "%.1f") changes a second"))
                        .accessibilityIdentifier("comparison.rate")
                }
                if reduceMotion {
                    Text("Blink alternates the photos; use Switch to change them yourself.")
                        .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                }
            }
        case .overlay:
            slider(String(localized: "After photo opacity"), value: $opacity, id: "comparison.opacity")
        }
        Button("Reset view", systemImage: "arrow.counterclockwise") {
            panes.reset()
        }
        .font(DSFont.subheadline)
        .accessibilityIdentifier("comparison.reset")
    }

    private func slider(_ title: String, value: Binding<Double>, id: String) -> some View {
        HStack {
            Text(title).font(DSFont.subheadline).foregroundStyle(DSColor.textSecondary)
            Slider(value: value, in: 0...1)
                .accessibilityLabel(Text(title))
                .accessibilityValue(Text("\(Int(value.wrappedValue * 100)) percent"))
                .accessibilityIdentifier(id)
        }
    }

    /// Alternates the photos while blinking, at most `maxBlinkRate` times a second.
    private func blink() async {
        guard blinking, mode == .blink else { return }
        let interval = 1 / min(Self.maxBlinkRate, max(0.5, rate))
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(interval))
            if Task.isCancelled { return }
            showingAfter.toggle()
        }
    }
}
