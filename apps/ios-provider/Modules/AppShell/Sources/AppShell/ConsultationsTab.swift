// The patient profile's Consultations tab (Bible §4.3, §5; ADR-0026 K3-02,
// K3-06, K3-21): the patient's consultations, newest first, archived ones only
// when asked for and then with a badge; a new consultation in a practice; and
// the way into the workspace. Online, the open consultations are saved on the
// device for offline use; offline, that copy is shown and nothing new can be
// created. The buttons follow the role's permissions; the server decides.
// Bible §5 · tier: app · Layer 3.
import ConsultationDomain
import CoreNetworking
import DesignSystem
import PatientDomain
import SwiftUI

struct ConsultationsTab: View {
    let work: ConsultationWork
    let patient: Patient
    @State private var consultations: [Consultation] = []
    @State private var state: DSViewState? = .loading("Loading consultations")
    @State private var offline = false
    @State private var showArchived = false
    @State private var creating = false
    /// Created in the sheet; opened once the sheet has gone.
    @State private var created: Consultation?
    @State private var opened: Consultation?
    @State private var reloads = 0

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            if work.can("consultation.create"), !offline {
                Button("New consultation", systemImage: "plus") { creating = true }
                    .buttonStyle(DSButtonStyle(.primary))
                    .accessibilityIdentifier("consultations.new")
            }
            if offline {
                DSBanner(String(localized: "You are offline. These are the open consultations saved on this device."), tone: .info)
            }
            if !work.problems.isEmpty {
                DSBanner(work.problems.count == 1
                    ? String(localized: "1 note draft needs your decision. Open its consultation.")
                    : String(localized: "\(work.problems.count) note drafts need your decision. Open their consultations."),
                    tone: .warning)
                    .accessibilityIdentifier("consultations.problems")
            }
            if !offline {
                Toggle("Show archived consultations", isOn: $showArchived)
                    .font(DSFont.subheadline)
                    .accessibilityIdentifier("consultations.showArchived")
            }
            if let state {
                DSStateView(state) { reloads += 1 }
            } else {
                ForEach(consultations) { consultation in
                    ConsultationRow(consultation: consultation) { opened = consultation }
                }
            }
        }
        .task(id: LoadKey(showArchived: showArchived, reloads: reloads)) { await load() }
        .sheet(isPresented: $creating, onDismiss: {
            guard let consultation = created else { return }
            created = nil
            opened = consultation
        }) {
            NewConsultationSheet(work: work, patientId: patient.id) { consultation in
                created = consultation
                creating = false
            }
        }
        .fullScreenCover(item: $opened, onDismiss: { reloads += 1 }) { consultation in
            ConsultationWorkspace(work: work, patient: patient, consultation: consultation)
        }
    }

    private struct LoadKey: Hashable {
        let showArchived: Bool
        let reloads: Int
    }

    private func load() async {
        if consultations.isEmpty { state = .loading("Loading consultations") }
        do throws(APIError) {
            let loaded = try await work.repository.consultations(patientId: patient.id, includeArchived: showArchived)
            work.photography.reachedServer()
            consultations = loaded
            offline = false
            state = loaded.isEmpty
                ? .empty(title: String(localized: "No consultations"),
                         message: String(localized: "Start a consultation to record the reason, concerns, photos and notes."))
                : nil
            // The copy for offline use is saved in the background; the list never waits for it.
            let consultationWork = work
            let patientId = patient.id
            Task { await consultationWork.saveCopy(patientId: patientId, consultations: loaded) }
        } catch {
            work.photography.note(error)
            if error.status == 0, let saved = await work.store.snapshot(patientId: patient.id) {
                offline = true
                consultations = saved.consultations
                state = saved.consultations.isEmpty
                    ? .empty(title: String(localized: "No open consultations saved"),
                             message: String(localized: "Open consultations are saved on this device when you view them online."))
                    : nil
            } else {
                state = error.viewState
            }
        }
    }
}

