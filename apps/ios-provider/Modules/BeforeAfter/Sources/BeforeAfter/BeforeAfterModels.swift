// Before/after sets (Bible §8; spec §6.3 "Before / after"; ADR-0026 K3-11 to
// K3-13). A set pairs two accepted photos of the same view, the before one
// captured earlier, with an optional alignment: a similarity transform only
// (uniform scale, rotation, translation), so alignment never reshapes
// anatomy. Comparison is display only; the originals never change, and a
// comparison is never a promise of any outcome.
// Bible §8 · tier: feature · Layer 3.
import Foundation

public enum RegistrationModeValue: String, Sendable, Equatable, Hashable {
    case none = "NONE"
    case automatic = "AUTOMATIC"
    case manual = "MANUAL"

    public var title: String {
        switch self {
        case .none: "Not aligned"
        case .automatic: "Aligned automatically"
        case .manual: "Aligned by hand"
        }
    }
}

/// Places the after image over the before image. Units are the before image's height, the origin
/// its centre, x right and y down: the after image is scaled to the before image's height and
/// centred, then scaled by `scale`, rotated by `rotationDeg` (clockwise) and moved.
public struct SimilarityTransform: Sendable, Equatable, Hashable, Codable {
    public var scale: Double
    public var rotationDeg: Double
    public var translateX: Double
    public var translateY: Double

    public static let identity = SimilarityTransform(scale: 1, rotationDeg: 0, translateX: 0, translateY: 0)

    public static let scaleRange = 0.25...4.0
    public static let rotationRange = -180.0...180.0
    public static let translateRange = -2.0...2.0

    public init(scale: Double, rotationDeg: Double, translateX: Double, translateY: Double) {
        self.scale = scale
        self.rotationDeg = rotationDeg
        self.translateX = translateX
        self.translateY = translateY
    }

    /// Within the contract's limits.
    public var clamped: SimilarityTransform {
        SimilarityTransform(
            scale: min(Self.scaleRange.upperBound, max(Self.scaleRange.lowerBound, scale)),
            rotationDeg: min(Self.rotationRange.upperBound, max(Self.rotationRange.lowerBound, rotationDeg)),
            translateX: min(Self.translateRange.upperBound, max(Self.translateRange.lowerBound, translateX)),
            translateY: min(Self.translateRange.upperBound, max(Self.translateRange.lowerBound, translateY))
        )
    }
}

/// The latest automatic registration requested for a set.
public struct RegistrationJobState: Sendable, Equatable, Hashable {
    /// QUEUED, RUNNING, SUCCEEDED or FAILED.
    public let status: String
    /// NO_RELIABLE_ALIGNMENT or PROCESSING_FAILED.
    public let failure: String?

    public var isRunning: Bool { status == "QUEUED" || status == "RUNNING" }

    public var failureMessage: String? {
        guard status == "FAILED" else { return nil }
        return failure == "NO_RELIABLE_ALIGNMENT"
            ? "No reliable alignment found. The set is unchanged; you can align it by hand."
            : "Automatic alignment could not run. The set is unchanged."
    }
}

public struct BeforeAfterSetItem: Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    public let beforePhotoId: String
    public let afterPhotoId: String
    public let consultationId: String?
    public let viewKey: String?
    public let title: String?
    public let mode: RegistrationModeValue
    public let transform: SimilarityTransform?
    public let job: RegistrationJobState?
    public let createdAt: Date
    public let version: Int

    /// The transform the viewer applies: none until the set is aligned.
    public var effectiveTransform: SimilarityTransform { mode == .none ? .identity : (transform ?? .identity) }
}

/// The comparison modes (ADR-0026 K3-12).
public enum ComparisonMode: String, CaseIterable, Identifiable, Sendable {
    case sideBySide, swipe, crossFade, blink, overlay

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .sideBySide: "Side by side"
        case .swipe: "Swipe"
        case .crossFade: "Cross-fade"
        case .blink: "Blink"
        case .overlay: "Overlay"
        }
    }

    public var systemImage: String {
        switch self {
        case .sideBySide: "rectangle.split.2x1"
        case .swipe: "slider.horizontal.below.rectangle"
        case .crossFade: "circle.lefthalf.filled"
        case .blink: "eye"
        case .overlay: "square.on.square"
        }
    }
}

/// A photo that can join a set, as the shell describes it.
public struct ComparisonPhoto: Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    public let viewKey: String?
    public let capturedAt: Date

    public init(id: String, viewKey: String?, capturedAt: Date) {
        self.id = id
        self.viewKey = viewKey
        self.capturedAt = capturedAt
    }
}

/// What the shell lends the comparison screens: the patient's photos and their images, loaded
/// through the photography module so every view is audited (PHOTO_VIEWED) and cached as there.
public struct ComparisonSources: Sendable {
    /// The patient's accepted, unarchived photos.
    public let photos: @Sendable () async -> [ComparisonPhoto]
    /// Thumbnails (`preview` false) or display previews (`preview` true), by photo ID.
    public let images: @Sendable (_ photoIds: [String], _ preview: Bool) async -> [String: Data]
    /// Automatic registration is offered (the flag `beforeAfter.autoRegistration`).
    public let autoRegistration: @Sendable () async -> Bool

    public init(photos: @escaping @Sendable () async -> [ComparisonPhoto],
                images: @escaping @Sendable (_ photoIds: [String], _ preview: Bool) async -> [String: Data],
                autoRegistration: @escaping @Sendable () async -> Bool) {
        self.photos = photos
        self.images = images
        self.autoRegistration = autoRegistration
    }
}
