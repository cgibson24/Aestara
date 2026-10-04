// The patient profile shell (Bible §4.3; PR-PATIENT-06; roadmap M1.10): the
// header and all twelve tabs. The server says which tabs the caller's role may
// read; the clinical content of each tab arrives with its layer, so a readable
// tab without it shows its empty state. Photos arrive in Layer 2; the
// timeline, consultations, before/after and documents in Layer 3. Opening the
// profile is audited by the server.
// Bible §4.3 · tier: app · Layers 1–3.
import CoreNetworking
import DesignSystem
import DocumentsConsent
import Observation
import PatientDomain
import Photography
import SwiftUI

/// One patient's profile, loaded once per selection and shared by every copy of its
/// screen. On iPhone the list's selection drives the pushed profile, and SwiftUI can
/// briefly hold two copies of it of which only one runs its task; with the state here,
/// whichever copy is on screen shows the loaded profile.
@MainActor
@Observable
final class PatientProfileModel {
    enum LoadState: Equatable {
        case loading
        case loaded(PatientProfile)
        case failed(DSViewState)
    }

    let patientId: String
    private(set) var state: LoadState = .loading
    private(set) var offline = false
    let repository: PatientRepository
    private let photography: PhotographyContext
    private var inFlight = false

    init(patientId: String, repository: PatientRepository, photography: PhotographyContext) {
        self.patientId = patientId
        self.repository = repository
        self.photography = photography
    }

    /// Loads unless a load is running or the profile is already here.
    func loadIfNeeded() async {
        if case .loaded = state { return }
        await load()
    }

    func load() async {
        guard !inFlight else { return }
        inFlight = true
        defer { inFlight = false }
        state = .loading
        do throws(APIError) {
            let profile = try await repository.profile(id: patientId)
            offline = false
            state = .loaded(profile)
            // The offline copy is written in the background; the screen never waits for it.
            let cache = photography.patients
            Task { await cache.save(profile) }
        } catch {
            if error.status == 0, let saved = await photography.patients.profile(id: patientId) {
                offline = true
                state = .loaded(saved)
                await photography.recordOfflinePatientView(patientId)
                return
            }
            // 404 covers both "does not exist" and "not visible to you" (spec §4.6).
            state = .failed(error.status == 404
                ? .error(message: "This patient is not available.", reference: error.requestId)
                : error.viewState)
        }
    }
}

struct PatientProfileView: View {
    let model: PatientProfileModel
    let photography: PhotographyContext
    let consultations: ConsultationWork
    @State private var tab: ProfileTab = .overview

    var body: some View {
        Group {
            switch model.state {
            case .loading:
                DSStateView(.loading("Opening patient"))
            case let .failed(viewState):
                DSStateView(viewState) { Task { await model.load() } }
            case let .loaded(profile):
                VStack(spacing: 0) {
                    ProfileHeader(patient: profile.patient)
                    if model.offline {
                        DSBanner("You are offline. This is the copy saved on this device; photos you take upload when you reconnect.", tone: .info)
                            .padding(.horizontal, DSSpacing.lg)
                            .padding(.vertical, DSSpacing.sm)
                    }
                    TabStrip(selection: $tab)
                    Divider()
                    ScrollView {
                        TabContent(tab: tab, profile: profile, photography: photography, consultations: consultations,
                                   repository: model.repository)
                            .padding(DSSpacing.xxl)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .background(DSColor.canvas)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        // Again for a new model in the same place, as after a new selection of the same patient.
        .task(id: ObjectIdentifier(model)) { await model.loadIfNeeded() }
        .traceLifecycle("PatientProfileView")
    }

    private var title: String {
        if case let .loaded(profile) = model.state { return profile.patient.displayName }
        return "Patient"
    }
}

struct ProfileHeader: View {
    let patient: Patient

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            HStack(spacing: DSSpacing.sm) {
                Text(patient.displayName)
                    .font(DSFont.title2)
                    .foregroundStyle(DSColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                if patient.status != "ACTIVE" { DSBadge(patient.status.capitalized) }
            }
            HStack(spacing: DSSpacing.lg) {
                Text("Born \(patient.dateOfBirth)")
                if let mrn = patient.mrn { Text("MRN \(mrn)") }
            }
            .font(DSFont.subheadline)
            .foregroundStyle(DSColor.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, DSSpacing.xxl)
        .padding(.vertical, DSSpacing.lg)
        .background(DSColor.surface)
    }
}

/// All twelve tabs in Bible order, scrolling sideways on narrow screens.
struct TabStrip: View {
    @Binding var selection: ProfileTab

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DSSpacing.xs) {
                ForEach(ProfileTab.allCases) { tab in
                    Button {
                        selection = tab
                    } label: {
                        Label(tab.title, systemImage: tab.systemImage)
                            .font(DSFont.subheadline.weight(selection == tab ? .semibold : .regular))
                            .padding(.horizontal, DSSpacing.md)
                            .frame(minHeight: DSSize.touchTarget)
                            .foregroundStyle(selection == tab ? DSColor.accentText : DSColor.textSecondary)
                            .background(selection == tab ? DSColor.accentSoft : .clear, in: Capsule())
                            // The whole capsule takes the tap, not only the label's glyphs (C1: 44 pt).
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selection == tab ? .isSelected : [])
                    .accessibilityIdentifier("profile.tab.\(tab.rawValue)")
                }
            }
            .padding(.horizontal, DSSpacing.lg)
            .padding(.vertical, DSSpacing.xs)
        }
        .background(DSColor.surface)
    }
}

struct TabContent: View {
    let tab: ProfileTab
    let profile: PatientProfile
    let photography: PhotographyContext
    let consultations: ConsultationWork
    let repository: PatientRepository

