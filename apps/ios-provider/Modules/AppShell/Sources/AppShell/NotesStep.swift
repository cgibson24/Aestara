// The workspace's notes (Bible §5.1, §23.1; spec §8; ADR-0026 K3-06, K3-07):
// each note with its addenda, oldest first. Only the author edits, finalizes or
// discards a draft. A final note never changes; a correction is an addendum,
// which is itself drafted and finalized. Drafts written offline wait on the
// device and are sent on reconnect; a draft that changed meanwhile, or that the
// server refused, is shown here for its author to decide, with both texts.
// Note text is shown, never logged.
// Bible §5.1 · tier: app · Layer 3.
import ConsultationDomain
import DesignSystem
import SwiftUI

/// What the editor sheet is writing.
struct NoteDraft: Identifiable {
    let id = UUID()
    /// The draft being edited, or nil for a new note.
    let note: ConsultationNote?
    /// The final note an addendum corrects.
    let correctsNoteId: String?

    var title: String {
        if note != nil { return String(localized: "Edit draft") }
        return correctsNoteId == nil ? String(localized: "New note") : String(localized: "New addendum")
    }
}

struct NotesStep: View {
    let model: WorkspaceModel
    @State private var editing: NoteDraft?
    @State private var finalizing: ConsultationNote?
    @State private var discarding: ConsultationNote?

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            ForEach(model.problems) { operation in
                NoteProblemCard(model: model, operation: operation)
            }
            if model.canWriteNotes {
                Button("New note", systemImage: "square.and.pencil") { editing = NoteDraft(note: nil, correctsNoteId: nil) }
                    .buttonStyle(DSButtonStyle(.primary))
                    .accessibilityIdentifier("notes.new")
            } else if model.consultation.status == .draft {
                Text("Start the consultation to write notes.")
                    .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            }
            if model.topLevelNotes.isEmpty {
                DSStateView(.empty(title: String(localized: "No notes yet"),
                                   message: String(localized: "Notes are drafted here. Offline, drafts are kept on this device and sent when you reconnect.")))
            } else {
                ForEach(model.topLevelNotes) { note in
                    VStack(alignment: .leading, spacing: DSSpacing.sm) {
                        NoteCard(model: model, note: note, edit: edit, finalize: { finalizing = $0 }, discard: { discarding = $0 })
                        ForEach(model.addenda(of: note)) { addendum in
                            NoteCard(model: model, note: addendum, edit: edit, finalize: { finalizing = $0 }, discard: { discarding = $0 })
                                .padding(.leading, DSSpacing.xxl)
                        }
                        if note.status == .final, model.canWriteAddenda {
                            Button("Add addendum", systemImage: "plus.bubble") {
                                editing = NoteDraft(note: nil, correctsNoteId: note.id)
                            }
                            .padding(.leading, DSSpacing.xxl)
                            .accessibilityIdentifier("notes.addendum.\(note.id)")
                        }
                    }
                }
            }
        }
        .sheet(item: $editing) { draft in
            NoteEditor(draft: draft, offline: model.offline, busy: model.busy) { body in
                Task {
                    if await model.saveNote(draft.note, body: body, correctsNoteId: draft.correctsNoteId) { editing = nil }
                }
            }
        }
        .confirmationDialog("Finalize this note?", isPresented: present($finalizing), titleVisibility: .visible,
                            presenting: finalizing) { note in
            Button("Finalize") { Task { await model.finalize(note) } }
                .accessibilityIdentifier("notes.confirmFinalize")
        } message: { _ in
            Text("A final note can never be changed. Corrections are added as addenda.")
        }
        .confirmationDialog("Discard this draft?", isPresented: present($discarding), titleVisibility: .visible,
                            presenting: discarding) { note in
            Button("Discard draft", role: .destructive) { Task { await model.discard(note) } }
                .accessibilityIdentifier("notes.confirmDiscard")
        } message: { _ in
            Text("The draft is deleted. This cannot be undone.")
        }
    }

    private func edit(_ note: ConsultationNote) {
        editing = NoteDraft(note: note, correctsNoteId: note.correctsNoteId)
    }

    private func present(_ item: Binding<ConsultationNote?>) -> Binding<Bool> {
        Binding(get: { item.wrappedValue != nil }, set: { if !$0 { item.wrappedValue = nil } })
    }
}

struct NoteCard: View {
    let model: WorkspaceModel
    let note: ConsultationNote
    let edit: (ConsultationNote) -> Void
    let finalize: (ConsultationNote) -> Void
    let discard: (ConsultationNote) -> Void

