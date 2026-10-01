// New patient with the duplicate check (Bible §4.2; spec §6.3; ADR-0021
// "duplicate matching"). Probable duplicates are shown first; creating anyway
// is an explicit choice that the server records. Online only (ADR-0018 K-17).
// Bible §4.2 · tier: app · Layer 1.
import CoreNetworking
import DesignSystem
import PatientDomain
import SwiftUI

struct CreatePatientView: View {
    let repository: PatientRepository
    let created: (String) -> Void
    let openExisting: (String) -> Void

    @State private var draft = PatientDraft()
    @State private var dateOfBirthChosen = false
    @State private var candidates: [DuplicateCandidate]?
    @State private var busy = false
    @State private var error: APIError?
    /// One key per draft: a retry of the same draft cannot create a second patient.
    @State private var idempotencyKey = newIdempotencyKey()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    Section { DSBanner(error.displayMessage, tone: .danger) }
                }
                Section("Name") {
                    TextField("First name", text: $draft.firstName)
                        .textContentType(.givenName)
                        .accessibilityIdentifier("patient.firstName")
                    TextField("Last name", text: $draft.lastName)
                        .textContentType(.familyName)
                        .accessibilityIdentifier("patient.lastName")
                    TextField("Preferred name (optional)", text: $draft.preferredName)
                }
                Section("Date of birth") {
                    DatePicker("Date of birth", selection: $draft.dateOfBirth, in: ...Date(), displayedComponents: .date)
                        // Wheels reach a birth year quickly; a calendar starts at this month.
                        .datePickerStyle(.wheel)
                        .onChange(of: draft.dateOfBirth) { dateOfBirthChosen = true }
                        .accessibilityIdentifier("patient.dateOfBirth")
                }
                Section("Contact (optional)") {
                    TextField("Email", text: $draft.email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Mobile phone", text: $draft.phone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                }
                if let candidates, !candidates.isEmpty {
                    duplicates(candidates)
                }
            }
            .navigationTitle("New patient")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create patient") { Task { await checkThenCreate() } }
                        .disabled(!isComplete || busy || candidates?.isEmpty == false)
                        .accessibilityIdentifier("patient.create")
                }
            }
            .disabled(busy)
            .onChange(of: draft) {
                // A changed draft is a different request: new key, new duplicate check.
                idempotencyKey = newIdempotencyKey()
                candidates = nil
            }
        }
        .interactiveDismissDisabled(busy)
    }

    private var isComplete: Bool {
        !draft.firstName.trimmingCharacters(in: .whitespaces).isEmpty
            && !draft.lastName.trimmingCharacters(in: .whitespaces).isEmpty
            && dateOfBirthChosen
    }

    private func duplicates(_ candidates: [DuplicateCandidate]) -> some View {
        Section {
            ForEach(candidates) { candidate in
                VStack(alignment: .leading, spacing: DSSpacing.xs) {
                    if let summary = candidate.summary {
                        Text(summary.displayName).font(DSFont.headline)
                        Text("Born \(summary.dateOfBirth)").font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                    } else {
                        Text("A patient you cannot open").font(DSFont.headline)
                    }
                    Text("Matches on \(candidate.reasonText)").font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                    if candidate.summary != nil {
                        Button("Open this patient") { openExisting(candidate.id) }
                    }
                }
                .padding(.vertical, DSSpacing.xxs)
            }
            Button("Create a new patient anyway", role: .destructive) {
                Task { await create(confirmNoDuplicate: true) }
            }
            .accessibilityIdentifier("patient.createAnyway")
        } header: {
            Text("Possible duplicates")
        } footer: {
            Text("Check these records before creating a new one. Duplicate records split a patient's history.")
        }
    }

    private func checkThenCreate() async {
        busy = true
        error = nil
        defer { busy = false }
        do throws(APIError) {
            let found = try await repository.duplicates(of: draft)
            if found.isEmpty {
                await create(confirmNoDuplicate: false)
            } else {
                candidates = found
            }
        } catch {
            self.error = error
        }
    }

    private func create(confirmNoDuplicate: Bool) async {
        busy = true
        error = nil
        defer { busy = false }
        do throws(APIError) {
            let patient = try await repository.create(draft, confirmNoDuplicate: confirmNoDuplicate, idempotencyKey: idempotencyKey)
            created(patient.id)
        } catch let error where error.code == "DUPLICATE_PATIENT_SUSPECTED" {
            // A duplicate appeared since the check: show the current candidates.
            candidates = (try? await repository.duplicates(of: draft)) ?? []
        } catch {
            self.error = error
        }
    }
}
