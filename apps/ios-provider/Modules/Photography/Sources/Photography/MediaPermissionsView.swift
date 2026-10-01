// Media permissions (Bible §7.1–7.3; spec §5.4.5; ADR-0023 K2-15, K2-16):
// the patient-wide state of each category, the photo exceptions, recording a
// change and the full version history. Every category stands alone; none
// implies another, and clinical consent never implies marketing, research or
// AI-training permission. In Layer 2 a grant is the staff member's
// attestation, so a grant takes two steps: requested, then granted. Changes
// are recorded online only; ending a grant revokes the releases on it.
// Bible §7 · tier: feature · Layer 2.
import CoreNetworking
import DesignSystem
import SwiftUI

struct MediaPermissionsView: View {
    let context: PhotographyContext
    let patientId: String
    @State private var categories: [PermissionCategoryState] = []
    @State private var state: DSViewState? = .loading("Loading media permissions")
    @State private var editing: PermissionCategoryState?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if let state {
                DSStateView(state) { Task { await load() } }
            } else {
                List {
                    Section {
                        ForEach(categories) { item in
                            row(item)
                        }
                    } footer: {
                        Text("Each category is separate: none implies another. Clinical consent never implies marketing, research or AI training permission.")
                    }
                    Section {
                        NavigationLink("Permission history") {
                            PermissionHistoryView(context: context, patientId: patientId)
                        }
                        .accessibilityIdentifier("permissions.history")
                    }
                }
            }
        }
        .navigationTitle("Media permissions")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        }
        .task { await load() }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { item in
            PermissionChangeSheet(context: context, patientId: patientId, category: item.category,
                                  currentState: item.current?.effectiveState() ?? "NOT_REQUESTED", photoId: nil)
        }
    }

    private func row(_ item: PermissionCategoryState) -> some View {
        Button {
            editing = item
        } label: {
            HStack(spacing: DSSpacing.md) {
                VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                    Text(item.category.title).font(DSFont.headline).foregroundStyle(DSColor.textPrimary)
                    if let detail = detail(item) {
                        Text(detail).font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                    }
                }
                Spacer()
                PermissionStateBadge(state: item.state)
            }
            .frame(minHeight: DSSize.touchTarget)
        }
        .disabled(!context.can("photo.permission.manage"))
        .accessibilityIdentifier("permissions.category.\(item.category.rawValue)")
    }

    private func detail(_ item: PermissionCategoryState) -> String? {
        var parts: [String] = []
        if let current = item.current {
            parts.append(String(localized: "Version \(current.versionNumber), \(current.effectiveAt.formatted(date: .abbreviated, time: .omitted))"))
            if let expiresAt = current.expiresAt {
                parts.append(String(localized: "Expires \(expiresAt.formatted(date: .abbreviated, time: .omitted))"))
            }
        }
        let photoExceptions = item.exceptions.count
        if photoExceptions == 1 {
            parts.append(String(localized: "1 exception"))
        } else if photoExceptions > 1 {
            parts.append(String(localized: "\(photoExceptions) exceptions"))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func load() async {
        do throws(APIError) {
            categories = try await context.repository.permissions(patientId: patientId)
            context.reachedServer()
            state = nil
        } catch {
            context.note(error)
            state = DSViewState(error)
        }
    }
}

extension DSViewState {
    /// The state a failed load shows: offline, not permitted, or the error with its reference.
    init(_ error: APIError) {
        switch error.status {
        case 0: self = .offline
        case 403: self = .permissionDenied
        default: self = .error(message: error.displayMessage, reference: error.requestId)
        }
    }
}

/// A permission state in words, never by colour alone.
struct PermissionStateBadge: View {
    let state: String

    var body: some View {
        switch state {
        case "GRANTED": DSBadge(words(state), color: DSColor.success, background: DSColor.successSoft)
        case "DECLINED", "REVOKED", "EXPIRED": DSBadge(words(state), color: DSColor.danger, background: DSColor.dangerSoft)
        case "REQUESTED": DSBadge(words(state), color: DSColor.warning, background: DSColor.warningSoft)
        default: DSBadge(words(state))
        }
    }
}

/// Recording one transition, patient-wide or for one photo.
struct PermissionChangeSheet: View {
    let context: PhotographyContext
    let patientId: String
    let category: PermissionCategory
    let currentState: String
    let photoId: String?
    @State private var change: PermissionChange?
    @State private var hasExpiry = false
    @State private var expiresAt = Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
    @State private var reason = ""
    @State private var busy = false
    @State private var message: String?
    /// One key per sheet, so a retry of the same change is recorded once.
    @State private var idempotencyKey = newIdempotencyKey()
    @Environment(\.dismiss) private var dismiss

    private var allowed: [PermissionChange] { PermissionChange.allowed(from: currentState) }

    var body: some View {
        NavigationStack {
            Form {
                if let message { DSBanner(message, tone: .danger) }
                Section {
                    LabeledContent("Now", value: words(currentState))
                    Picker("Change to", selection: $change) {
                        Text("Choose").tag(PermissionChange?.none)
                        ForEach(allowed) { option in
                            Text(option.title).tag(PermissionChange?.some(option))
                        }
                    }
                    .accessibilityIdentifier("permission.change")
                } footer: {
                    if photoId != nil {
                        Text("This applies to this photo only and overrides the patient-wide permission for it.")
                    }
                }
                if change == .granted {
                    Section {
                        Toggle("Ends on a date", isOn: $hasExpiry)
                        if hasExpiry {
                            DatePicker("Ends", selection: $expiresAt, in: Date().addingTimeInterval(86_400)..., displayedComponents: .date)
                        }
                    } footer: {
                        Text("You are recording that the patient gave this permission. Your name and the time are kept with it.")
                    }
                }
                if change == .revoked {
                    Section {
                        Text("Revoking ends every release that relies on this permission, at once.")
                            .font(DSFont.footnote)
                            .foregroundStyle(DSColor.textSecondary)
                    }
                }
                Section("Reason (optional)") {
                    TextField("Reason", text: $reason, axis: .vertical)
                        .lineLimit(2...5)
                        .accessibilityIdentifier("permission.reason")
                }
            }
            .navigationTitle(category.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(change == nil || busy || reason.count > 500)
                        .accessibilityIdentifier("permission.save")
                }
            }
        }
        .onAppear { if allowed.count == 1 { change = allowed.first } }
    }

    private func save() async {
        guard let change else { return }
        busy = true
        defer { busy = false }
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        do throws(APIError) {
            _ = try await context.repository.recordPermission(
                patientId: patientId, category: category, change: change, photoId: photoId,
                expiresAt: change == .granted && hasExpiry ? expiresAt : nil,
                reason: trimmed.isEmpty ? nil : trimmed, idempotencyKey: idempotencyKey
            )
            context.reachedServer()
            dismiss()
        } catch {
            context.note(error)
            message = error.status == 0
                ? String(localized: "Media permissions can be changed only while online.")
                : error.displayMessage
        }
    }
}