struct ConsultationRow: View {
    let consultation: Consultation
    let open: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Button(action: open) {
            HStack(spacing: DSSpacing.md) {
                VStack(alignment: .leading, spacing: DSSpacing.xs) {
                    Text(consultation.reason ?? String(localized: "No reason recorded"))
                        .font(DSFont.headline)
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    // Side by side, or stacked at accessibility sizes so neither is squeezed.
                    let details = typeSize.isAccessibilitySize
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: DSSpacing.xs))
                        : AnyLayout(HStackLayout(spacing: DSSpacing.sm))
                    details {
                        ConsultationStatusBadge(status: consultation.status)
                        Text(consultation.startedAt ?? consultation.createdAt, format: .dateTime.day().month().year())
                            .font(DSFont.footnote)
                            .foregroundStyle(DSColor.textSecondary)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(DSFont.footnote)
                    .foregroundStyle(DSColor.textTertiary)
                    .accessibilityHidden(true)
            }
            .padding(DSSpacing.md)
            .frame(minHeight: DSSize.touchTarget)
            .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text("Opens the consultation workspace"))
        .accessibilityIdentifier("consultations.row.\(consultation.id)")
    }
}

struct ConsultationStatusBadge: View {
    let status: ConsultationStatus

    var body: some View {
        switch status {
        case .draft, .inProgress:
            DSBadge(status.title, color: DSColor.accentText, background: DSColor.accentSoft)
        case .awaitingInformation:
            DSBadge(status.title, color: DSColor.warning, background: DSColor.warningSoft)
        case .readyForReview:
            DSBadge(status.title, color: DSColor.info, background: DSColor.infoSoft)
        case .completed:
            DSBadge(status.title, color: DSColor.success, background: DSColor.successSoft)
        case .cancelled, .archived:
            DSBadge(status.title)
        }
    }
}

/// A new DRAFT consultation in one of the organization's practices (ADR-0026 K3-20). Online only.
struct NewConsultationSheet: View {
    let work: ConsultationWork
    let patientId: String
    let created: (Consultation) -> Void
    @State private var practices: [PracticeOption] = []
    @State private var practiceId: String?
    @State private var reason = ""
    @State private var primaryProvider = false
    @State private var state: DSViewState? = .loading("Loading practices")
    @State private var busy = false
    @State private var message: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let state {
                    DSStateView(state) { Task { await load() } }
                } else {
                    Form {
                        if let message {
                            Section { DSBanner(message, tone: .danger) }
                        }
                        Section {
                            Picker("Practice", selection: $practiceId) {
                                ForEach(practices) { practice in
                                    Text(practice.name).tag(Optional(practice.id))
                                }
                            }
                            .accessibilityIdentifier("newConsultation.practice")
                            Toggle("I am the primary provider", isOn: $primaryProvider)
                                .accessibilityIdentifier("newConsultation.primaryProvider")
                        }
                        Section {
                            TextField("Reason (optional)", text: $reason, axis: .vertical)
                                .lineLimit(2...5)
                                .accessibilityIdentifier("newConsultation.reason")
                        } header: {
                            Text("Reason")
                        } footer: {
                            Text("\(trimmedReason.count) of \(ConsultationLimits.reason) characters")
                        }
                    }
                }
            }
            .navigationTitle("New consultation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { Task { await create() } }
                        .disabled(practiceId == nil || busy || trimmedReason.count > ConsultationLimits.reason)
                        .accessibilityIdentifier("newConsultation.create")
                }
            }
        }
        .task { await load() }
    }

    private var trimmedReason: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func load() async {
        do throws(APIError) {
            practices = try await work.repository.practices()
            if practiceId == nil { practiceId = practices.first?.id }
            state = practices.isEmpty
                ? .empty(title: String(localized: "No practices"), message: String(localized: "An administrator adds the organization's practices."))
                : nil
        } catch {
            work.photography.note(error)
            state = error.viewState
        }
    }

    private func create() async {
        guard let practiceId else { return }
        busy = true
        defer { busy = false }
        do throws(APIError) {
            let consultation = try await work.repository.create(
                patientId: patientId, practiceId: practiceId, providerUserId: primaryProvider ? work.userId : nil,
                reason: trimmedReason.isEmpty ? nil : trimmedReason, idempotencyKey: newIdempotencyKey()
            )
            created(consultation)
        } catch {
            work.photography.note(error)
            message = error.status == 0
                ? String(localized: "Creating a consultation needs a connection.")
                : error.displayMessage
        }
    }
}
