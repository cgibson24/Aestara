// Annotation layers (Bible §5.1 "Annotate if needed", §6.6; spec §6.3
// "Photography"; ADR-0026 K3-10). A layer is version 1 vector JSON drawn over
// the upright photo, in coordinates from 0 to 1: shapes, a fixed palette of
// design-token colours, fixed stroke widths and text sizes. There are no
// measurement tools: no lengths, areas or angles. The original is never
// touched; a layer reaches pixels only in an export. These types encode
// exactly the contract's JSON.
// Bible §6.6 · tier: feature · Layer 3.
import DesignSystem
import Foundation
import SwiftUI

/// The annotation palette (design tokens `annotation`).
public enum AnnotationColorName: String, Sendable, Codable, CaseIterable, Identifiable, Hashable {
    case red = "RED"
    case yellow = "YELLOW"
    case green = "GREEN"
    case blue = "BLUE"
    case white = "WHITE"
    case black = "BLACK"

    public var id: String { rawValue }

    public var color: Color {
        switch self {
        case .red: DSAnnotationColor.red
        case .yellow: DSAnnotationColor.yellow
        case .green: DSAnnotationColor.green
        case .blue: DSAnnotationColor.blue
        case .white: DSAnnotationColor.white
        case .black: DSAnnotationColor.black
        }
    }

    public var title: String {
        switch self {
        case .red: "Red"
        case .yellow: "Yellow"
        case .green: "Green"
        case .blue: "Blue"
        case .white: "White"
        case .black: "Black"
        }
    }
}

/// Stroke widths as a fraction of the photo's height, so a layer draws the same at any size.
public enum AnnotationStrokeWidth: String, Sendable, Codable, CaseIterable, Identifiable, Hashable {
    case thin = "THIN"
    case medium = "MEDIUM"
    case thick = "THICK"

    public var id: String { rawValue }

    public var fractionOfHeight: Double {
        switch self {
        case .thin: 0.002
        case .medium: 0.004
        case .thick: 0.008
        }
    }

    public var title: String {
        switch self {
        case .thin: "Thin"
        case .medium: "Medium"
        case .thick: "Thick"
        }
    }
}

/// Text sizes as a fraction of the photo's height.
public enum AnnotationTextSize: String, Sendable, Codable, CaseIterable, Identifiable, Hashable {
    case small = "SMALL"
    case medium = "MEDIUM"
    case large = "LARGE"

    public var id: String { rawValue }

    public var fractionOfHeight: Double {
        switch self {
        case .small: 0.02
        case .medium: 0.03
        case .large: 0.045
        }
    }

    public var title: String {
        switch self {
        case .small: "Small"
        case .medium: "Medium"
        case .large: "Large"
        }
    }
}

/// A point on the upright photo: x and y from 0 (left, top) to 1 (right, bottom). On the wire, `[x, y]`.
public struct NormalizedPoint: Sendable, Equatable, Hashable, Codable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = min(1, max(0, x))
        self.y = min(1, max(0, y))
    }

    public init(from decoder: any Decoder) throws {
        var container = try decoder.unkeyedContainer()
        self.init(x: try container.decode(Double.self), y: try container.decode(Double.self))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(x)
        try container.encode(y)
    }
}

/// The contract's limits (ADR-0026 K3-10).
public enum AnnotationLimits {
    public static let maxShapes = 500
    public static let maxBytes = 256 * 1024
    public static let maxFreehandPoints = 2000
    public static let maxTextLength = 200
    public static let maxLabelLength = 80
}

public enum AnnotationShape: Sendable, Equatable, Hashable {
    case freehand(points: [NormalizedPoint], color: AnnotationColorName, stroke: AnnotationStrokeWidth)
    case line(from: NormalizedPoint, to: NormalizedPoint, color: AnnotationColorName, stroke: AnnotationStrokeWidth)
    case arrow(from: NormalizedPoint, to: NormalizedPoint, color: AnnotationColorName, stroke: AnnotationStrokeWidth)
    /// Radii as fractions of the photo's width and height.
    case ellipse(center: NormalizedPoint, radiusX: Double, radiusY: Double, color: AnnotationColorName, stroke: AnnotationStrokeWidth)
    /// The top-left corner, and the size as fractions of the photo's width and height.
    case rectangle(origin: NormalizedPoint, width: Double, height: Double, color: AnnotationColorName, stroke: AnnotationStrokeWidth)
    /// The top-left of the text.
    case text(position: NormalizedPoint, text: String, color: AnnotationColorName, size: AnnotationTextSize)

    public var color: AnnotationColorName {
        switch self {
        case let .freehand(_, color, _), let .line(_, _, color, _), let .arrow(_, _, color, _),
             let .ellipse(_, _, _, color, _), let .rectangle(_, _, _, color, _), let .text(_, _, color, _):
            color
        }
    }
}

extension AnnotationShape: Codable {
    private enum CodingKeys: String, CodingKey {
        case type, points, from, to, center, radiusX, radiusY, origin, size, position, text, color, stroke
    }

    /// The rectangle's `size`: `[width, height]` on the wire.
    private struct Extent: Codable {
        let width: Double
        let height: Double

        init(width: Double, height: Double) {
            self.width = width
            self.height = height
        }

