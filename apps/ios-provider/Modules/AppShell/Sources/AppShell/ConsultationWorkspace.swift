// The consultation workspace (Bible §5.1; ADR-0026 K3-21): the Layer 3 steps
// of a consultation in Bible order. On iPad a stepper: the steps in a fixed
// column and the chosen step beside them, each leading to the next. A split
// view is not used: in portrait it hid the steps behind a sidebar button. On
// iPhone the same steps as a list in a navigation stack. Steps of later layers
// are not shown. Opened full screen from the patient profile's Consultations
// tab.
// Bible §5.1, §24.4–24.5 · tier: app · Layer 3.
import ConsultationDomain
import DesignSystem
import PatientDomain
import SwiftUI

/// The Bible §5.1 steps that exist in Layer 3, in order.
enum WorkspaceStep: String, CaseIterable, Identifiable, Hashable {
    case reason
    case history
    case photography
    case annotate
    case beforeAfter
    case notes
    case summary
    case completion

    var id: String { rawValue }

    var title: String {
        switch self {
        case .reason: String(localized: "Reason and concerns")
        case .history: String(localized: "Medical history")
        case .photography: String(localized: "Photography")
        case .annotate: String(localized: "Annotate")
        case .beforeAfter: String(localized: "Before and after")
        case .notes: String(localized: "Notes")
        case .summary: String(localized: "Summary")
        case .completion: String(localized: "Review and completion")
        }
    }

    var systemImage: String {
        switch self {
        case .reason: "text.bubble"
        case .history: "list.clipboard"
        case .photography: "camera"
        case .annotate: "pencil.tip.crop.circle"
        case .beforeAfter: "rectangle.split.2x1"
        case .notes: "note.text"
        case .summary: "doc.text"
        case .completion: "checkmark.seal"
        }
    }

    var next: WorkspaceStep? {
        let all = Self.allCases
        guard let at = all.firstIndex(of: self), at + 1 < all.count else { return nil }
        return all[at + 1]
    }
}

struct ConsultationWorkspace: View {
    @State private var model: WorkspaceModel
    @State private var step: WorkspaceStep = .reason
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dismiss) private var dismiss

    init(work: ConsultationWork, patient: Patient, consultation: Consultation) {
        _model = State(initialValue: WorkspaceModel(work: work, patient: patient, consultation: consultation))
    }

    var body: some View {
        Group {
            if sizeClass == .regular {
                NavigationStack {
                    HStack(spacing: 0) {
                        List(WorkspaceStep.allCases) { item in
                            Button {
                                step = item
                            } label: {
                                StepLabel(step: item, number: number(of: item))
                                    .foregroundStyle(step == item ? DSColor.accentText : DSColor.textPrimary)
                            }
                            .listRowBackground(step == item ? DSColor.accentSoft : DSColor.surface)
                            .accessibilityAddTraits(step == item ? .isSelected : [])
                        }
                        .listStyle(.insetGrouped)
                        .frame(width: DSSize.sidebarWidth)
                        Divider()
                        StepScreen(model: model, step: step) { step = $0 }
                            .frame(maxWidth: .infinity)
                    }
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { closeButton }
                }
            } else {
                NavigationStack {
                    List(WorkspaceStep.allCases) { item in
                        NavigationLink(value: item) {
                            StepLabel(step: item, number: number(of: item))
                        }
                    }
                    .navigationTitle(model.patient.displayName)
                    .navigationBarTitleDisplayMode(.inline)
                    .navigationDestination(for: WorkspaceStep.self) { item in
                        StepScreen(model: model, step: item, go: nil)
                    }
                    .toolbar { closeButton }
                }
            }
        }
        .tint(DSColor.accent)
        .task { await model.load() }
    }

    private var closeButton: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Close") { dismiss() }
                .accessibilityIdentifier("workspace.close")
        }
    }

    private func number(of step: WorkspaceStep) -> Int {
        (WorkspaceStep.allCases.firstIndex(of: step) ?? 0) + 1
    }
}

struct StepLabel: View {
    let step: WorkspaceStep
    let number: Int

    var body: some View {
        Label {
            Text("\(number). \(step.title)")
        } icon: {
            Image(systemName: step.systemImage)
        }
        .frame(minHeight: DSSize.touchTarget)
        .accessibilityIdentifier("workspace.step.\(step.rawValue)")
    }
}

/// One step: the consultation's state, then the step itself, then the way to the next step.
struct StepScreen: View {
    let model: WorkspaceModel
    let step: WorkspaceStep
    /// Moves the stepper on iPad; nil on iPhone, where the list leads.
    let go: ((WorkspaceStep) -> Void)?

    var body: some View {
        Group {
            if let failure = model.failure {
                DSStateView(failure) { Task { await model.load() } }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: DSSpacing.xl) {
                        WorkspaceHeader(model: model)
                        content
                        if let go, let next = step.next {
                            Button("Next: \(next.title)") { go(next) }
                                .buttonStyle(DSButtonStyle(.secondary))
                                .accessibilityIdentifier("workspace.next")
                        }
                    }
                    .padding(DSSpacing.xxl)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .background(DSColor.canvas)
            }
        }
        .navigationTitle(step.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .reason: ReasonStep(model: model)
        case .history: HistoryStep(model: model)
        case .photography: PhotographyStep(model: model)
        case .annotate: AnnotateStep(model: model)
        case .beforeAfter: BeforeAfterStep(model: model)
        case .notes: NotesStep(model: model)
        case .summary: SummaryStep(model: model)
        case .completion: CompletionStep(model: model)
        }
    }
}

/// The consultation's state and anything the provider should know before acting.
struct WorkspaceHeader: View {
    let model: WorkspaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack(spacing: DSSpacing.sm) {
                Text("Consultation").font(DSFont.title3).foregroundStyle(DSColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                ConsultationStatusBadge(status: model.consultation.status)
                    .accessibilityIdentifier("workspace.status")
                if model.busy { ProgressView() }
            }
            if model.offline {
                DSBanner(String(localized: "You are offline. This is the copy saved on this device. Note drafts are sent when you reconnect; everything else needs a connection."),
                         tone: .info)
                    .accessibilityIdentifier("workspace.offline")
            }
            if let message = model.message {
                DSBanner(message, tone: .danger)
                    .accessibilityIdentifier("workspace.message")
            }
        }
    }
}
