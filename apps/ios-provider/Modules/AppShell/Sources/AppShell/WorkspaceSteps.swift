// The workspace's steps other than notes (Bible §5.1; spec §5.4.1; ADR-0026
// K3-02 to K3-05, K3-08, K3-09, K3-16, K3-17): reason and concerns, medical
// history, photography, the summary, and review and completion. What can be
// changed follows the consultation's state and the role's permissions; the
// server decides every change. Descriptions are shown, never logged.
// Bible §5.1 · tier: app · Layer 3.
import ConsultationDomain
import DesignSystem
import DocumentsConsent
import Photography
import SwiftUI

// MARK: Reason and concerns

struct ReasonStep: View {
    let model: WorkspaceModel
    @State private var reason = ""
    @State private var adding = false

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xl) {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                Text("Reason for the consultation").font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                if model.canChangeContent {
                    TextField("Reason", text: $reason, axis: .vertical)
                        .lineLimit(2...6)
                        .workspaceField()
                        .accessibilityIdentifier("consultation.reason")
                    HStack {
                        Text("\(trimmed.count) of \(ConsultationLimits.reason) characters")
                            .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                        Spacer()
                        Button("Save reason") { Task { await model.saveReason(trimmed) } }
                            .buttonStyle(DSButtonStyle(.secondary))
                            .frame(maxWidth: 200)
                            .disabled(trimmed.isEmpty || trimmed == model.consultation.reason || trimmed.count > ConsultationLimits.reason
                                || model.busy)
                            .accessibilityIdentifier("consultation.saveReason")
                    }
                } else {
                    Text(model.consultation.reason ?? String(localized: "No reason recorded"))
                        .font(DSFont.body).foregroundStyle(DSColor.textPrimary)
                }
            }
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                HStack {
                    Text("Concerns").font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                    Spacer()
                    if model.canChangeContent {
                        Button("Add concern", systemImage: "plus") { adding = true }
                            .accessibilityIdentifier("concerns.add")
                    }
                }
                Text(model.canChangeContent
                    ? String(localized: "Select the patient's concerns this consultation addresses.")
                    : String(localized: "The concerns this consultation addresses are marked."))
                    .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                if model.concerns.isEmpty {
                    DSStateView(.empty(title: String(localized: "No concerns recorded"),
                                       message: String(localized: "Concerns the patient raises are recorded here.")))
                } else {
                    ForEach(model.concerns) { concern in
                        ConcernRow(model: model, concern: concern)
                    }
                }
            }
        }
        .onChange(of: model.consultation.reason, initial: true) { _, saved in reason = saved ?? "" }
        .sheet(isPresented: $adding) {
            AddConcernSheet { area, description in
                Task {
                    if await model.addConcern(area: area, description: description) { adding = false }
                }
            }
        }
    }

    private var trimmed: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
}

struct ConcernRow: View {
    let model: WorkspaceModel
    let concern: PatientConcern

    private var selected: Bool { model.consultation.concernIds.contains(concern.id) }

    var body: some View {
        HStack(alignment: .top, spacing: DSSpacing.md) {
            Button {
                Task { await model.toggle(concern) }
            } label: {
                HStack(alignment: .top, spacing: DSSpacing.md) {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(DSFont.title3)
                        .foregroundStyle(selected ? DSColor.accent : DSColor.controlBorder)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                        HStack(spacing: DSSpacing.sm) {
                            Text(concern.area.title).font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                            if concern.resolvedAt != nil { DSBadge(String(localized: "Resolved")) }
                        }
                        Text(concern.description).font(DSFont.body).foregroundStyle(DSColor.textSecondary)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer()
                }
                .frame(minHeight: DSSize.touchTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!model.canChangeContent || model.busy)
            .accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityIdentifier("concerns.row.\(concern.id)")
            if model.canEdit, !model.offline {
                Menu {
                    Button(concern.resolvedAt == nil ? String(localized: "Mark resolved") : String(localized: "Mark not resolved")) {
                        Task { await model.setResolved(concern, resolved: concern.resolvedAt == nil) }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(DSFont.title3)
                        .frame(minWidth: DSSize.touchTarget, minHeight: DSSize.touchTarget)
                }
                .accessibilityLabel(Text("More for \(concern.area.title)"))
                .accessibilityIdentifier("concerns.more.\(concern.id)")
            }
        }
        .padding(DSSpacing.md)
        .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
    }
}

struct AddConcernSheet: View {
    let add: (ConcernArea, String) -> Void
    @State private var area: ConcernArea = .faceSkin
    @State private var text = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Picker("Area", selection: $area) {
                    ForEach(ConcernArea.allCases) { item in
                        Text(item.title).tag(item)
                    }
                }
                .accessibilityIdentifier("concern.area")
                Section {
                    TextField("What the patient would like addressed", text: $text, axis: .vertical)
                        .lineLimit(3...8)
                        .accessibilityIdentifier("concern.description")
                } header: {
                    Text("Description")
                } footer: {
                    Text("\(trimmed.count) of \(ConsultationLimits.concernDescription) characters")
                }
            }
            .navigationTitle("Add concern")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { add(area, trimmed) }
                        .disabled(trimmed.isEmpty || trimmed.count > ConsultationLimits.concernDescription)
                        .accessibilityIdentifier("concern.save")
                }
            }
        }
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
}

