// Live guidance (Bible §6.4; PHOTO_PROTOCOLS.md §6–8; ADR-0023 K2-12): only
// the 13 Bible codes, one instruction at a time in the fixed order, checks that
// never block, and the photographic position-match score with its label.
import CoreGraphics
import Foundation
@testable import Photography
import Testing

private let face = PoseTarget(subject: .face, yawDeg: 0, yawToleranceDeg: 8, pitchToleranceDeg: 8, rollToleranceDeg: 4,
                              centerToleranceFraction: 0.08, frameFill: 0.45, frameFillTolerance: 0.08)

/// A face filling 45% of the frame height, centred, facing the camera, in good light.
private func aligned() -> FrameObservation {
    FrameObservation(subjectBox: CGRect(x: 0.35, y: 0.275, width: 0.3, height: 0.45), yawDeg: 0, pitchDeg: 0, rollDeg: 0, brightness: 0.6)
}

@Test func thereAreExactlyTheThirteenBibleCodes() {
    #expect(Guidance.allCases.map(\.rawValue) == [
        "MOVE_LEFT", "MOVE_RIGHT", "MOVE_CLOSER", "MOVE_BACK", "CAMERA_TOO_HIGH", "CAMERA_TOO_LOW", "LEVEL_CAMERA",
        "PATIENT_TURN_LEFT", "PATIENT_TURN_RIGHT", "RAISE_CHIN", "LOWER_CHIN", "LIGHTING_TOO_DARK", "RETAKE_MOTION_BLUR",
    ])
    #expect(Guidance.raiseChin.instruction == "Raise chin slightly")
}

@Test func alignedWhenWithinEveryTolerance() {
    #expect(GuidanceEngine.evaluate(aligned(), target: face) == .aligned)
}

@Test func searchesUntilASubjectIsFound() {
    #expect(GuidanceEngine.evaluate(FrameObservation(subjectBox: nil, brightness: 0.6), target: face) == .searching)
}

@Test func levelsTheCameraBeforeAnythingElse() {
    var frame = FrameObservation(subjectBox: CGRect(x: 0, y: 0, width: 0.1, height: 0.1), brightness: 0.1, deviceRollDeg: 5)
    #expect(GuidanceEngine.evaluate(frame, target: face) == .correct(.levelCamera))
    frame.deviceRollDeg = 0
    frame.devicePitchDeg = -12
    #expect(GuidanceEngine.evaluate(frame, target: face) == .correct(.levelCamera))
}

@Test func distanceComesBeforeFramingPoseAndLight() {
    var frame = aligned()
    frame.subjectBox = CGRect(x: 0, y: 0, width: 0.2, height: 0.3)
    frame.yawDeg = 30
    frame.brightness = 0.1
    #expect(GuidanceEngine.evaluate(frame, target: face) == .correct(.moveCloser))
    frame.subjectBox = CGRect(x: 0.2, y: 0.1, width: 0.6, height: 0.8)
    #expect(GuidanceEngine.evaluate(frame, target: face) == .correct(.moveBack))
}

@Test func framingMovesTheCameraTowardsTheSubject() {
    var frame = aligned()
    frame.subjectBox = CGRect(x: 0.1, y: 0.275, width: 0.3, height: 0.45)
    #expect(GuidanceEngine.evaluate(frame, target: face) == .correct(.moveLeft))
    frame.subjectBox = CGRect(x: 0.6, y: 0.275, width: 0.3, height: 0.45)
    #expect(GuidanceEngine.evaluate(frame, target: face) == .correct(.moveRight))
    frame.subjectBox = CGRect(x: 0.35, y: 0.5, width: 0.3, height: 0.45)
    #expect(GuidanceEngine.evaluate(frame, target: face) == .correct(.cameraTooHigh))
    frame.subjectBox = CGRect(x: 0.35, y: 0.05, width: 0.3, height: 0.45)
    #expect(GuidanceEngine.evaluate(frame, target: face) == .correct(.cameraTooLow))
}

@Test func poseThenLighting() {
    let left45 = PoseTarget(subject: .face, yawDeg: 45, yawToleranceDeg: 8, pitchToleranceDeg: 8, rollToleranceDeg: 4,
                            centerToleranceFraction: 0.08, frameFill: 0.45, frameFillTolerance: 0.08)
    var frame = aligned()
    frame.yawDeg = 20
    #expect(GuidanceEngine.evaluate(frame, target: left45) == .correct(.patientTurnRight))
    frame.yawDeg = 70
    #expect(GuidanceEngine.evaluate(frame, target: left45) == .correct(.patientTurnLeft))
    frame.yawDeg = 45
    frame.pitchDeg = -15
    #expect(GuidanceEngine.evaluate(frame, target: left45) == .correct(.raiseChin))
    frame.pitchDeg = 15
    #expect(GuidanceEngine.evaluate(frame, target: left45) == .correct(.lowerChin))
    frame.pitchDeg = 0
    frame.brightness = 0.1
    #expect(GuidanceEngine.evaluate(frame, target: left45) == .correct(.lightingTooDark))
}