    var body: some View {
        if !profile.readableTabs.contains(tab) {
            DSStateView(.permissionDenied)
        } else {
            switch tab {
            case .overview:
                OverviewTab(patient: profile.patient)
            case .timeline:
                TimelineTab(repository: repository, patientId: profile.patient.id)
            case .consultations:
                ConsultationsTab(work: consultations, patient: profile.patient)
            case .photos:
                PhotosTabView(context: photography, patientId: profile.patient.id)
            case .beforeAfter:
                ComparisonList(work: consultations, patientId: profile.patient.id, consultationId: nil)
            case .documents:
                DocumentsTabView(repository: consultations.documents, patientId: profile.patient.id,
                                 canManage: consultations.can("document.manage"))
            default:
                DSStateView(.empty(title: "Nothing here yet", message: tab.emptyMessage))
            }
        }
    }
}

struct OverviewTab: View {
    let patient: Patient

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            Text("Demographics").font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
            Grid(alignment: .leading, horizontalSpacing: DSSpacing.xl, verticalSpacing: DSSpacing.sm) {
                row("First name", patient.firstName)
                if let middle = patient.middleName { row("Middle name", middle) }
                row("Last name", patient.lastName)
                if let preferred = patient.preferredName { row("Preferred name", preferred) }
                row("Date of birth", patient.dateOfBirth)
                row("Email", patient.email ?? "Not recorded")
                row("Phone", patient.phone ?? "Not recorded")
                row("MRN", patient.mrn ?? "Not assigned")
                row("Status", patient.status.capitalized)
            }
            .font(DSFont.body)
        }
        .padding(DSSpacing.xl)
        .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.lg))
    }

    private func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(DSColor.textSecondary)
            Text(value).foregroundStyle(DSColor.textPrimary).textSelection(.enabled)
        }
    }
}

extension ProfileTab {
    /// What will appear in the tab, without promising anything about outcomes.
    var emptyMessage: String {
        switch self {
        case .overview: "No details recorded."
        case .timeline: "Visits, photos and documents will appear here in date order."
        case .consultations: "This patient has no consultations."
        case .photos: "This patient has no clinical photos."
        case .beforeAfter: "Before and after comparisons will appear here once photos exist."
        case .simulations: "This patient has no AI visualizations."
        case .treatmentPlans: "This patient has no treatment plans."
        case .procedures: "This patient has no recorded procedures."
        case .documents: "This patient has no documents or consents."
        case .instructions: "No care instructions have been assigned."
        case .appointments: "This patient has no appointments."
        case .messages: "There are no messages with this patient."
        }
    }
}
