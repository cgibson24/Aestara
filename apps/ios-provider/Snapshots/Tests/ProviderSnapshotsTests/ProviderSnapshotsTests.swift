// Snapshot tests (ADR-0023 K2-21; ADR-0026 K3-22, F-68): the view states every
// screen shows (loading, empty, error, permission denied, offline), the
// components and rows of the Layer 2 and 3 screens, light and dark, at the
// default and an accessibility text size; and the annotation editor and the
// comparison viewer at iPhone portrait and iPad landscape sizes. A missing
// reference is recorded and fails the test; CI prints it for review. All
// pictures and data are synthetic.
@testable import Annotations
@testable import AppShell
@testable import BeforeAfter
import ConsultationDomain
import DesignSystem
@testable import DocumentsConsent
import PatientDomain
@testable import Photography
import ProviderSnapshots
import SnapshotTesting
import SwiftUI
import Testing
import UIKit

private func traits(_ style: UIUserInterfaceStyle, _ size: UIContentSizeCategory, scale: CGFloat = 2) -> UITraitCollection {
    UITraitCollection { traits in
        traits.userInterfaceStyle = style
        traits.preferredContentSizeCategory = size
        traits.displayScale = scale
    }
}

/// Light and dark, at the default text size and at an accessibility size. Set on the view's
/// environment as well as its traits, so the picture is measured at that size, not cut to the
/// default one.
@MainActor
private func looks() -> [(name: String, scheme: ColorScheme, size: DynamicTypeSize, traits: UITraitCollection)] {
    [
        ("light", .light, .large, traits(.light, .large)),
        ("dark", .dark, .large, traits(.dark, .large)),
        ("light-ax", .light, .accessibility2, traits(.light, .accessibilityExtraLarge)),
        ("dark-ax", .dark, .accessibility2, traits(.dark, .accessibilityExtraLarge)),
    ]
}

/// A component at iPhone width, in every look.
@MainActor
private func assertLooks(_ view: some View, width: CGFloat = 390, fileID: StaticString = #fileID, file: StaticString = #filePath,
                         testName: String = #function, line: UInt = #line, column: UInt = #column) {
    for look in looks() {
        assertSnapshot(
            of: view.frame(width: width).fixedSize(horizontal: false, vertical: true)
                .padding(DSSpacing.lg).background(DSColor.canvas)
                .environment(\.colorScheme, look.scheme)
                .environment(\.dynamicTypeSize, look.size),
            as: .image(precision: 0.99, perceptualPrecision: 0.98, layout: .sizeThatFits, traits: look.traits),
            named: look.name, fileID: fileID, file: file, testName: testName, line: line, column: column
        )
    }
}

/// A screen-sized view on an iPhone in portrait and an iPad in landscape, light, at 1x to keep
/// the references small.
@MainActor
private func assertDevices(_ view: some View, fileID: StaticString = #fileID, file: StaticString = #filePath,
                           testName: String = #function, line: UInt = #line, column: UInt = #column) {
    let devices: [(String, CGSize)] = [("iphone", CGSize(width: 390, height: 844)), ("ipad", CGSize(width: 1180, height: 820))]
    for (name, size) in devices {
        assertSnapshot(
            of: view.padding(DSSpacing.lg).background(DSColor.canvas),
            as: .image(precision: 0.99, perceptualPrecision: 0.98, layout: .fixed(width: size.width, height: size.height),
                       traits: traits(.light, .large, scale: 1)),
            named: name, fileID: fileID, file: file, testName: testName, line: line, column: column
        )
    }
}

private func photo(_ id: String, view: String, status: String = "ACCEPTED", thumbnail: DerivativeState = .available) -> PhotoItem {
    PhotoItem(id: id, patientId: "p", sessionId: "s", viewKey: view, status: status, capturedAt: Fixtures.date,
              scanStatus: status == "REJECTED" ? "INFECTED" : "CLEAN", rejectionReason: status == "REJECTED" ? "MALWARE_DETECTED" : nil,
              thumbnail: thumbnail, preview: thumbnail, tags: [], pose: PoseSample(), positionMatchScore: nil)
}

private func consultation(_ status: ConsultationStatus, reason: String?) -> Consultation {
    Consultation(id: status.rawValue, patientId: "p", practiceId: "pr", locationId: nil, primaryProviderUserId: nil, status: status,
                 reason: reason, concernIds: [], startedAt: Fixtures.date, readyForReviewAt: nil, completedAt: nil, cancelledAt: nil,
                 cancellationReason: nil, unmet: [], createdAt: Fixtures.date, updatedAt: Fixtures.date, version: 1)
}

@MainActor
@Suite("Snapshots")
struct ProviderSnapshotsTests {
    @Test func viewStates() {
        assertLooks(VStack(spacing: DSSpacing.md) {
            DSStateView(.loading("Loading consultations"))
            DSStateView(.empty(title: "No consultations", message: "Start a consultation to record the reason, concerns, photos and notes."))
            DSStateView(.error(message: "The server could not answer.", reference: "req-0001")) {}
            DSStateView(.permissionDenied)
            DSStateView(.offline) {}
        })
    }

    @Test func components() {
        assertLooks(VStack(alignment: .leading, spacing: DSSpacing.md) {
            DSBanner("You are offline. These are the open consultations saved on this device.", tone: .info)
            DSBanner("1 note draft needs your decision. Open its consultation.", tone: .warning)
            DSBanner("This draft could not be saved.", tone: .danger)
            DSBanner("The summary was generated.", tone: .success)
            HStack { DSBadge("Draft"); DSBadge("Final", color: DSColor.success, background: DSColor.successSoft) }
            Button("Complete consultation") {}.buttonStyle(DSButtonStyle(.primary))
            Button("Return to progress") {}.buttonStyle(DSButtonStyle(.secondary))
            Button("Cancel consultation") {}.buttonStyle(DSButtonStyle(.destructive))
        })
    }

