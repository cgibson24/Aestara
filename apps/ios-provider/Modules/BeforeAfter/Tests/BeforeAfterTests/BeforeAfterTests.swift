// Before/after sets on the device (ADR-0026 K3-12, K3-13; ADR-0027): the
// transform stays a similarity transform within the contract's limits, an
// unaligned set shows the photos as captured, blink never exceeds the WCAG
// flash threshold, and the pane geometry matches the export's.
@testable import BeforeAfter
import Foundation
import Testing

@Test func keepsTheTransformWithinTheContract() {
    let wild = SimilarityTransform(scale: 9, rotationDeg: -400, translateX: 3, translateY: -5).clamped
    #expect(wild == SimilarityTransform(scale: 4, rotationDeg: -180, translateX: 2, translateY: -2))
    #expect(SimilarityTransform(scale: 0.1, rotationDeg: 10, translateX: 0, translateY: 0).clamped.scale == 0.25)
}

@Test func showsAnUnalignedSetAsCaptured() {
    let set = BeforeAfterSetItem(id: "s", beforePhotoId: "b", afterPhotoId: "a", consultationId: nil, viewKey: "FRONT", title: nil,
                                 mode: .none, transform: SimilarityTransform(scale: 2, rotationDeg: 5, translateX: 0, translateY: 0),
                                 job: nil, createdAt: Date(), version: 1)
    #expect(set.effectiveTransform == .identity)
}

@Test func explainsAFailedRegistration() {
    #expect(RegistrationJobState(status: "QUEUED", failure: nil).isRunning)
    #expect(RegistrationJobState(status: "SUCCEEDED", failure: nil).failureMessage == nil)
    #expect(RegistrationJobState(status: "FAILED", failure: "NO_RELIABLE_ALIGNMENT").failureMessage?.contains("No reliable alignment") == true)
}

@Test func neverBlinksFasterThanThreeTimesASecond() {
    #expect(ComparisonViewer.maxBlinkRate <= 3)
    #expect(ComparisonMode.allCases.count == 5)
}

@Test func fitsTheBeforePhotoLikeTheExport() {
    let frame = fittedFrame(CGSize(width: 600, height: 800), in: CGSize(width: 400, height: 400))
    #expect(frame == CGRect(x: 50, y: 0, width: 300, height: 400))
    #expect(fittedFrame(.zero, in: CGSize(width: 10, height: 10)) == .zero)
}

@Test func zoomsAndPansBothPanesTogetherUntilUnlinked() {
    var panes = PaneViewports()
    let zoomed = Viewport(zoom: 2, pan: CGSize(width: 10, height: -5))
    panes.set(zoomed, for: .after)
    #expect(panes.viewport(.before) == zoomed)
    #expect(panes.viewport(.after) == zoomed)
    panes.link(false)
    panes.set(Viewport(zoom: 3, pan: .zero), for: .after)
    #expect(panes.viewport(.before) == zoomed)
    #expect(panes.viewport(.after).zoom == 3)
    panes.link(true)
    #expect(panes.viewport(.after) == zoomed)
    panes.reset()
    #expect(panes.viewport(.before) == Viewport())
}
