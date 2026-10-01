// The device camera (Bible §6.3–6.4; ADR-0023 K2-12): AVFoundation for the
// preview and the photo, Vision for the face pose (yaw, pitch, roll) or the
// torso, Core Motion for the device's tilt, and the frame's mean brightness.
// Analysis runs on device only; nothing leaves the phone or tablet until the
// photographer accepts the photo. Every AVFoundation object lives on the
// pipeline's own queue.
// Bible §6 · tier: feature · Layer 2.
import AVFoundation
import CoreMotion
import Foundation
import SwiftUI
import UIKit
import Vision

@MainActor
public final class CameraFrameSource: FrameSource {
    private let pipeline: CameraPipeline
    public let observations: AsyncStream<FrameObservation>

    public init(subject: PoseTarget.Subject) {
        let (stream, continuation) = AsyncStream.makeStream(of: FrameObservation.self, bufferingPolicy: .bufferingNewest(1))
        self.observations = stream
        self.pipeline = CameraPipeline(subject: subject, continuation: continuation)
    }

    public var preview: AnyView { AnyView(CameraPreview(session: pipeline.session)) }

    public func start() async throws(CaptureError) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .video) else { throw .notAuthorized }
        default:
            throw .notAuthorized
        }
        try await pipeline.start()
    }

    public func stop() {
        pipeline.stop()
    }

    public func retarget(_ target: PoseTarget) {
        pipeline.setSubject(target.subject)
    }

    public func capture() async throws(CaptureError) -> CapturedImage {
        let result = await withCheckedContinuation { (continuation: CheckedContinuation<Result<CapturedImage, CaptureError>, Never>) in
            pipeline.capture { continuation.resume(returning: $0) }
        }
        return try result.get()
    }
}

