// Live capture guidance (Bible §6.3–6.5; PHOTO_PROTOCOLS.md §6–8; ADR-0023
// K2-12): the 13 Bible codes, the order in which they are given (level the
// camera, then distance, framing, pose and lighting, one at a time), and the
// photographic position-match score. Guidance informs the photographer and
// never blocks acceptance. This file is pure logic: the camera adapter turns
// Vision and Core Motion readings into a `FrameObservation`.
// Bible §6 · tier: feature · Layer 2.
import CoreGraphics
import Foundation

/// The Bible §6.4 codes; no other code exists.
public enum Guidance: String, CaseIterable, Sendable, Codable {
    case moveLeft = "MOVE_LEFT"
    case moveRight = "MOVE_RIGHT"
    case moveCloser = "MOVE_CLOSER"
    case moveBack = "MOVE_BACK"
    case cameraTooHigh = "CAMERA_TOO_HIGH"
    case cameraTooLow = "CAMERA_TOO_LOW"
    case levelCamera = "LEVEL_CAMERA"
    case patientTurnLeft = "PATIENT_TURN_LEFT"
    case patientTurnRight = "PATIENT_TURN_RIGHT"
    case raiseChin = "RAISE_CHIN"
    case lowerChin = "LOWER_CHIN"
    case lightingTooDark = "LIGHTING_TOO_DARK"
    case retakeMotionBlur = "RETAKE_MOTION_BLUR"

    /// One plain instruction (DESIGN_SYSTEM.md C14), US English.
    public var instruction: String {
        switch self {
        case .moveLeft: String(localized: "Move the camera left")
        case .moveRight: String(localized: "Move the camera right")
        case .moveCloser: String(localized: "Move closer")
        case .moveBack: String(localized: "Move back")
        case .cameraTooHigh: String(localized: "Camera too high: lower it")
        case .cameraTooLow: String(localized: "Camera too low: raise it")
        case .levelCamera: String(localized: "Level the camera")
        case .patientTurnLeft: String(localized: "Ask the patient to turn left")
        case .patientTurnRight: String(localized: "Ask the patient to turn right")
        case .raiseChin: String(localized: "Raise chin slightly")
        case .lowerChin: String(localized: "Lower chin slightly")
        case .lightingTooDark: String(localized: "Lighting too dark: add light")
        case .retakeMotionBlur: String(localized: "Motion blur: retake the photo")
        }
    }
}

/// A view's target pose and tolerances (`PhotographyProtocolView.poseTarget`).
public struct PoseTarget: Sendable, Equatable, Codable {
    public enum Subject: String, Sendable, Codable { case face = "FACE", torso = "TORSO" }
    public let subject: Subject
    /// The subject's turn from facing the camera; positive shows the subject's left side.
    public let yawDeg: Double
    public let yawToleranceDeg: Double
    public let pitchToleranceDeg: Double
    public let rollToleranceDeg: Double
    public let centerToleranceFraction: Double
    /// Subject height as a fraction of the frame height.
    public let frameFill: Double
    public let frameFillTolerance: Double

    public init(subject: Subject, yawDeg: Double, yawToleranceDeg: Double, pitchToleranceDeg: Double,
                rollToleranceDeg: Double, centerToleranceFraction: Double, frameFill: Double, frameFillTolerance: Double) {
        self.subject = subject
        self.yawDeg = yawDeg
        self.yawToleranceDeg = yawToleranceDeg
        self.pitchToleranceDeg = pitchToleranceDeg
        self.rollToleranceDeg = rollToleranceDeg
        self.centerToleranceFraction = centerToleranceFraction
        self.frameFill = frameFill
        self.frameFillTolerance = frameFillTolerance
    }

    /// Used for a custom view without a pose target: facing the camera, generous tolerances.
    public static let general = PoseTarget(subject: .face, yawDeg: 0, yawToleranceDeg: 20, pitchToleranceDeg: 15,
                                           rollToleranceDeg: 15, centerToleranceFraction: 0.2, frameFill: 0.6,
                                           frameFillTolerance: 0.25)
}