// MARK: Medical history

struct HistoryStep: View {
    let model: WorkspaceModel
    @State private var adding = false

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            HStack {
                Text("Medical history").font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                Spacer()
                if model.canEdit, !model.offline {
                    Button("Add entry", systemImage: "plus") { adding = true }
                        .accessibilityIdentifier("history.add")
                }
            }
            Text("Recorded by staff. Entries are kept; they are never deleted.")
                .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            if model.history.isEmpty {
                DSStateView(.empty(title: String(localized: "No medical history recorded"),
                                   message: String(localized: "Allergies, medications, conditions and prior treatments appear here.")))
            } else {
                ForEach(HistoryCategory.allCases) { category in
                    let entries = model.history.filter { $0.category == category }
                    if !entries.isEmpty {
                        VStack(alignment: .leading, spacing: DSSpacing.sm) {
                            Text(category.title).font(DSFont.subheadline.weight(.semibold)).foregroundStyle(DSColor.textSecondary)
                                .accessibilityAddTraits(.isHeader)
                            ForEach(entries) { entry in
                                HistoryRow(entry: entry)
                            }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $adding) {
            AddHistorySheet { category, description in
                Task {
                    if await model.addHistory(category: category, description: description) { adding = false }
                }
            }
        }
    }
}

struct HistoryRow: View {
    let entry: MedicalHistoryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Text(entry.description).font(DSFont.body).foregroundStyle(DSColor.textPrimary)
            HStack(spacing: DSSpacing.sm) {
                if let onset = entry.onsetDate { Text("Since \(onset)") }
                if let resolved = entry.resolvedOn { Text("Resolved \(resolved)") }
                Text("Recorded \(entry.recordedAt.formatted(date: .abbreviated, time: .omitted))")
            }
            .font(DSFont.footnote)
            .foregroundStyle(DSColor.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DSSpacing.md)
        .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
        .accessibilityElement(children: .combine)
    }
}

struct AddHistorySheet: View {
    let add: (HistoryCategory, String) -> Void
    @State private var category: HistoryCategory = .allergy
    @State private var text = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Picker("Category", selection: $category) {
                    ForEach(HistoryCategory.allCases) { item in
                        Text(item.title).tag(item)
                    }
                }
                .accessibilityIdentifier("history.category")
                Section {
                    TextField("Description", text: $text, axis: .vertical)
                        .lineLimit(3...8)
                        .accessibilityIdentifier("history.description")
                } header: {
                    Text("Description")
                } footer: {
                    Text("\(trimmed.count) of \(ConsultationLimits.historyDescription) characters")
                }
            }
            .navigationTitle("Add history entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { add(category, trimmed) }
                        .disabled(trimmed.isEmpty || trimmed.count > ConsultationLimits.historyDescription)
                        .accessibilityIdentifier("history.save")
                }
            }
        }
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
}

// MARK: Photography

/// The Layer 2 capture flow, for this consultation: its sessions and photos, and new sessions taken for it.
struct PhotographyStep: View {
    let model: WorkspaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            if !model.consultation.status.capturesPhotos {
                Text(model.consultation.status == .draft
                    ? String(localized: "Start the consultation to take photos for it.")
                    : String(localized: "Photos are taken while the consultation is under way."))
                    .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            }
            PhotosTabView(context: model.work.photography, patientId: model.patient.id,
                          consultationId: model.consultation.id, allowsNewSessions: model.consultation.status.capturesPhotos)
        }
    }
}

// MARK: Summary

struct SummaryStep: View {
    let model: WorkspaceModel

    private var canGenerate: Bool {
        model.canEdit && (model.consultation.status == .readyForReview || model.consultation.status == .completed)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            Text("The summary is a PDF of the reviewed consultation: the reason, concerns, final notes with their addenda, and the photo sessions taken. It holds no drafts and no images.")
                .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            if canGenerate {
                Button("Generate summary", systemImage: "doc.badge.plus") { Task { await model.generateSummary() } }
                    .buttonStyle(DSButtonStyle(.primary))
                    .disabled(model.busy || model.offline)
                    .accessibilityIdentifier("summary.generate")
                if model.consultation.status == .completed {
                    Text("After completion, a new summary can be generated once an addendum has been finalized.")
                        .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                }
            } else if !model.consultation.status.isFinal {
                Text("Submit the consultation for review to generate its summary.")
                    .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            }
            if model.work.can("document.read") {
                DocumentsTabView(repository: model.work.documents, patientId: model.patient.id, canManage: false,
                                 consultationId: model.consultation.id)
                    .id(model.summaries)
            }
        }
    }
}

