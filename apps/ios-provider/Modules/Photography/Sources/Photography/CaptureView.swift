// Guided capture (Bible §6.3 steps 3–9, §6.4, §6.5; PHOTO_PROTOCOLS.md §5–8;
// DESIGN_SYSTEM.md C3, C14, §4; ADR-0023 K2-12): the live camera in a 3:4
// stage with a framing oval, one instruction at a time, the optional ghost
// overlay of an earlier photo of the same view with adjustable opacity, the
// photographic position-match score with its fixed label, and a shutter that
// never moves. After capture the photographer reviews the quality checks and
// accepts or retakes; no check blocks acceptance. An accepted photo is sealed
// in the encrypted queue and uploads in the background, so steps 1–8 work
// offline (Bible §23.1).
// Bible §6 · tier: feature · Layer 2.
import CoreNetworking
import DesignSystem
import Media
import SwiftUI
import UIKit

struct CaptureView: View {
    let context: PhotographyContext
    let patientId: String
    let sessionId: String
    let views: [ProtocolViewSpec]
    @State private var current: ProtocolViewSpec
    @State private var accepted: Set<String> = []

    @State private var source: (any FrameSource)?
    @State private var camera: CameraState = .starting
    @State private var frame: FrameObservation?
    @State private var guidance: GuidanceState = .searching
    @State private var shooting = false
    @State private var review: CaptureReview?
    @State private var message: String?

    @State private var references: [PhotoItem] = []
    @State private var reference: PhotoItem?
    @State private var referenceImage: Data?
    @State private var referenceLoading = true
    @State private var ghostOn = true
    @State private var ghostOpacity = 0.4

    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    enum CameraState: Equatable { case starting, running, notAuthorized, unavailable }

    init(context: PhotographyContext, patientId: String, sessionId: String, views: [ProtocolViewSpec], start: ProtocolViewSpec) {
        self.context = context
        self.patientId = patientId
        self.sessionId = sessionId
        self.views = views
        _current = State(initialValue: start)
    }