/// What the camera sees in one frame, in display coordinates: the origin is the
/// top-left corner, x grows to the right and y downwards, both from 0 to 1.
public struct FrameObservation: Sendable, Equatable {
    /// The face or torso; nil while no subject is found.
    public var subjectBox: CGRect?
    /// The subject's turn; positive shows the subject's left side (as `PoseTarget.yawDeg`).
    public var yawDeg: Double?
    /// Positive with the chin raised.
    public var pitchDeg: Double?
    public var rollDeg: Double?
    /// Mean brightness of the frame, 0 (black) to 1 (white).
    public var brightness: Double
    /// The device's tilt about the lens axis and forward or back, from Core Motion.
    public var deviceRollDeg: Double
    public var devicePitchDeg: Double

    public init(subjectBox: CGRect?, yawDeg: Double? = nil, pitchDeg: Double? = nil, rollDeg: Double? = nil,
                brightness: Double, deviceRollDeg: Double = 0, devicePitchDeg: Double = 0) {
        self.subjectBox = subjectBox
        self.yawDeg = yawDeg
        self.pitchDeg = pitchDeg
        self.rollDeg = rollDeg
        self.brightness = brightness
        self.deviceRollDeg = deviceRollDeg
        self.devicePitchDeg = devicePitchDeg
    }
}

public enum GuidanceState: Sendable, Equatable {
    /// No face or torso in the frame yet.
    case searching
    /// The one instruction to show now.
    case correct(Guidance)
    /// Within every tolerance.
    case aligned
}

/// The fixed photographic thresholds (PHOTO_PROTOCOLS.md §7).
public enum GuidanceThresholds {
    public static let levelRollDeg = 3.0
    public static let levelPitchDeg = 10.0
    public static let minimumBrightness = 0.25
}

public enum GuidanceEngine {
    /// The first correction needed, in the K2-12 order: level, distance, framing, pose, lighting.
    public static func evaluate(_ frame: FrameObservation, target: PoseTarget) -> GuidanceState {
        if abs(frame.deviceRollDeg) > GuidanceThresholds.levelRollDeg || abs(frame.devicePitchDeg) > GuidanceThresholds.levelPitchDeg {
            return .correct(.levelCamera)
        }
        guard let box = frame.subjectBox else { return .searching }
        // Distance: how much of the frame height the subject fills.
        if box.height < target.frameFill - target.frameFillTolerance { return .correct(.moveCloser) }
        if box.height > target.frameFill + target.frameFillTolerance { return .correct(.moveBack) }
        // Framing: a subject left of centre needs the camera moved left; a subject
        // low in the frame means the camera is too high.
        let dx = box.midX - 0.5
        let dy = box.midY - 0.5
        if dx < -target.centerToleranceFraction { return .correct(.moveLeft) }
        if dx > target.centerToleranceFraction { return .correct(.moveRight) }
        if dy > target.centerToleranceFraction { return .correct(.cameraTooHigh) }
        if dy < -target.centerToleranceFraction { return .correct(.cameraTooLow) }
        // Pose: more of the left side shows as the patient turns to their right.
        if target.subject == .face {
            if let yaw = frame.yawDeg {
                if yaw < target.yawDeg - target.yawToleranceDeg { return .correct(.patientTurnRight) }
                if yaw > target.yawDeg + target.yawToleranceDeg { return .correct(.patientTurnLeft) }
            }
            if let pitch = frame.pitchDeg {
                if pitch < -target.pitchToleranceDeg { return .correct(.raiseChin) }
                if pitch > target.pitchToleranceDeg { return .correct(.lowerChin) }
            }
        }
        if frame.brightness < GuidanceThresholds.minimumBrightness { return .correct(.lightingTooDark) }
        return .aligned
    }

