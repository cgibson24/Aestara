// Drawing annotation layers over a photo on screen (ADR-0026 K3-10;
// ADR-0027): SwiftUI `Canvas`, the same geometry as the export renderer in
// image-processing, so a layer looks the same on screen and in an export.
// Shapes are drawn in the photo's frame; strokes and text scale with its
// height. The photo itself is only displayed.
// Bible §6.6 · tier: feature · Layer 3.
import SwiftUI
import UIKit

public enum AnnotationRenderer {
    /// Where an image of `imageSize` sits when fitted into `container`, centred.
    public static func fittedRect(imageSize: CGSize, in container: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, container.width > 0, container.height > 0 else { return .zero }
        let scale = min(container.width / imageSize.width, container.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(x: (container.width - size.width) / 2, y: (container.height - size.height) / 2,
                      width: size.width, height: size.height)
    }

    public static func point(_ p: NormalizedPoint, in rect: CGRect) -> CGPoint {
        CGPoint(x: rect.minX + p.x * rect.width, y: rect.minY + p.y * rect.height)
    }

    /// The normalized point under a location on screen, clamped to the photo.
    public static func normalized(_ location: CGPoint, in rect: CGRect) -> NormalizedPoint {
        guard rect.width > 0, rect.height > 0 else { return NormalizedPoint(x: 0, y: 0) }
        return NormalizedPoint(x: (location.x - rect.minX) / rect.width, y: (location.y - rect.minY) / rect.height)
    }

    public static func draw(_ shapes: [AnnotationShape], in rect: CGRect, context: GraphicsContext) {
        for shape in shapes { draw(shape, in: rect, context: context) }
    }

    public static func draw(_ shape: AnnotationShape, in rect: CGRect, context: GraphicsContext) {
        let at = { (p: NormalizedPoint) in point(p, in: rect) }
        let width = { (stroke: AnnotationStrokeWidth) in max(1, stroke.fractionOfHeight * rect.height) }
        let style = { (stroke: AnnotationStrokeWidth) in
            StrokeStyle(lineWidth: width(stroke), lineCap: .round, lineJoin: .round)
        }
        switch shape {
        case let .freehand(points, color, stroke):
            var path = Path()
            path.addLines(points.map(at))
            context.stroke(path, with: .color(color.color), style: style(stroke))
        case let .line(from, to, color, stroke):
            var path = Path()
            path.move(to: at(from))
            path.addLine(to: at(to))
            context.stroke(path, with: .color(color.color), style: style(stroke))
        case let .arrow(from, to, color, stroke):
            let start = at(from)
            let end = at(to)
            var path = Path()
            path.move(to: start)
            path.addLine(to: end)
            // The head as the export draws it: two strokes at 45°, 30% of the length at most.
            let length = max(1, hypot(end.x - start.x, end.y - start.y))
            let tip = min(0.3 * length, 6 * width(stroke))
            let angle = atan2(end.y - start.y, end.x - start.x)
            for turn in [Double.pi / 4, -Double.pi / 4] {
                let back = angle + .pi + turn
                path.move(to: end)
                path.addLine(to: CGPoint(x: end.x + tip * cos(back), y: end.y + tip * sin(back)))
            }
            context.stroke(path, with: .color(color.color), style: style(stroke))
        case let .ellipse(center, radiusX, radiusY, color, stroke):
            let c = at(center)
            let rx = radiusX * rect.width
            let ry = radiusY * rect.height
            let path = Path(ellipseIn: CGRect(x: c.x - rx, y: c.y - ry, width: 2 * rx, height: 2 * ry))
            context.stroke(path, with: .color(color.color), style: style(stroke))
        case let .rectangle(origin, w, h, color, stroke):
            let o = at(origin)
            let path = Path(CGRect(x: o.x, y: o.y, width: w * rect.width, height: h * rect.height))
            context.stroke(path, with: .color(color.color), style: StrokeStyle(lineWidth: width(stroke), lineJoin: .miter))
        case let .text(position, text, color, size):
            // Sized as a fraction of the photo's height, like the export: part of the drawing,
            // not interface type, so it does not follow the type scale.
            let label = Text(text)
                .font(.system(size: max(1, size.fractionOfHeight * rect.height)))
                .foregroundStyle(color.color)
            context.draw(label, at: at(position), anchor: .topLeading)
        }
    }
}

/// A photo with annotation layers drawn over it. Display only.
public struct AnnotatedImage: View {
    let image: UIImage
    let drawings: [AnnotationDrawing]

    public init(image: UIImage, drawings: [AnnotationDrawing]) {
        self.image = image
        self.drawings = drawings
    }

    public var body: some View {
        GeometryReader { geometry in
            let rect = AnnotationRenderer.fittedRect(imageSize: image.size, in: geometry.size)
            ZStack(alignment: .topLeading) {
                Image(uiImage: image)
                    .resizable()
                    .frame(width: rect.width, height: rect.height)
                    .offset(x: rect.minX, y: rect.minY)
                    .accessibilityHidden(true)
                Canvas { context, _ in
                    for drawing in drawings { AnnotationRenderer.draw(drawing.shapes, in: rect, context: context) }
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
    }
}
