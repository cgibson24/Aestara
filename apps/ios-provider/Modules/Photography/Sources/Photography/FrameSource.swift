// Where frames and photos come from (ADR-0023 K2-12). The camera is behind
// this interface: on a device it is AVFoundation with Vision and Core Motion
// (CameraFrameSource); the simulator has no camera, so Debug builds can use a
// synthetic source that the UI tests select. Release builds contain only the
// camera.
// Bible §6.3 · tier: feature · Layer 2.
import CoreGraphics
import Foundation
import SwiftUI
#if DEBUG
import UIKit
#endif

public enum CaptureError: Error, Sendable, Equatable {
    /// The person has not allowed camera access.
    case notAuthorized
    /// No camera on this device.
    case unavailable
    /// The capture failed; try again.
    case failed
}

/// An encoded original as captured: never edited afterwards (Bible §6.6).
public struct CapturedImage: Sendable, Equatable {
    public let jpeg: Data
    public let widthPx: Int
    public let heightPx: Int
    public let capturedAt: Date
    public let deviceModel: String?
}

@MainActor
public protocol FrameSource: AnyObject {
    /// Observations of the live frames, a few per second.
    var observations: AsyncStream<FrameObservation> { get }
    /// The live picture behind the guidance.
    var preview: AnyView { get }
    func start() async throws(CaptureError)
    func stop()
    /// The next view's target: the camera keeps running between views.
    func retarget(_ target: PoseTarget)
    func capture() async throws(CaptureError) -> CapturedImage
}

#if DEBUG
/// A camera stand-in for the simulator and the UI tests: it shows a synthetic
/// picture, reports a subject that settles into the target pose, and
/// "captures" a generated JPEG. Compiled into Debug builds only.
@MainActor
public final class SyntheticFrameSource: FrameSource {
    /// The launch argument that selects it (`-AestaraSyntheticCamera YES`).
    public static let launchArgument = "AestaraSyntheticCamera"
    public static var isRequested: Bool { UserDefaults.standard.bool(forKey: launchArgument) }

    private var target: PoseTarget
    private let continuation: AsyncStream<FrameObservation>.Continuation
    private var task: Task<Void, Never>?
    public let observations: AsyncStream<FrameObservation>

    public init(target: PoseTarget) {
        self.target = target
        let (stream, continuation) = AsyncStream.makeStream(of: FrameObservation.self)
        self.observations = stream
        self.continuation = continuation
    }

    public var preview: AnyView {
        AnyView(
            LinearGradient(colors: [Color(white: 0.35), Color(white: 0.15)], startPoint: .top, endPoint: .bottom)
                .overlay(alignment: .bottomLeading) {
                    Text("Synthetic camera").font(.caption).foregroundStyle(.white.opacity(0.7)).padding()
                }
                .accessibilityLabel("Synthetic camera")
        )
    }

    public func start() async throws(CaptureError) {
        run()
    }

    public func retarget(_ target: PoseTarget) {
        self.target = target
        if task != nil { run() }
    }

    private func run() {
        task?.cancel()
        let target = self.target
        let continuation = self.continuation
        task = Task {
            // Too far first, then settled within every tolerance, where it stays still: no
            // further frames until the next view, so the screen is at rest for the UI tests.
            for step in 0...3 where !Task.isCancelled {
                let fill = step < 3 ? max(0.1, target.frameFill - target.frameFillTolerance - 0.1) : target.frameFill
                let height = CGFloat(fill)
                let box = CGRect(x: 0.5 - height * 0.35, y: 0.5 - height / 2, width: height * 0.7, height: height)
                continuation.yield(FrameObservation(subjectBox: box, yawDeg: target.yawDeg, pitchDeg: 0, rollDeg: 0, brightness: 0.6))
                if step < 3 { try? await Task.sleep(for: .milliseconds(300)) }
            }
        }
    }

    public func stop() {
        task?.cancel()
        task = nil
    }

    public func capture() async throws(CaptureError) -> CapturedImage {
        let size = CGSize(width: 1200, height: 1600)
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { context in
            let colors = [UIColor(white: 0.85, alpha: 1).cgColor, UIColor(white: 0.25, alpha: 1).cgColor] as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            }
            // Edges, so the sharpness check has something to measure.
            UIColor.white.setStroke()
            for i in stride(from: 0, to: Int(size.width), by: 40) {
                context.cgContext.stroke(CGRect(x: CGFloat(i), y: CGFloat(i), width: 40, height: 40))
            }
        }
        guard let jpeg = image.jpegData(compressionQuality: 0.9) else { throw .failed }
        return CapturedImage(jpeg: jpeg, widthPx: Int(size.width), heightPx: Int(size.height), capturedAt: Date(), deviceModel: "Simulator")
    }
}
#endif