@Test func aTorsoHasNoFacePose() {
    let torso = PoseTarget(subject: .torso, yawDeg: 90, yawToleranceDeg: 8, pitchToleranceDeg: 8, rollToleranceDeg: 4,
                           centerToleranceFraction: 0.08, frameFill: 0.8, frameFillTolerance: 0.08)
    let frame = FrameObservation(subjectBox: CGRect(x: 0.3, y: 0.1, width: 0.4, height: 0.8), yawDeg: 0, pitchDeg: 30, brightness: 0.6)
    #expect(GuidanceEngine.evaluate(frame, target: torso) == .aligned)
}

@Test func liveChecksRecordCodesAndValuesOnly() {
    var frame = aligned()
    #expect(GuidanceEngine.liveChecks(frame, target: face) == [
        QualityCheckResult(code: .levelCamera, passed: true, value: 0),
        QualityCheckResult(code: .lightingTooDark, passed: true, value: 0.6),
    ])
    frame.yawDeg = 20
    frame.brightness = 0.1
    let checks = GuidanceEngine.liveChecks(frame, target: face)
    #expect(checks.contains(QualityCheckResult(code: .lightingTooDark, passed: false, value: 0.1)))
    #expect(checks.contains(QualityCheckResult(code: .patientTurnLeft, passed: false, value: nil)))
}

@Test func qualityChipsFollowTheSameTolerances() {
    let good = QualitySummary(aligned(), target: face)
    #expect(good.lightingOK && good.distanceOK && good.poseOK)
    var frame = aligned()
    frame.yawDeg = 20
    frame.brightness = 0.1
    let poor = QualitySummary(frame, target: face)
    #expect(!poor.lightingOK && poor.distanceOK && !poor.poseOK)
    let none = QualitySummary(FrameObservation(subjectBox: nil, brightness: 0.6), target: face)
    #expect(none.lightingOK && !none.distanceOK && !none.poseOK)
}

// MARK: Position match (Bible §6.5)

@Test func positionMatchIsPhotographicAndLabelled() {
    #expect(PositionMatch.label == "Photographic position match, not a medical measurement.")
    #expect(!PositionMatch.label.localizedCaseInsensitiveContains("medical accuracy"))
    let pose = PoseSample(yawDeg: 45, pitchDeg: 2, rollDeg: 1, frameFill: 0.45)
    #expect(PositionMatch.score(live: pose, reference: pose) == 1)
    #expect(PositionMatch.score(live: PoseSample(), reference: pose) == nil)
    let off = PositionMatch.score(live: PoseSample(yawDeg: 60, pitchDeg: 2, rollDeg: 1, frameFill: 0.45), reference: pose)
    #expect(off == 0.875)
    #expect(PositionMatch.words(0.95) == "Close match")
    #expect(PositionMatch.words(0.8) == "Fair match")
    #expect(PositionMatch.words(0.5) == "Different position")
}

@Test func theScoreHasFourDecimals() throws {
    let score = try #require(PositionMatch.score(live: PoseSample(yawDeg: 1), reference: PoseSample(yawDeg: 0)))
    #expect(score == 0.9667)
}

// MARK: Sharpness (RETAKE_MOTION_BLUR)

@Test func aFlatImageHasNoEdgeEnergy() {
    let flat = [UInt8](repeating: 128, count: 64 * 64)
    #expect(Sharpness.laplacianVariance(gray: flat, width: 64, height: 64) == 0)
}

@Test func edgesRaiseTheVarianceAboveTheThreshold() {
    var board = [UInt8](repeating: 0, count: 64 * 64)
    for y in 0..<64 {
        for x in 0..<64 where (x / 4 + y / 4).isMultiple(of: 2) { board[y * 64 + x] = 255 }
    }
    #expect(Sharpness.laplacianVariance(gray: board, width: 64, height: 64) > Sharpness.threshold)
}

@Test func anUndecodablePhotoHasNoBlurCheck() {
    #expect(Sharpness.check(Data("not a jpeg".utf8)) == nil)
}
