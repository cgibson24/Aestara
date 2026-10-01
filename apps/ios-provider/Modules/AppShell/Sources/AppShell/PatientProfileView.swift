// The patient profile shell (Bible §4.3; PR-PATIENT-06; roadmap M1.10): the
// header and all twelve tabs. The server says which tabs the caller's role may
// read; the clinical content of each tab arrives with its layer, so a readable
// tab without it shows its empty state. Photos arrive in Layer 2. Opening the
// profile is audited by the server.
// Bible §4.3 · tier: app · Layers 1–2.
import CoreNetworking
import DesignSystem
import PatientDomain
import Photography
import SwiftUI

struct PatientProfileView: View {
    let repository: PatientRepository
    let photography: PhotographyContext
    let patientId: String
    @State private var state: LoadState = .loading
    @State private var tab: ProfileTab = .overview
    @State private var offline = false

    enum LoadState: Equatable {
        case loading
        case loaded(PatientProfile)
        case failed(DSViewState)
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                DSStateView(.loading("Opening patient"))
            case let .failed(viewState):
                DSStateView(viewState) { Task { await load() } }
            case let .loaded(profile):
                VStack(spacing: 0) {
                    ProfileHeader(patient: profile.patient)
                    if offline {
                        DSBanner("You are offline. This is the copy saved on this device; photos you take upload when you reconnect.", tone: .info)
                            .padding(.horizontal, DSSpacing.lg)
                            .padding(.vertical, DSSpacing.sm)
                    }
                    TabStrip(selection: $tab)
                    Divider()
                    ScrollView {
                        TabContent(tab: tab, profile: profile, photography: photography)
                            .padding(DSSpacing.xxl)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .background(DSColor.canvas)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var title: String {
        if case let .loaded(profile) = state { return profile.patient.displayName }
        return "Patient"
    }

    private func load() async {
        state = .loading
        do throws(APIError) {
            let profile = try await repository.profile(id: patientId)
            await photography.patients.save(profile)
            offline = false
            state = .loaded(profile)
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

    var body: some View {
        if !profile.readableTabs.contains(tab) {
            DSStateView(.permissionDenied)
        } else if tab == .overview {
            OverviewTab(patient: profile.patient)
        } else if tab == .photos {
            PhotosTabView(context: photography, patientId: profile.patient.id)
        } else {
            DSStateView(.empty(title: "Nothing here yet", message: tab.emptyMessage))
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
