// Patient list, search and the profile shell (Bible §4; spec §6.3 "Patients";
// roadmap M1.10). The search term is sent in a request body, never in a URL
// (ADR-0020). Permissions here only shape the UI; the server decides.
// Bible §4 · tier: app · Layer 1.
import Authentication
import CoreNetworking
import DesignSystem
import PatientDomain
import SwiftUI

struct PatientsSplitView: View {
    let repository: PatientRepository
    let session: SessionSummary?
    @State private var selection: PatientSummary.ID?
    /// A patient to open once the reloaded list shows it (see PatientListView.load).
    @State private var pendingSelection: PatientSummary.ID?
    @State private var creating = false
    @State private var reload = 0

    var body: some View {
        NavigationSplitView {
            PatientListView(repository: repository, selection: $selection, pendingSelection: $pendingSelection, reload: reload)
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
                PatientProfileView(repository: repository, patientId: selection)
                    .id(selection)
            } else {
                DSStateView(.empty(title: "No patient selected", message: "Search for a patient or choose one from the list."))
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

struct PatientListView: View {
    let repository: PatientRepository
    @Binding var selection: PatientSummary.ID?
    @Binding var pendingSelection: PatientSummary.ID?
    let reload: Int
    @State private var text = ""
    @State private var state: ListState = .loading

    enum ListState: Equatable {
        case loading
        case loaded([PatientSummary])
        case failed(DSViewState)
    }

    var body: some View {
        content
            .searchable(text: $text, prompt: "Name, date of birth (YYYY-MM-DD), email or phone")
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .task(id: TaskKey(text: text, reload: reload)) { await load() }
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
                DSStateView(.empty(title: "No matches", message: "Check the spelling, or search by date of birth, email or phone."))
            }
        case let .loaded(patients):
            List(patients, selection: $selection) { patient in
                PatientRow(patient: patient).tag(patient.id)
            }
            .listStyle(.sidebar)
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
            state = .loaded(patients)
        } catch {
            if Task.isCancelled { return }
            state = .failed(error.viewState)
        }
        // Select only after the list holds the patient's row. On iPhone the list's
        // selection drives the pushed profile: selecting first and then adding the
        // row pushed the profile a second time, and that copy never loaded.
        if let pending = pendingSelection {
            pendingSelection = nil
            selection = pending
        }
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