    private var target: PoseTarget { current.poseTarget ?? .general }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            if let review {
                CaptureReviewView(review: review, viewName: current.name) {
                    self.review = nil
                } accept: {
                    Task { await accept(review) }
                }
            } else {
                stage
                bottomBar
            }
        }
        .background(DSColor.photoStage.ignoresSafeArea())
        .environment(\.colorScheme, .dark)
        .task { await runCamera() }
        .task(id: current.viewKey) { await loadReferences() }
        .onChange(of: current) { _, view in
            frame = nil
            guidance = .searching
            source?.retarget(view.poseTarget ?? .general)
        }
        .task { await loadAccepted() }
        .onChange(of: guidanceText) { _, text in
            if let text { AccessibilityNotification.Announcement(text).post() }
        }
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: DSSpacing.md) {
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(DSFont.headline).frame(width: DSSize.touchTarget, height: DSSize.touchTarget)
            }
            .accessibilityLabel("Close camera")
            .accessibilityIdentifier("capture.close")
            VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                Text(current.name).font(DSFont.headline)
                Text(positionText).font(DSFont.caption1).foregroundStyle(DSColor.photoStageText.opacity(0.8))
            }
            .accessibilityElement(children: .combine)
            Spacer()
            if context.ghostOverlayEnabled, review == nil, referenceImage != nil {
                Toggle("Ghost", isOn: $ghostOn)
                    .fixedSize()
                    .accessibilityIdentifier("capture.ghost")
            }
        }
        .foregroundStyle(DSColor.photoStageText)
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
    }

    private var positionText: String {
        let index = (views.firstIndex(of: current) ?? 0) + 1
        let kind = current.isRequired ? String(localized: "required") : String(localized: "optional")
        return String(localized: "View \(index) of \(views.count), \(kind)")
    }

    // MARK: Stage

    /// The 3:4 stage keeps the oval and the ghost on the subject on every screen size.
    private var stage: some View {
        ZStack {
            Color.clear
            ZStack {
                if let source {
                    source.preview
                } else {
                    DSColor.photoStage
                }
                if ghostVisible, let referenceImage, let image = UIImage(data: referenceImage) {
                    Image(uiImage: image).resizable().scaledToFill().opacity(ghostOpacity)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                GeometryReader { geometry in
                    oval(in: geometry.size)
                }
                .allowsHitTesting(false)
            }
            .aspectRatio(3.0 / 4.0, contentMode: .fit)
            .clipped()
            .overlay(alignment: .top) { guidanceLine }
            .overlay(alignment: .bottom) { levelIndicator }
            .overlay { cameraProblem }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var ghostVisible: Bool {
        context.ghostOverlayEnabled && ghostOn && referenceImage != nil
    }

    /// Sized to the face or torso once found, otherwise to the view's target.
    private func oval(in size: CGSize) -> some View {
        let box = context.liveGuidanceEnabled ? frame?.subjectBox : nil
        let height = (box.map { Double($0.height) } ?? target.frameFill) * size.height
        let width = box.map { Double($0.width) * size.width } ?? height * (target.subject == .face ? 0.75 : 0.6)
        let center = box.map { CGPoint(x: $0.midX * size.width, y: $0.midY * size.height) }
            ?? CGPoint(x: size.width / 2, y: size.height / 2)
        let aligned = guidance == .aligned
        return Ellipse()
            .stroke(aligned ? DSColor.success : DSColor.photoStageText, style: StrokeStyle(lineWidth: 3, dash: aligned ? [] : [8, 6]))
            .frame(width: width, height: height)
            .position(center)
            .accessibilityHidden(true)
    }

    /// One instruction at a time, in words (C14).
    private var guidanceText: String? {
        guard context.liveGuidanceEnabled, camera == .running else { return nil }
        switch guidance {
        case .searching:
            return target.subject == .face ? String(localized: "Looking for the face") : String(localized: "Looking for the body")
        case let .correct(code):
            return code.instruction
        case .aligned:
            return String(localized: "Hold still and take the photo")
        }
    }

    @ViewBuilder private var guidanceLine: some View {
        if let guidanceText {
            Label(guidanceText, systemImage: guidance == .aligned ? "checkmark.circle" : "info.circle")
                .font(DSFont.headline)
                .foregroundStyle(DSColor.photoStageText)
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, DSSpacing.sm)
                .background(DSColor.scrim, in: Capsule())
                .padding(.top, DSSpacing.md)
                .accessibilityIdentifier("capture.guidance")
        }
    }

    @ViewBuilder private var levelIndicator: some View {
        if let frame, camera == .running {
            let tilt = abs(frame.deviceRollDeg)
            Text(String(localized: "Tilt \(tilt.formatted(.number.precision(.fractionLength(1))))°"))
                .font(DSFont.caption1)
                .foregroundStyle(DSColor.photoStageText)
                .padding(.horizontal, DSSpacing.sm)
                .padding(.vertical, DSSpacing.xs)
                .background(DSColor.scrim, in: Capsule())
                .padding(.bottom, DSSpacing.sm)
                .accessibilityLabel(String(localized: "Camera tilt: \(tilt.formatted(.number.precision(.fractionLength(1)))) degrees"))
        }
    }

    @ViewBuilder private var cameraProblem: some View {
        switch camera {
        case .starting, .running:
            EmptyView()
        case .notAuthorized:
            VStack(spacing: DSSpacing.md) {
                Text("Camera access is off. Allow it in Settings to take clinical photos.")
                    .multilineTextAlignment(.center)
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .buttonStyle(DSButtonStyle(.secondary))
                .frame(maxWidth: 240)
            }
            .font(DSFont.body)
            .foregroundStyle(DSColor.photoStageText)
            .padding(DSSpacing.xl)
            .background(DSColor.scrim, in: RoundedRectangle(cornerRadius: DSRadius.lg))
        case .unavailable:
            Text("This device's camera is not available.")
                .font(DSFont.body)
                .foregroundStyle(DSColor.photoStageText)
                .padding(DSSpacing.xl)
                .background(DSColor.scrim, in: RoundedRectangle(cornerRadius: DSRadius.lg))
        }
    }

    // MARK: Bottom bar

    private var bottomBar: some View {
        VStack(spacing: DSSpacing.md) {
            strip
            if let message { DSBanner(message, tone: .danger) }
            if context.ghostOverlayEnabled { ghostControls }
            HStack(alignment: .center, spacing: DSSpacing.lg) {
                matchMeter.frame(maxWidth: .infinity, alignment: .leading)
                shutter
                Group {
                    if sizeClass == .regular, context.liveGuidanceEnabled { qualityChips }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.bottom, DSSpacing.md)
        .foregroundStyle(DSColor.photoStageText)
    }

    /// The protocol's views; the current one stays in sight (§4).
    private var strip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: DSSpacing.sm) {
                    ForEach(views) { view in
                        Button { current = view } label: {
                            HStack(spacing: DSSpacing.xs) {
                                if accepted.contains(view.viewKey) {
                                    Image(systemName: "checkmark").accessibilityLabel("Captured")
                                }
                                Text(view.name)
                            }
                            .font(DSFont.subheadline)
                            .padding(.horizontal, DSSpacing.md)
                            .frame(minHeight: DSSize.touchTarget)
                            .background(view == current ? DSColor.accent : DSColor.scrim, in: Capsule())
                            .foregroundStyle(view == current ? DSColor.textOnAccent : DSColor.photoStageText)
                        }
                        .buttonStyle(.plain)
                        .disabled(shooting)
                        .accessibilityAddTraits(view == current ? .isSelected : [])
                        .accessibilityIdentifier("capture.view.\(view.viewKey)")
                        .id(view.viewKey)
                    }
                }
            }
            .onAppear { proxy.scrollTo(current.viewKey, anchor: .center) }
            .onChange(of: current) { _, view in
                withAnimation(.easeInOut(duration: DSMotion.standard)) { proxy.scrollTo(view.viewKey, anchor: .center) }
            }
        }
    }

    @ViewBuilder private var ghostControls: some View {
        if referenceLoading {
            EmptyView()
        } else if referenceImage == nil {
            Text("No reference photo available")
                .font(DSFont.footnote)
                .foregroundStyle(DSColor.photoStageText.opacity(0.8))
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("capture.noReference")
        } else {
            HStack(spacing: DSSpacing.md) {
                if references.count > 1 {
                    Menu {
                        ForEach(references) { photo in
                            Button(photo.capturedAt.formatted(date: .abbreviated, time: .shortened)) {
                                Task { await choose(photo) }
                            }
                        }
                    } label: {
                        Label(referenceTitle, systemImage: "photo.stack").font(DSFont.footnote)
                    }
                    .accessibilityIdentifier("capture.reference")
                } else {
                    Text(referenceTitle).font(DSFont.footnote)
                }
                if ghostOn {
                    Slider(value: $ghostOpacity, in: 0.1...0.9) { Text("Ghost opacity") }
                        .accessibilityValue(Text(ghostOpacity.formatted(.percent.precision(.fractionLength(0)))))
                        .accessibilityIdentifier("capture.ghostOpacity")
                }
            }
        }
    }

    private var referenceTitle: String {
        guard let reference else { return "" }
        return String(localized: "Reference: \(reference.capturedAt.formatted(date: .abbreviated, time: .omitted))")
    }

    /// The live score against the reference photo's recorded pose, always with its label (§8).
    @ViewBuilder private var matchMeter: some View {
        if let score = liveScore {
            VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                Text(String(localized: "Position match \(score.formatted(.percent.precision(.fractionLength(0)))): \(PositionMatch.words(score))"))
                    .font(DSFont.subheadline)
                Text(PositionMatch.label).font(DSFont.caption2).foregroundStyle(DSColor.photoStageText.opacity(0.8))
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("capture.positionMatch")
        }
    }

    private var liveScore: Double? {
        guard let frame, let reference, referenceImage != nil else { return nil }
        return PositionMatch.score(live: PoseSample(frame), reference: reference.pose)
    }

    /// Fixed in place on every view and screen (C3).
    private var shutter: some View {
        Button { Task { await shoot() } } label: {
            ZStack {
                Circle().stroke(DSColor.photoStageText, lineWidth: 4).frame(width: 76, height: 76)
                Circle().fill(DSColor.photoStageText).frame(width: 62, height: 62)
            }
        }
        .buttonStyle(.plain)
        .disabled(camera != .running || shooting)
        .opacity(camera == .running ? 1 : 0.4)
        .accessibilityLabel("Take photo")
        .accessibilityIdentifier("capture.shutter")
    }

    @ViewBuilder private var qualityChips: some View {
        if let frame {
            let summary = QualitySummary(frame, target: target)
            VStack(alignment: .trailing, spacing: DSSpacing.xs) {
                chip(String(localized: "Lighting"), ok: summary.lightingOK)
                chip(String(localized: "Distance"), ok: summary.distanceOK)
                chip(String(localized: "Pose"), ok: summary.poseOK)
            }
        }
    }

    private func chip(_ title: String, ok: Bool) -> some View {
        Label(title, systemImage: ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            .font(DSFont.caption1)
            .foregroundStyle(ok ? DSColor.success : DSColor.warning)
            .padding(.horizontal, DSSpacing.sm)
            .padding(.vertical, DSSpacing.xxs)
            .background(DSColor.scrim, in: Capsule())
            .accessibilityLabel(ok ? String(localized: "\(title): good") : String(localized: "\(title): needs adjusting"))
    }

    // MARK: Camera

    /// One camera session for the whole screen; it stops when the screen closes.
    private func runCamera() async {
        let source = context.frameSource(for: target)
        self.source = source
        camera = .starting
        defer { source.stop() }
        do throws(CaptureError) {
            try await source.start()
        } catch {
            camera = error == .notAuthorized ? .notAuthorized : .unavailable
            return
        }
        camera = .running
        for await observation in source.observations {
            // The review shows the photo taken; the live frames wait.
            guard review == nil else { continue }
            frame = observation
            guidance = GuidanceEngine.evaluate(observation, target: target)
        }
    }

    private func shoot() async {
        guard let source, !shooting else { return }
        shooting = true
        defer { shooting = false }
        message = nil
        let live = frame
        let target = self.target
        do throws(CaptureError) {
            let image = try await source.capture()
            let jpeg = image.jpeg
            let blur = await Task.detached(priority: .userInitiated) { Sharpness.check(jpeg) }.value
            var checks = live.map { GuidanceEngine.liveChecks($0, target: target) } ?? []
            if let blur { checks.append(blur) }
            let pose = live.map { PoseSample($0) } ?? PoseSample()
            let score = (reference != nil && referenceImage != nil) ? reference.flatMap { PositionMatch.score(live: pose, reference: $0.pose) } : nil
            review = CaptureReview(image: image, pose: pose, checks: checks, score: score, referencePhotoId: score == nil ? nil : reference?.id)
        } catch {
            message = error == .notAuthorized
                ? String(localized: "Camera access is off. Allow it in Settings to take clinical photos.")
                : String(localized: "The photo could not be taken. Try again.")
        }
    }

    // MARK: Accepting

    private func accept(_ review: CaptureReview) async {
        let jpeg = review.image.jpeg
        let hash = await Task.detached(priority: .userInitiated) { sha256Hex(jpeg) }.value
        let record = CaptureRecord(
            photoId: UUIDv7.make(at: review.image.capturedAt),
            patientId: patientId,
            sessionId: sessionId,
            viewKey: current.viewKey,
            capturedAt: review.image.capturedAt,
            byteSize: jpeg.count,
            sha256: hash,
            widthPx: review.image.widthPx,
            heightPx: review.image.heightPx,
            deviceModel: review.image.deviceModel,
            pose: review.pose,
            positionMatchScore: review.score,
            referencePhotoId: review.referencePhotoId,
            checks: review.checks
        )
        do {
            try await context.queue.enqueue(record, image: jpeg)
        } catch {
            message = String(localized: "The photo could not be saved on this device.")
            self.review = nil
            return
        }
        accepted.insert(current.viewKey)
        self.review = nil
        // Uploads continue in the background, also after this screen closes.
        let context = self.context
        Task { await context.sync() }
        let next = views.first { $0.isRequired && !accepted.contains($0.viewKey) }
            ?? views.first { !accepted.contains($0.viewKey) }
        if let next {
            current = next
        } else {
            dismiss()
        }
    }

    // MARK: Loading

    /// Views already captured in this session, on the server or waiting on this device.
    private func loadAccepted() async {
        let local = await context.queue.captures().filter { $0.record.sessionId == sessionId }
        for capture in local {
            switch capture.stage {
            case .queued, .scanning: accepted.insert(capture.record.viewKey)
            case .rejected, .failed: continue
            }
        }
        do throws(APIError) {
            let session = try await context.repository.session(patientId: patientId, sessionId: sessionId)
            for view in session.views where view.captured { accepted.insert(view.viewKey) }
        } catch {
            context.note(error)
        }
    }

    /// Earlier accepted photos of this view; the latest is the default reference (K2-12).
    private func loadReferences() async {
        referenceLoading = true
        references = []
        reference = nil
        referenceImage = nil
        defer { referenceLoading = false }
        guard context.ghostOverlayEnabled, context.can("photo.view") else { return }
        let viewKey = current.viewKey
        let now = Date()
        let candidates: [PhotoItem]
        do throws(APIError) {
            candidates = try await context.repository.photos(patientId: patientId, viewKey: viewKey)
            context.reachedServer()
        } catch {
            context.note(error)
            candidates = context.cachedPhotos(patientId: patientId).filter { $0.viewKey == viewKey }
        }
        references = candidates
            .filter { $0.status == "ACCEPTED" && $0.preview == .available && $0.capturedAt < now }
            .sorted { $0.capturedAt > $1.capturedAt }
        if let latest = references.first { await choose(latest) }
    }

    private func choose(_ photo: PhotoItem) async {
        let images = await context.derivatives(patientId: patientId, photoIds: [photo.id], variant: .displayPreview)
        if let data = images[photo.id] {
            reference = photo
            referenceImage = data
        } else if reference == nil {
            referenceImage = nil
        }
    }
}