    @Test func photoTiles() {
        let image = Fixtures.jpeg(Fixtures.portrait())
        assertLooks(LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: DSSpacing.md)], spacing: DSSpacing.md) {
            PhotoTile(photo: photo("1", view: "FRONT"), image: image)
            PhotoTile(photo: photo("2", view: "LEFT_45", status: "QUARANTINED", thumbnail: .pending), image: nil)
            PhotoTile(photo: photo("3", view: "RIGHT_45", status: "REJECTED", thumbnail: .pending), image: nil)
            PhotoTile(photo: photo("4", view: "LEFT_PROFILE", thumbnail: .pending), image: nil)
            PhotoTile(photo: photo("5", view: "RIGHT_PROFILE", thumbnail: .failed), image: nil)
            PhotoTile(photo: photo("6", view: "FRONT", status: "ARCHIVED"), image: image)
        })
    }

    @Test func consultationRows() {
        assertLooks(VStack(spacing: DSSpacing.sm) {
            ForEach(ConsultationStatus.allCases, id: \.self) { status in
                ConsultationRow(consultation: consultation(status, reason: status == .draft ? nil : "Brow lines and forehead"), open: {})
            }
        })
    }

    @Test func timelineRows() {
        let kinds: [(String, TimelineDomain)] = [
            ("PATIENT_CREATED", .patient), ("CONSULTATION_COMPLETED", .consultation), ("PHOTO_SESSION_COMPLETED", .photography),
            ("DOCUMENT_ADDED", .document), ("MEDIA_PERMISSION_CHANGED", .mediaPermission),
        ]
        assertLooks(VStack(spacing: DSSpacing.sm) {
            ForEach(kinds, id: \.0) { entry in
                TimelineRow(item: TimelineItem(id: entry.0, kind: entry.0, domain: entry.1, occurredAt: Fixtures.date, actorUserId: nil,
                                               resourceType: "CONSULTATION", resourceId: "c"))
            }
        })
    }

    @Test func documentRows() {
        let version = { (number: Int, state: DocumentVersionState) in
            DocumentVersionItem(id: "v\(number)", versionNumber: number, state: state, byteSize: 1024, changeNote: nil, createdAt: Fixtures.date)
        }
        assertLooks(VStack(spacing: DSSpacing.sm) {
            DocumentRow(document: DocumentItem(id: "d1", type: "CONSULTATION_SUMMARY", title: "Consultation summary", consultationId: "c",
                                               updatedAt: Fixtures.date, versions: [version(2, .available), version(1, .available)]),
                        opening: false, open: {})
            DocumentRow(document: DocumentItem(id: "d2", type: "UPLOADED_CLINICAL", title: "Referral letter", consultationId: nil,
                                               updatedAt: Fixtures.date, versions: [version(1, .scanning)]),
                        opening: false, open: {})
            DocumentRow(document: DocumentItem(id: "d3", type: "UPLOADED_CLINICAL", title: "Outside imaging report", consultationId: nil,
                                               updatedAt: Fixtures.date, versions: [version(1, .rejected)]),
                        opening: false, open: {})
        })
    }

    @Test func annotatedPhoto() {
        let drawing = AnnotationDrawing(shapes: [
            .freehand(points: [NormalizedPoint(x: 0.3, y: 0.3), NormalizedPoint(x: 0.4, y: 0.25), NormalizedPoint(x: 0.5, y: 0.3)],
                      color: .yellow, stroke: .medium),
            .arrow(from: NormalizedPoint(x: 0.8, y: 0.1), to: NormalizedPoint(x: 0.6, y: 0.3), color: .red, stroke: .thick),
            .ellipse(center: NormalizedPoint(x: 0.5, y: 0.45), radiusX: 0.15, radiusY: 0.08, color: .green, stroke: .thin),
            .rectangle(origin: NormalizedPoint(x: 0.1, y: 0.7), width: 0.3, height: 0.12, color: .blue, stroke: .medium),
            .line(from: NormalizedPoint(x: 0.1, y: 0.9), to: NormalizedPoint(x: 0.9, y: 0.9), color: .white, stroke: .thin),
            .text(position: NormalizedPoint(x: 0.55, y: 0.72), text: "Left brow", color: .black, size: .medium),
        ])
        assertDevices(AnnotatedImage(image: Fixtures.portrait(), drawings: [drawing]))
    }

    @Test func annotationEditor() {
        assertDevices(AnnotationEditor(image: Fixtures.portrait(), beneath: [], drawing: .constant(AnnotationDrawing(shapes: [
            .arrow(from: NormalizedPoint(x: 0.3, y: 0.3), to: NormalizedPoint(x: 0.6, y: 0.55), color: .yellow, stroke: .medium),
        ]))))
    }

    @Test func comparisonModes() {
        let transform = SimilarityTransform(scale: 1.05, rotationDeg: 2, translateX: -0.03, translateY: 0.01)
        for mode in ComparisonMode.allCases {
            assertDevices(ComparisonViewer(before: Fixtures.portrait(), after: Fixtures.portrait(shifted: true), transform: transform,
                                           mode: .constant(mode)),
                          testName: "comparison-\(mode.rawValue)")
        }
    }

    @Test func alignmentEditor() {
        assertDevices(AlignmentEditor(before: Fixtures.portrait(), after: Fixtures.portrait(shifted: true),
                                      transform: .constant(.identity)))
    }
}