        init(from decoder: any Decoder) throws {
            var container = try decoder.unkeyedContainer()
            width = try container.decode(Double.self)
            height = try container.decode(Double.self)
        }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.unkeyedContainer()
            try container.encode(width)
            try container.encode(height)
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "FREEHAND":
            self = .freehand(points: try c.decode([NormalizedPoint].self, forKey: .points),
                             color: try c.decode(AnnotationColorName.self, forKey: .color),
                             stroke: try c.decode(AnnotationStrokeWidth.self, forKey: .stroke))
        case "LINE":
            self = .line(from: try c.decode(NormalizedPoint.self, forKey: .from), to: try c.decode(NormalizedPoint.self, forKey: .to),
                         color: try c.decode(AnnotationColorName.self, forKey: .color),
                         stroke: try c.decode(AnnotationStrokeWidth.self, forKey: .stroke))
        case "ARROW":
            self = .arrow(from: try c.decode(NormalizedPoint.self, forKey: .from), to: try c.decode(NormalizedPoint.self, forKey: .to),
                          color: try c.decode(AnnotationColorName.self, forKey: .color),
                          stroke: try c.decode(AnnotationStrokeWidth.self, forKey: .stroke))
        case "ELLIPSE":
            self = .ellipse(center: try c.decode(NormalizedPoint.self, forKey: .center),
                            radiusX: try c.decode(Double.self, forKey: .radiusX), radiusY: try c.decode(Double.self, forKey: .radiusY),
                            color: try c.decode(AnnotationColorName.self, forKey: .color),
                            stroke: try c.decode(AnnotationStrokeWidth.self, forKey: .stroke))
        case "RECTANGLE":
            let extent = try c.decode(Extent.self, forKey: .size)
            self = .rectangle(origin: try c.decode(NormalizedPoint.self, forKey: .origin), width: extent.width, height: extent.height,
                              color: try c.decode(AnnotationColorName.self, forKey: .color),
                              stroke: try c.decode(AnnotationStrokeWidth.self, forKey: .stroke))
        case "TEXT":
            self = .text(position: try c.decode(NormalizedPoint.self, forKey: .position), text: try c.decode(String.self, forKey: .text),
                         color: try c.decode(AnnotationColorName.self, forKey: .color),
                         size: try c.decode(AnnotationTextSize.self, forKey: .size))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unknown annotation shape")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .freehand(points, color, stroke):
            try c.encode("FREEHAND", forKey: .type)
            try c.encode(points, forKey: .points)
            try c.encode(color, forKey: .color)
            try c.encode(stroke, forKey: .stroke)
        case let .line(from, to, color, stroke):
            try c.encode("LINE", forKey: .type)
            try c.encode(from, forKey: .from)
            try c.encode(to, forKey: .to)
            try c.encode(color, forKey: .color)
            try c.encode(stroke, forKey: .stroke)
        case let .arrow(from, to, color, stroke):
            try c.encode("ARROW", forKey: .type)
            try c.encode(from, forKey: .from)
            try c.encode(to, forKey: .to)
            try c.encode(color, forKey: .color)
            try c.encode(stroke, forKey: .stroke)
        case let .ellipse(center, radiusX, radiusY, color, stroke):
            try c.encode("ELLIPSE", forKey: .type)
            try c.encode(center, forKey: .center)
            try c.encode(radiusX, forKey: .radiusX)
            try c.encode(radiusY, forKey: .radiusY)
            try c.encode(color, forKey: .color)
            try c.encode(stroke, forKey: .stroke)
        case let .rectangle(origin, width, height, color, stroke):
            try c.encode("RECTANGLE", forKey: .type)
            try c.encode(origin, forKey: .origin)
            try c.encode(Extent(width: width, height: height), forKey: .size)
            try c.encode(color, forKey: .color)
            try c.encode(stroke, forKey: .stroke)
        case let .text(position, text, color, size):
            try c.encode("TEXT", forKey: .type)
            try c.encode(position, forKey: .position)
            try c.encode(text, forKey: .text)
            try c.encode(color, forKey: .color)
            try c.encode(size, forKey: .size)
        }
    }
}

/// One layer's drawing: `{ "schemaVersion": 1, "shapes": [...] }`.
public struct AnnotationDrawing: Sendable, Equatable, Hashable, Codable {
    public let schemaVersion: Int
    public var shapes: [AnnotationShape]

    public init(shapes: [AnnotationShape] = []) {
        schemaVersion = 1
        self.shapes = shapes
    }

    /// The JSON size the server checks against 256 KiB.
    public var encodedSize: Int {
        (try? JSONEncoder().encode(self).count) ?? Int.max
    }

    /// Within the contract's limits.
    public var isWithinLimits: Bool {
        shapes.count <= AnnotationLimits.maxShapes && encodedSize <= AnnotationLimits.maxBytes
    }
}

/// A layer as the server holds it.
public struct AnnotationLayerItem: Sendable, Equatable, Identifiable, Codable {
    public let id: String
    public let photoId: String
    public let authorUserId: String
    public let label: String?
    public let drawing: AnnotationDrawing
    public let updatedAt: Date
    /// 0 for a layer drawn offline and not yet sent.
    public let version: Int

    public init(id: String, photoId: String, authorUserId: String, label: String?, drawing: AnnotationDrawing,
                updatedAt: Date, version: Int) {
        self.id = id
        self.photoId = photoId
        self.authorUserId = authorUserId
        self.label = label
        self.drawing = drawing
        self.updatedAt = updatedAt
        self.version = version
    }
}