    private var mine: Bool { model.isMine(note) }
    private var queued: Bool { model.queuedNotes.contains(note.id) }
    /// Drafts change while the consultation is under way, or as addenda after completion.
    private var draftsOpen: Bool { note.isAddendum ? model.canWriteAddenda : model.canWriteNotes }

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack(spacing: DSSpacing.sm) {
                if note.isAddendum { DSBadge(String(localized: "Addendum"), color: DSColor.info, background: DSColor.infoSoft) }
                if note.status == .final {
                    DSBadge(String(localized: "Final"), color: DSColor.success, background: DSColor.successSoft)
                } else {
                    DSBadge(String(localized: "Draft"), color: DSColor.warning, background: DSColor.warningSoft)
                }
                if queued { DSBadge(String(localized: "Waiting to send")) }
                Spacer()
                Text(mine ? String(localized: "Your note") : String(localized: "A colleague's note"))
                    .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            }
            Text(note.body)
                .font(DSFont.body)
                .foregroundStyle(DSColor.textPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(note.finalizedAt.map { String(localized: "Finalized \($0.formatted(date: .abbreviated, time: .shortened))") }
                ?? String(localized: "Last edited \(note.updatedAt.formatted(date: .abbreviated, time: .shortened))"))
                .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
            if note.status == .draft, mine, model.canEdit, draftsOpen {
                HStack(spacing: DSSpacing.sm) {
                    Button("Edit") { edit(note) }
                        .buttonStyle(DSButtonStyle(.secondary))
                        .accessibilityIdentifier("notes.edit.\(note.id)")
                    Button("Finalize") { finalize(note) }
                        .buttonStyle(DSButtonStyle(.primary))
                        .disabled(model.offline || queued || model.busy)
                        .accessibilityIdentifier("notes.finalize.\(note.id)")
                    Button("Discard") { discard(note) }
                        .buttonStyle(DSButtonStyle(.destructive))
                        .disabled((model.offline && note.version > 0) || model.busy)
                        .accessibilityIdentifier("notes.discard.\(note.id)")
                }
                if model.offline || queued {
                    Text("Finalizing needs a connection and a sent draft.")
                        .font(DSFont.footnote).foregroundStyle(DSColor.textSecondary)
                }
            }
        }
        .padding(DSSpacing.md)
        .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
        // A container: its buttons keep their own identifiers.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notes.card.\(note.id)")
    }
}

/// A queued draft the server did not take: both texts for a conflict, or the refusal in words.
struct NoteProblemCard: View {
    let model: WorkspaceModel
    let operation: NoteOperation

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            switch operation.problem {
            case let .conflict(serverBody, _):
                DSBanner(String(localized: "This draft changed elsewhere while you were offline. Choose which text to keep."), tone: .warning)
                comparison(title: String(localized: "Your text"), body: operation.body)
                comparison(title: String(localized: "The saved text"), body: serverBody)
                HStack(spacing: DSSpacing.sm) {
                    Button("Keep mine") { Task { await model.keepMine(operation) } }
                        .buttonStyle(DSButtonStyle(.primary))
                        .accessibilityIdentifier("notes.conflict.keepMine")
                    Button("Keep the saved text") { Task { await model.dropQueued(operation) } }
                        .buttonStyle(DSButtonStyle(.secondary))
                        .accessibilityIdentifier("notes.conflict.keepSaved")
                }
                .disabled(model.busy)
            case let .refused(message):
                DSBanner(String(localized: "This draft could not be saved: \(message) Copy the text if you need it, then discard the draft."), tone: .danger)
                comparison(title: String(localized: "Your text"), body: operation.body)
                Button("Discard draft", role: .destructive) { Task { await model.dropQueued(operation) } }
                    .buttonStyle(DSButtonStyle(.destructive))
                    .accessibilityIdentifier("notes.refused.discard")
            case nil:
                EmptyView()
            }
        }
        .padding(DSSpacing.md)
        .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notes.problem.\(operation.noteId)")
    }

    private func comparison(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Text(title).font(DSFont.subheadline.weight(.semibold)).foregroundStyle(DSColor.textSecondary)
            Text(body).font(DSFont.body).foregroundStyle(DSColor.textPrimary).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(DSSpacing.sm)
                .background(DSColor.surfaceSunken, in: RoundedRectangle(cornerRadius: DSRadius.sm))
        }
    }
}

struct NoteEditor: View {
    let draft: NoteDraft
    let offline: Bool
    let busy: Bool
    let save: (String) -> Void
    @State private var text: String
    @Environment(\.dismiss) private var dismiss

    init(draft: NoteDraft, offline: Bool, busy: Bool, save: @escaping (String) -> Void) {
        self.draft = draft
        self.offline = offline
        self.busy = busy
        self.save = save
        _text = State(initialValue: draft.note?.body ?? "")
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: DSSpacing.md) {
                if offline {
                    DSBanner(String(localized: "You are offline. The draft is kept on this device and sent when you reconnect."), tone: .info)
                }
                TextEditor(text: $text)
                    .font(DSFont.body)
                    .scrollContentBackground(.hidden)
                    .workspaceField()
                    .accessibilityLabel(Text("Note"))
                    .accessibilityIdentifier("note.body")
                Text("\(trimmed.count) of \(ConsultationLimits.noteBody) characters")
                    .font(DSFont.footnote)
                    .foregroundStyle(trimmed.count > ConsultationLimits.noteBody ? DSColor.danger : DSColor.textSecondary)
            }
            .padding(DSSpacing.lg)
            .background(DSColor.canvas)
            .navigationTitle(draft.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save draft") { save(trimmed) }
                        .disabled(trimmed.isEmpty || trimmed.count > ConsultationLimits.noteBody || busy
                            || trimmed == draft.note?.body)
                        .accessibilityIdentifier("note.save")
                }
            }
        }
        .interactiveDismissDisabled(trimmed != (draft.note?.body ?? ""))
    }
}
