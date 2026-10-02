// Patient list, search and the profile shell (Bible §4; spec §6.3 "Patients";
// roadmap M1.10). The search term is sent in a request body, never in a URL
// (ADR-0020). Offline, the recent patients saved on the device are shown and
// search waits for the connection (ADR-0023 K2-17). Permissions here only
// shape the UI; the server decides.
// Bible §4, §23 · tier: app · Layers 1–2.
import Authentication
import CoreNetworking
import DesignSystem
import PatientDomain
import Photography
import SwiftUI

struct PatientsSplitView: View {
    let repository: PatientRepository
    let session: SessionSummary?
    let photography: PhotographyContext
    @State private var selection: PatientSummary.ID?
    /// A patient to open once the reloaded list shows it (see PatientListView.load).
    @State private var pendingSelection: PatientSummary.ID?
    @State private var creating = false
    @State private var reload = 0
    /// The selected patient's profile, shared by every copy of its screen.
    @State private var profiles: ProfileModels

    init(repository: PatientRepository, session: SessionSummary?, photography: PhotographyContext) {
        self.repository = repository
        self.session = session
        self.photography = photography
        _profiles = State(initialValue: ProfileModels(repository: repository, photography: photography))
    }

    var body: some View {
        NavigationSplitView {
            PatientListView(repository: repository, cache: photography.patients, selection: $selection,
                            pendingSelection: $pendingSelection, reload: reload)
                .navigationTitle("Patients")
                .toolbar {
                    if session?.can("patient.create") == true {
                        ToolbarItem(placement: .primaryAction) {
                            Button("New patient", systemImage: "plus") { creating = true }
                                .accessibilityIdentifier("patients.new")
                        }
                    }
                }
        } detail: {
            if let selection {
                PatientProfileView(model: profiles.model(for: selection), photography: photography)
                    .id(selection)
            } else {
                DSStateView(.empty(title: "No patient selected", message: "Search for a patient or choose one from the list."))
            }
        }
        // One load per selection, started as soon as the patient is selected.
        .onChange(of: selection, initial: true) { _, id in
            if let id {
                profiles.select(id)
            } else {
                profiles.clear()
            }
        }
        .sheet(isPresented: $creating) {
            CreatePatientView(repository: repository) { patientId in
                creating = false
                pendingSelection = patientId
                reload += 1
            } openExisting: { patientId in
                creating = false
                pendingSelection = patientId
                reload += 1
            }
        }
    }
}

/// The selected patient's profile model, shared by every copy of its screen. On iPhone
/// the list's selection pushes the profile screen, sometimes twice, and a pushed copy
/// keeps the values it was pushed with. So each copy takes its patient's model when it
/// is built, never waiting for one to arrive: the selection's own model, or a new one
/// that its screen then loads. A new selection always starts a new model, so every
/// opening of a profile is loaded, and audited, by the server. Not observed: a lookup
/// while a view is built changes nothing on screen.
@MainActor
final class ProfileModels {
    private var current: PatientProfileModel?
    private let repository: PatientRepository
    private let photography: PhotographyContext

    init(repository: PatientRepository, photography: PhotographyContext) {
        self.repository = repository
        self.photography = photography
    }

    /// The model for a patient: the current one if it is theirs, otherwise a new one.
    func model(for patientId: PatientSummary.ID) -> PatientProfileModel {
        if let current, current.patientId == patientId { return current }
        let model = PatientProfileModel(patientId: patientId, repository: repository, photography: photography)
        current = model
        return model
    }

    /// A patient was selected: their model starts loading at once.
    func select(_ patientId: PatientSummary.ID) {
        let model = model(for: patientId)
        Task { await model.loadIfNeeded() }
    }

    /// Nothing is selected: the next selection starts afresh.
    func clear() {
        current = nil
    }
}

struct PatientListView: View {
    let repository: PatientRepository
    /// The recent list saved on this device, shown when offline (ADR-0023 K2-17).
    let cache: PatientCache
    @Binding var selection: PatientSummary.ID?
    @Binding var pendingSelection: PatientSummary.ID?
    let reload: Int
    @State private var text = ""
    @State private var state: ListState = .loading
    @State private var offline = false