// MARK: Review and completion

struct CompletionStep: View {
    let model: WorkspaceModel
    @State private var nothingToRelease = false
    @State private var cancelling = false
    @State private var archiving = false

    private var status: ConsultationStatus { model.consultation.status }

    private var actions: [ConsultationAction] {
        ConsultationAction.available(for: status).filter { model.work.can($0.permission) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xl) {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                Text("Status").font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                dates
            }
            if !status.isFinal {
                VStack(alignment: .leading, spacing: DSSpacing.sm) {
                    Text("Before completing").font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                    ForEach(CompletionPrecondition.allCases, id: \.self) { condition in
                        let met = !model.consultation.unmet.contains(condition)
                        Label {
                            Text(condition.message).foregroundStyle(DSColor.textPrimary)
                        } icon: {
                            Image(systemName: met ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(met ? DSColor.success : DSColor.controlBorder)
                        }
                        .font(DSFont.body)
                        .accessibilityValue(met ? Text("Done") : Text("Not done"))
                        .accessibilityIdentifier("completion.condition.\(condition.rawValue)")
                    }
                }
            }
            if actions.contains(.complete) {
                Toggle("Nothing is released to the patient from this consultation.", isOn: $nothingToRelease)
                    .font(DSFont.body)
                    .accessibilityIdentifier("completion.nothingToRelease")
            }
            if model.offline, !actions.isEmpty {
                Text("Changing the consultation's state needs a connection.")
                    .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            }
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                ForEach(actions) { action in
                    Button(action.title) { run(action) }
                        .buttonStyle(DSButtonStyle(style(of: action)))
                        .disabled(model.busy || model.offline || (action == .complete && !canComplete))
                        .accessibilityIdentifier("completion.action.\(action.rawValue)")
                }
            }
        }
        .sheet(isPresented: $cancelling) {
            CancelConsultationSheet { reason in
                Task {
                    if await model.perform(.cancel, reason: reason) { cancelling = false }
                }
            }
        }
        .confirmationDialog("Archive this consultation?", isPresented: $archiving, titleVisibility: .visible) {
            Button("Archive") { Task { await model.perform(.archive) } }
                .accessibilityIdentifier("completion.confirmArchive")
        } message: {
            Text("Archived consultations are hidden from the list unless you choose to show them.")
        }
    }

    private var canComplete: Bool { nothingToRelease && model.consultation.unmet.isEmpty }

    @ViewBuilder private var dates: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            ConsultationStatusBadge(status: status)
            Text("Created \(model.consultation.createdAt.formatted(date: .abbreviated, time: .shortened))")
            if let started = model.consultation.startedAt {
                Text("Started \(started.formatted(date: .abbreviated, time: .shortened))")
            }
            if let review = model.consultation.readyForReviewAt {
                Text("Submitted for review \(review.formatted(date: .abbreviated, time: .shortened))")
            }
            if let completed = model.consultation.completedAt {
                Text("Completed \(completed.formatted(date: .abbreviated, time: .shortened))")
            }
            if let cancelled = model.consultation.cancelledAt {
                Text("Cancelled \(cancelled.formatted(date: .abbreviated, time: .shortened))")
            }
            if let reason = model.consultation.cancellationReason {
                Text("Reason: \(reason)")
            }
        }
        .font(DSFont.footnote)
        .foregroundStyle(DSColor.textSecondary)
    }

    private func style(of action: ConsultationAction) -> DSButtonStyle.Kind {
        switch action {
        case .cancel: .destructive
        case .complete, .submitForReview, .start: .primary
        default: .secondary
        }
    }

    private func run(_ action: ConsultationAction) {
        switch action {
        case .cancel: cancelling = true
        case .archive: archiving = true
        default: Task { await model.perform(action) }
        }
    }
}

/// Cancelling needs a reason (ADR-0026 K3-05); nothing attached is deleted.
struct CancelConsultationSheet: View {
    let cancel: (String) -> Void
    @State private var reason = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Why the consultation is cancelled", text: $reason, axis: .vertical)
                        .lineLimit(2...6)
                        .accessibilityIdentifier("cancel.reason")
                } header: {
                    Text("Reason")
                } footer: {
                    Text("Notes, photos and documents of the consultation are kept.")
                }
            }
            .navigationTitle("Cancel consultation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Keep") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Cancel consultation", role: .destructive) { cancel(trimmed) }
                        .disabled(trimmed.isEmpty || trimmed.count > ConsultationLimits.reason)
                        .accessibilityIdentifier("cancel.confirm")
                }
            }
        }
    }

    private var trimmed: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
}

extension View {
    /// A multi-line text field on the workspace's surfaces.
    func workspaceField() -> some View {
        padding(DSSpacing.md)
            .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
            .overlay(RoundedRectangle(cornerRadius: DSRadius.md).stroke(DSColor.controlBorder))
    }
}
