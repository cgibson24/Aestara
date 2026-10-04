// Drawing one's own annotation layer (Bible §5.1, §6.6; ADR-0026 K3-10;
// ADR-0027): freehand, line, arrow, ellipse, rectangle and text, in the
// palette's colours and the fixed widths and sizes, drawn with a finger or
// Apple Pencil through drag gestures; no measurement tools. Other layers show
// beneath, unchanged. The photo is only displayed.
// Bible §6.6 · tier: feature · Layer 3.
import DesignSystem
import SwiftUI
import UIKit

public enum AnnotationTool: String, CaseIterable, Identifiable, Sendable {
    case freehand, line, arrow, ellipse, rectangle, text

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .freehand: "Draw"
        case .line: "Line"
        case .arrow: "Arrow"
        case .ellipse: "Ellipse"
        case .rectangle: "Rectangle"
        case .text: "Text"
        }
    }

    public var systemImage: String {
        switch self {
        case .freehand: "scribble"
        case .line: "line.diagonal"
        case .arrow: "arrow.up.right"
        case .ellipse: "circle"
        case .rectangle: "rectangle"
        case .text: "textformat"
        }
    }
}

public struct AnnotationEditor: View {
    let image: UIImage
    /// Other visible layers, drawn beneath and never changed here.
    let beneath: [AnnotationDrawing]
    @Binding var drawing: AnnotationDrawing
    @State private var tool: AnnotationTool = .freehand
    @State private var color: AnnotationColorName = .yellow
    @State private var stroke: AnnotationStrokeWidth = .medium
    @State private var textSize: AnnotationTextSize = .medium
    /// The shape being drawn, until the finger or pencil lifts.
    @State private var current: AnnotationShape?
    @State private var dragStart: NormalizedPoint?
    @State private var freehandPoints: [NormalizedPoint] = []
    @State private var textAt: NormalizedPoint?
    @State private var text = ""

    public init(image: UIImage, beneath: [AnnotationDrawing], drawing: Binding<AnnotationDrawing>) {
        self.image = image
        self.beneath = beneath
        _drawing = drawing
    }

    private var full: Bool { drawing.shapes.count >= AnnotationLimits.maxShapes }

    public var body: some View {
        VStack(spacing: DSSpacing.md) {
            tools
            GeometryReader { geometry in
                let rect = AnnotationRenderer.fittedRect(imageSize: image.size, in: geometry.size)
                ZStack(alignment: .topLeading) {
                    DSColor.photoStage
                    Image(uiImage: image)
                        .resizable()
                        .frame(width: rect.width, height: rect.height)
                        .offset(x: rect.minX, y: rect.minY)
                        .accessibilityHidden(true)
                    Canvas { context, _ in
                        for layer in beneath { AnnotationRenderer.draw(layer.shapes, in: rect, context: context) }
                        AnnotationRenderer.draw(drawing.shapes, in: rect, context: context)
                        if let current { AnnotationRenderer.draw(current, in: rect, context: context) }
                    }
                    .contentShape(Rectangle())
                    .gesture(drag(in: rect), including: full ? .subviews : .all)
                    .accessibilityElement()
                    .accessibilityLabel(Text("Drawing area"))
                    .accessibilityValue(Text(drawing.shapes.count == 1 ? "1 shape" : "\(drawing.shapes.count) shapes"))
                    .accessibilityHint(Text("Drag to draw with the chosen tool."))
                    .accessibilityIdentifier("annotation.canvas")
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: DSRadius.md))
            if full {
                Text("This layer holds the most shapes allowed. Start another layer to draw more.")
                    .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            }
        }
        .alert("Add text", isPresented: Binding(get: { textAt != nil }, set: { if !$0 { textAt = nil } })) {
            TextField("Text", text: $text)
                .accessibilityIdentifier("annotation.textField")
            Button("Add") { addText() }
                .accessibilityIdentifier("annotation.textAdd")
            Button("Cancel", role: .cancel) { text = "" }
        } message: {
            Text("At most \(AnnotationLimits.maxTextLength) characters.")
        }
    }