/// A captured photo awaiting the photographer's decision.
struct CaptureReview: Equatable {
    let image: CapturedImage
    let pose: PoseSample
    let checks: [QualityCheckResult]
    let score: Double?
    let referencePhotoId: String?
}

/// Post-capture review (Bible §6.3 steps 7–8): the photo, its checks in words
/// and the position match. The photographer accepts or retakes; nothing blocks.
struct CaptureReviewView: View {
    let review: CaptureReview
    let viewName: String
    let retake: () -> Void
    let accept: () -> Void

    var body: some View {
        VStack(spacing: DSSpacing.md) {
            Group {
                if let image = UIImage(data: review.image.jpeg) {
                    Image(uiImage: image).resizable().scaledToFit()
                        .accessibilityLabel(String(localized: "Captured photo: \(viewName)"))
                } else {
                    DSColor.photoStage
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            VStack(alignment: .leading, spacing: DSSpacing.xs) {
                ForEach(review.checks, id: \.code) { check in
                    Label(Self.text(check), systemImage: check.passed ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .font(DSFont.subheadline)
                        .foregroundStyle(check.passed ? DSColor.success : DSColor.warning)
                }
                if let score = review.score {
                    Text(String(localized: "Position match \(score.formatted(.percent.precision(.fractionLength(0)))): \(PositionMatch.words(score))"))
                        .font(DSFont.subheadline)
                    Text(PositionMatch.label).font(DSFont.caption2).opacity(0.8)
                }
            }
            .foregroundStyle(DSColor.photoStageText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("capture.checks")
            HStack(spacing: DSSpacing.md) {
                Button("Retake", action: retake)
                    .buttonStyle(DSButtonStyle(.secondary))
                    .accessibilityIdentifier("capture.retake")
                Button("Accept", action: accept)
                    .buttonStyle(DSButtonStyle(.primary))
                    .accessibilityIdentifier("capture.accept")
            }
        }
        .padding(DSSpacing.lg)
    }

    /// A check in words: what passed, or the one instruction for what did not.
    static func text(_ check: QualityCheckResult) -> String {
        if !check.passed { return check.code.instruction }
        switch check.code {
        case .levelCamera: return String(localized: "Camera level")
        case .lightingTooDark: return String(localized: "Lighting good")
        case .retakeMotionBlur: return String(localized: "Sharp, no motion blur")
        default: return check.code.instruction
        }
    }
}