    enum ListState: Equatable {
        case loading
        case loaded([PatientSummary])
        case failed(DSViewState)
    }

    var body: some View {
        content
            // The system's short prompt, which fits at every text size; the formats are
            // named when nothing matches.
            .searchable(text: $text)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .task(id: TaskKey(text: text, reload: reload)) { await load() }
            // Runs after the update that shows the new list has been applied.
            .onChange(of: state) { applyPendingSelection() }
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .loading:
            DSStateView(.loading("Loading patients"))
        case let .failed(viewState):
            DSStateView(viewState) { Task { await load() } }
        case let .loaded(patients) where patients.isEmpty:
            if SearchQuery(text) == nil {
                DSStateView(.empty(title: "No patients yet", message: "Patients you add appear here."))
            } else {
                DSStateView(.empty(title: "No matches", message: "Search by name, date of birth (YYYY-MM-DD), email or phone. Check the spelling."))
            }
        case let .loaded(patients):
            List(patients, selection: $selection) { patient in
                PatientRow(patient: patient).tag(patient.id)
            }
            .listStyle(.sidebar)
            .safeAreaInset(edge: .top) {
                if offline {
                    DSBanner("You are offline. These are the recent patients saved on this device.", tone: .info)
                        .padding(.horizontal, DSSpacing.lg)
                }
            }
        }
    }

    private struct TaskKey: Equatable {
        let text: String
        let reload: Int
    }

    private func load() async {
        let query = SearchQuery(text)
        if query != nil {
            // Wait for typing to pause before searching.
            try? await Task.sleep(for: .milliseconds(350))
            if Task.isCancelled { return }
        }
        if case .loaded = state {} else { state = .loading }
        do throws(APIError) {
            let patients: [PatientSummary]
            if let query {
                patients = try await repository.search(query)
            } else {
                patients = try await repository.recent()
            }
            if Task.isCancelled { return }
            offline = false
            let unchanged = state == .loaded(patients)
            state = .loaded(patients)
            // The same list again: no change will apply the selection, so apply it now.
            if unchanged { applyPendingSelection() }
            if query == nil {
                // Saved for offline use in the background; the list never waits for it.
                let cache = self.cache
                Task { await cache.saveRecent(patients) }
            }
        } catch {
            if Task.isCancelled { return }
            if error.status == 0, query == nil, let saved = await cache.recent() {
                offline = true
                state = .loaded(saved)
            } else {
                state = .failed(error.viewState)
            }
        }
    }

    /// Selects a newly created patient only once the list on screen holds its row. On
    /// iPhone the list's selection drives the pushed profile: selecting while the row was
    /// being added pushed the profile a second time, and that copy never loaded. So the
    /// selection waits for the update that shows the row, not the one that adds it.
    private func applyPendingSelection() {
        guard case .loaded = state, let pending = pendingSelection else { return }
        pendingSelection = nil
        selection = pending
    }
}

struct PatientRow: View {
    let patient: PatientSummary

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            HStack {
                Text(patient.displayName).font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                if patient.status != "ACTIVE" {
                    DSBadge(patient.status.capitalized)
                }
            }
            HStack(spacing: DSSpacing.sm) {
                Text("Born \(patient.dateOfBirth)")
                if let mrn = patient.mrn { Text("MRN \(mrn)") }
            }
            .font(DSFont.footnote)
            .foregroundStyle(DSColor.textSecondary)
        }
        .padding(.vertical, DSSpacing.xxs)
        .accessibilityElement(children: .combine)
    }
}

extension APIError {
    /// The data-view state for a failed load (DESIGN_SYSTEM.md §6).
    var viewState: DSViewState {
        switch code {
        case "OFFLINE": .offline
        case "PERMISSION_DENIED": .permissionDenied
        default: .error(message: displayMessage, reference: requestId)
        }
    }
}