    private var tools: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DSSpacing.sm) {
                ForEach(AnnotationTool.allCases) { item in
                    Button {
                        tool = item
                    } label: {
                        Image(systemName: item.systemImage)
                            .font(DSFont.headline)
                            .frame(width: DSSize.touchTarget, height: DSSize.touchTarget)
                            .foregroundStyle(tool == item ? DSColor.accentText : DSColor.textPrimary)
                            .background(tool == item ? DSColor.accentSoft : DSColor.surface,
                                        in: RoundedRectangle(cornerRadius: DSRadius.sm))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(item.title))
                    .accessibilityAddTraits(tool == item ? .isSelected : [])
                    .accessibilityIdentifier("annotation.tool.\(item.rawValue)")
                }
                Divider().frame(height: DSSize.touchTarget)
                ForEach(AnnotationColorName.allCases) { item in
                    Button {
                        color = item
                    } label: {
                        Circle()
                            .fill(item.color)
                            .overlay(Circle().stroke(DSColor.controlBorder))
                            .frame(width: DSSize.iconLg, height: DSSize.iconLg)
                            .padding(DSSpacing.xs)
                            .overlay(Circle().stroke(color == item ? DSColor.accent : .clear, lineWidth: DSSpacing.xxs))
                            .frame(width: DSSize.touchTarget, height: DSSize.touchTarget)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(item.title))
                    .accessibilityAddTraits(color == item ? .isSelected : [])
                    .accessibilityIdentifier("annotation.color.\(item.rawValue)")
                }
                Divider().frame(height: DSSize.touchTarget)
                if tool == .text {
                    Picker("Text size", selection: $textSize) {
                        ForEach(AnnotationTextSize.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.menu)
                    .accessibilityIdentifier("annotation.textSize")
                } else {
                    Picker("Line width", selection: $stroke) {
                        ForEach(AnnotationStrokeWidth.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.menu)
                    .accessibilityIdentifier("annotation.stroke")
                }
                Button("Undo", systemImage: "arrow.uturn.backward") {
                    if !drawing.shapes.isEmpty { drawing.shapes.removeLast() }
                }
                .labelStyle(.iconOnly)
                .frame(minWidth: DSSize.touchTarget, minHeight: DSSize.touchTarget)
                .disabled(drawing.shapes.isEmpty)
                .accessibilityIdentifier("annotation.undo")
            }
            .padding(.horizontal, DSSpacing.xs)
        }
    }

    private func drag(in rect: CGRect) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                let point = AnnotationRenderer.normalized(value.location, in: rect)
                if dragStart == nil {
                    dragStart = AnnotationRenderer.normalized(value.startLocation, in: rect)
                    freehandPoints = [dragStart ?? point]
                }
                guard let start = dragStart, tool != .text else { return }
                current = shape(from: start, to: point)
            }
            .onEnded { value in
                let point = AnnotationRenderer.normalized(value.location, in: rect)
                let start = dragStart ?? point
                dragStart = nil
                defer {
                    current = nil
                    freehandPoints = []
                }
                if tool == .text {
                    text = ""
                    textAt = point
                    return
                }
                guard let shape = shape(from: start, to: point), isVisible(shape) else { return }
                var next = drawing
                next.shapes.append(shape)
                if next.isWithinLimits { drawing = next }
            }
    }

    /// The shape between where the drag started and where it is now.
    private func shape(from start: NormalizedPoint, to end: NormalizedPoint) -> AnnotationShape? {
        switch tool {
        case .freehand:
            if let last = freehandPoints.last, hypot(end.x - last.x, end.y - last.y) >= 0.002,
               freehandPoints.count < AnnotationLimits.maxFreehandPoints {
                freehandPoints.append(end)
            }
            return freehandPoints.count >= 2 ? .freehand(points: freehandPoints, color: color, stroke: stroke) : nil
        case .line:
            return .line(from: start, to: end, color: color, stroke: stroke)
        case .arrow:
            return .arrow(from: start, to: end, color: color, stroke: stroke)
        case .ellipse:
            return .ellipse(center: NormalizedPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2),
                            radiusX: abs(end.x - start.x) / 2, radiusY: abs(end.y - start.y) / 2, color: color, stroke: stroke)
        case .rectangle:
            return .rectangle(origin: NormalizedPoint(x: min(start.x, end.x), y: min(start.y, end.y)),
                              width: abs(end.x - start.x), height: abs(end.y - start.y), color: color, stroke: stroke)
        case .text:
            return nil
        }
    }

    /// A tap is not a shape: lines need a length, and ellipses and rectangles an area.
    private func isVisible(_ shape: AnnotationShape) -> Bool {
        let minimum = 0.005
        switch shape {
        case let .freehand(points, _, _):
            return points.count >= 2
        case let .line(from, to, _, _), let .arrow(from, to, _, _):
            return hypot(to.x - from.x, to.y - from.y) >= minimum
        case let .ellipse(_, rx, ry, _, _):
            return rx >= minimum && ry >= minimum
        case let .rectangle(_, w, h, _, _):
            return w >= minimum && h >= minimum
        case .text:
            return true
        }
    }

    private func addText() {
        let value = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(AnnotationLimits.maxTextLength))
        defer {
            text = ""
            textAt = nil
        }
        guard let position = textAt, !value.isEmpty else { return }
        var next = drawing
        next.shapes.append(.text(position: position, text: value, color: color, size: textSize))
        if next.isWithinLimits { drawing = next }
    }
}