/// The capture session, its outputs, motion and analysis. All mutable state is
/// confined to `queue`, which is why the class is `@unchecked Sendable`.
final class CameraPipeline: NSObject, @unchecked Sendable, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "com.aestara.provider.camera")
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let motion = CMMotionManager()
    private var subject: PoseTarget.Subject
    private let continuation: AsyncStream<FrameObservation>.Continuation
    private var rotation: AVCaptureDevice.RotationCoordinator?
    private var pendingCapture: (@Sendable (Result<CapturedImage, CaptureError>) -> Void)?
    private var lastAnalysis = Date.distantPast

    init(subject: PoseTarget.Subject, continuation: AsyncStream<FrameObservation>.Continuation) {
        self.subject = subject
        self.continuation = continuation
    }

    func start() async throws(CaptureError) {
        let ready = await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
            queue.async { done.resume(returning: self.configure()) }
        }
        guard ready else { throw .unavailable }
    }

    /// On `queue`.
    private func configure() -> Bool {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device) else { return false }
        session.beginConfiguration()
        session.sessionPreset = .photo
        guard session.canAddInput(input), session.canAddOutput(photoOutput), session.canAddOutput(videoOutput) else {
            session.commitConfiguration()
            return false
        }
        session.addInput(input)
        session.addOutput(photoOutput)
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        videoOutput.setSampleBufferDelegate(self, queue: queue)
        session.addOutput(videoOutput)
        session.commitConfiguration()
        rotation = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: nil)
        motion.deviceMotionUpdateInterval = 0.1
        motion.startDeviceMotionUpdates()
        session.startRunning()
        return true
    }

    func stop() {
        queue.async {
            self.motion.stopDeviceMotionUpdates()
            if self.session.isRunning { self.session.stopRunning() }
            self.continuation.finish()
        }
    }

    func setSubject(_ subject: PoseTarget.Subject) {
        queue.async { self.subject = subject }
    }

    func capture(_ completion: @escaping @Sendable (Result<CapturedImage, CaptureError>) -> Void) {
        queue.async {
            guard self.pendingCapture == nil, self.session.isRunning else {
                completion(.failure(.failed))
                return
            }
            self.pendingCapture = completion
            if let angle = self.rotation?.videoRotationAngleForHorizonLevelCapture,
               let connection = self.photoOutput.connection(with: .video), connection.isVideoRotationAngleSupported(angle) {
                connection.videoRotationAngle = angle
            }
            let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    // MARK: Photo

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let dimensions = photo.resolvedSettings.photoDimensions
        let data = error == nil ? photo.fileDataRepresentation() : nil
        queue.async {
            let completion = self.pendingCapture
            self.pendingCapture = nil
            guard let data else {
                completion?(.failure(.failed))
                return
            }
            completion?(.success(CapturedImage(
                jpeg: data,
                widthPx: Int(dimensions.width),
                heightPx: Int(dimensions.height),
                capturedAt: Date(),
                deviceModel: Self.deviceModel
            )))
        }
    }

    private static let deviceModel: String = {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { bytes in
            String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
        }
    }()

    // MARK: Frames

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        // A few analyses per second are enough for guidance.
        let now = Date()
        guard now.timeIntervalSince(lastAnalysis) >= 0.2, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastAnalysis = now
        let orientation = Self.orientation(forRotation: rotation?.videoRotationAngleForHorizonLevelCapture ?? 90)
        var observation = FrameObservation(subjectBox: nil, brightness: Self.brightness(pixels))
        if let gravity = motion.deviceMotion?.gravity {
            let roll = atan2(gravity.x, -gravity.y) * 180 / .pi
            observation.deviceRollDeg = remainder(roll, 90)
            observation.devicePitchDeg = atan2(gravity.z, (gravity.x * gravity.x + gravity.y * gravity.y).squareRoot()) * 180 / .pi
        }
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: orientation, options: [:])
        switch subject {
        case .face:
            let request = VNDetectFaceRectanglesRequest()
            try? handler.perform([request])
            if let face = request.results?.max(by: { $0.boundingBox.height < $1.boundingBox.height }) {
                observation.subjectBox = Self.displayRect(face.boundingBox)
                // Vision's yaw grows as the face turns towards the image's right edge, which
                // for the rear camera is the patient turning to their left: the side shown is
                // then their right, so the sign flips to PoseTarget's convention.
                observation.yawDeg = face.yaw.map { -$0.doubleValue * 180 / .pi }
                observation.pitchDeg = face.pitch.map { $0.doubleValue * 180 / .pi }
                observation.rollDeg = face.roll.map { $0.doubleValue * 180 / .pi }
            }
        case .torso:
            let request = VNDetectHumanRectanglesRequest()
            request.upperBodyOnly = false
            try? handler.perform([request])
            if let body = request.results?.max(by: { $0.boundingBox.height < $1.boundingBox.height }) {
                observation.subjectBox = Self.displayRect(body.boundingBox)
            }
        }
        continuation.yield(observation)
    }

    /// Vision's normalized rectangles have their origin at the bottom left; the display's at the top left.
    static func displayRect(_ rect: CGRect) -> CGRect {
        CGRect(x: rect.minX, y: 1 - rect.maxY, width: rect.width, height: rect.height)
    }

    static func orientation(forRotation angle: CGFloat) -> CGImagePropertyOrientation {
        switch Int(angle.rounded()) {
        case 0: .up
        case 180: .down
        case 270: .left
        default: .right
        }
    }

    /// Mean luma of the frame (the Y plane), sampled sparsely, from 0 to 1.
    static func brightness(_ buffer: CVPixelBuffer) -> Double {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) else { return 1 }
        let width = CVPixelBufferGetWidthOfPlane(buffer, 0)
        let height = CVPixelBufferGetHeightOfPlane(buffer, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        var total = 0
        var count = 0
        for y in Swift.stride(from: 0, to: height, by: 16) {
            for x in Swift.stride(from: 0, to: width, by: 16) {
                total += Int(bytes[y * stride + x])
                count += 1
            }
        }
        return count == 0 ? 1 : Double(total) / Double(count) / 255
    }
}

/// The live camera picture.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        // The layer class above guarantees the type.
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