/// Every version, newest first (Bible §7.2: append-only).
struct PermissionHistoryView: View {
    let context: PhotographyContext
    let patientId: String
    @State private var records: [PermissionRecord] = []
    @State private var state: DSViewState? = .loading("Loading history")

    var body: some View {
        Group {
            if let state {
                DSStateView(state) { Task { await load() } }
            } else if records.isEmpty {
                DSStateView(.empty(title: String(localized: "No changes yet"),
                                   message: String(localized: "No media permission has been recorded for this patient.")))
            } else {
                List(records) { record in
                    VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                        HStack {
                            Text(PermissionCategory(rawValue: record.category)?.title ?? words(record.category))
                                .font(DSFont.headline)
                            Spacer()
                            PermissionStateBadge(state: record.state)
                        }
                        Text(summary(record)).font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                        if let reason = record.reason {
                            Text(reason).font(DSFont.footnote).foregroundStyle(DSColor.textPrimary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .navigationTitle("Permission history")
        .task { await load() }
    }

    private func summary(_ record: PermissionRecord) -> String {
        let scope: String
        if record.photoId != nil {
            scope = String(localized: "This photo only")
        } else if record.photoSessionId != nil {
            scope = String(localized: "One session")
        } else {
            scope = String(localized: "Patient-wide")
        }
        var parts = [
            String(localized: "Version \(record.versionNumber)"),
            record.effectiveAt.formatted(date: .abbreviated, time: .shortened),
            scope,
        ]
        if let evidence = record.evidence { parts.append(words(evidence)) }
        if let expiresAt = record.expiresAt {
            parts.append(String(localized: "Ends \(expiresAt.formatted(date: .abbreviated, time: .omitted))"))
        }
        return parts.joined(separator: " · ")
    }

    private func load() async {
        do throws(APIError) {
            records = try await context.repository.permissionHistory(patientId: patientId)
            context.reachedServer()
            state = nil
        } catch {
            context.note(error)
            state = DSViewState(error)
        }
    }
}