    /// The live results kept with the photo (`qualityChecks`): codes and values, no free text.
    public static func liveChecks(_ frame: FrameObservation, target: PoseTarget) -> [QualityCheckResult] {
        var checks = [
            QualityCheckResult(
                code: .levelCamera,
                passed: abs(frame.deviceRollDeg) <= GuidanceThresholds.levelRollDeg && abs(frame.devicePitchDeg) <= GuidanceThresholds.levelPitchDeg,
                value: max(abs(frame.deviceRollDeg), abs(frame.devicePitchDeg))
            ),
            QualityCheckResult(code: .lightingTooDark, passed: frame.brightness >= GuidanceThresholds.minimumBrightness, value: frame.brightness),
        ]
        if case let .correct(code) = evaluate(frame, target: target), code != .levelCamera, code != .lightingTooDark {
            checks.append(QualityCheckResult(code: code, passed: false, value: nil))
        }
        return checks
    }
}

/// The quality chips beside the shutter on iPad (DESIGN_SYSTEM.md C14, §4): lighting, distance and pose.
public struct QualitySummary: Sendable, Equatable {
    public let lightingOK: Bool
    public let distanceOK: Bool
    public let poseOK: Bool

    public init(_ frame: FrameObservation, target: PoseTarget) {
        lightingOK = frame.brightness >= GuidanceThresholds.minimumBrightness
        guard let box = frame.subjectBox else {
            distanceOK = false
            poseOK = false
            return
        }
        distanceOK = abs(Double(box.height) - target.frameFill) <= target.frameFillTolerance
        if target.subject == .face {
            let yawOK = frame.yawDeg.map { abs($0 - target.yawDeg) <= target.yawToleranceDeg } ?? true
            let pitchOK = frame.pitchDeg.map { abs($0) <= target.pitchToleranceDeg } ?? true
            poseOK = yawOK && pitchOK
        } else {
            poseOK = true
        }
    }
}

/// One check result, as stored in `PatientPhoto.qualityChecks`.
public struct QualityCheckResult: Sendable, Equatable, Codable {
    public let code: Guidance
    public let passed: Bool
    public let value: Double?

    public init(code: Guidance, passed: Bool, value: Double?) {
        self.code = code
        self.passed = passed
        self.value = value
    }
}

/// A pose as recorded with a photo (`captureMetadata`).
public struct PoseSample: Sendable, Equatable, Codable {
    public var yawDeg: Double?
    public var pitchDeg: Double?
    public var rollDeg: Double?
    public var frameFill: Double?

    public init(yawDeg: Double? = nil, pitchDeg: Double? = nil, rollDeg: Double? = nil, frameFill: Double? = nil) {
        self.yawDeg = yawDeg
        self.pitchDeg = pitchDeg
        self.rollDeg = rollDeg
        self.frameFill = frameFill
    }

    public init(_ frame: FrameObservation) {
        self.init(yawDeg: frame.yawDeg, pitchDeg: frame.pitchDeg, rollDeg: frame.rollDeg, frameFill: frame.subjectBox.map { Double($0.height) })
    }
}

/// How closely the camera and patient position match the reference photo's
/// (Bible §6.5). It describes the photograph only, never anatomy or outcome.
public enum PositionMatch {
    /// The label the score always carries (DESIGN_SYSTEM.md §3).
    public static let label = String(localized: "Photographic position match, not a medical measurement.")

    /// 0 to 1, four decimals (`Decimal(5,4)`); nil when the two poses share no measure.
    public static func score(live: PoseSample, reference: PoseSample) -> Double? {
        var parts: [Double] = []
        func compare(_ a: Double?, _ b: Double?, scale: Double) {
            guard let a, let b else { return }
            parts.append(max(0, 1 - abs(a - b) / scale))
        }
        compare(live.yawDeg, reference.yawDeg, scale: 30)
        compare(live.pitchDeg, reference.pitchDeg, scale: 20)
        compare(live.rollDeg, reference.rollDeg, scale: 20)
        compare(live.frameFill, reference.frameFill, scale: 0.25)
        guard !parts.isEmpty else { return nil }
        let mean = parts.reduce(0, +) / Double(parts.count)
        return (mean * 10_000).rounded() / 10_000
    }

    /// The score in words, so it is never conveyed by colour alone (DESIGN_SYSTEM.md §5).
    public static func words(_ score: Double) -> String {
        switch score {
        case 0.9...: String(localized: "Close match")
        case 0.75..<0.9: String(localized: "Fair match")
        default: String(localized: "Different position")
        }
    }
}
