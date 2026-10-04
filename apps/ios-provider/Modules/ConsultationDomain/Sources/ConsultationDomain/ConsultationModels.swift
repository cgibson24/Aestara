// Consultation models (Bible §5; spec §5.4.1, §6.3 "Consultations"; ADR-0026
// K3-01 to K3-09). The state machine and what each state allows mirror the
// api's; the server decides every change. Generated API types stop at the
// repository (ADR-0022): views get these models.
// Bible §5 · tier: domain · Layer 3.
import Foundation

/// Bible §5.2 states (spec §5.4.1).
public enum ConsultationStatus: String, Sendable, Codable, CaseIterable, Hashable {
    case draft = "DRAFT"
    case inProgress = "IN_PROGRESS"
    case awaitingInformation = "AWAITING_INFORMATION"
    case readyForReview = "READY_FOR_REVIEW"
    case completed = "COMPLETED"
    case cancelled = "CANCELLED"
    case archived = "ARCHIVED"

    public var title: String {
        switch self {
        case .draft: "Draft"
        case .inProgress: "In progress"
        case .awaitingInformation: "Awaiting information"
        case .readyForReview: "Ready for review"
        case .completed: "Completed"
        case .cancelled: "Cancelled"
        case .archived: "Archived"
        }
    }

    /// Reason, provider, location and concerns may change (ADR-0026 K3-02).
    public var contentOpen: Bool { self == .draft || self == .inProgress || self == .awaitingInformation }

    /// Notes may be drafted, edited and finalized; a completed consultation takes addenda only.
    public var notesOpen: Bool { self == .inProgress || self == .awaitingInformation }

    /// Completed, cancelled or archived: nothing but addenda and archiving remains.
    public var isFinal: Bool { self == .completed || self == .cancelled || self == .archived }

    /// Photo sessions may be started for it (ADR-0026 K3-09).
    public var capturesPhotos: Bool { self == .inProgress || self == .awaitingInformation }
}

/// The api's text limits (spec §6.3 "Consultations").
public enum ConsultationLimits {
    public static let reason = 500
    public static let concernDescription = 500
    public static let historyDescription = 1000
    public static let noteBody = 20_000
}

/// A practice a consultation can belong to (ADR-0026 K3-20).
public struct PracticeOption: Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// What completion still needs (spec §5.4.1; ADR-0026 K3-03).
public enum CompletionPrecondition: String, Sendable, Codable, CaseIterable, Hashable {
    case reasonOrConcern = "REASON_OR_CONCERN"
    case noDraftNotes = "NO_DRAFT_NOTES"
    case currentSummary = "CURRENT_SUMMARY"

    public var message: String {
        switch self {
        case .reasonOrConcern: "Record a reason or at least one concern."
        case .noDraftNotes: "Finalize or discard every draft note."
        case .currentSummary: "Generate the summary after submitting for review."
        }
    }
}

/// The only release decision Layer 3 records (ADR-0026 K3-04).
public enum ReleaseDecision: String, Sendable, Codable {
    case nothingToRelease = "NOTHING_TO_RELEASE"
}

public struct Consultation: Sendable, Equatable, Identifiable, Hashable, Codable {
    public let id: String
    public let patientId: String
    public let practiceId: String
    public let locationId: String?
    public let primaryProviderUserId: String?
    public let status: ConsultationStatus
    public let reason: String?
    public let concernIds: [String]
    public let startedAt: Date?
    public let readyForReviewAt: Date?
    public let completedAt: Date?
    public let cancelledAt: Date?
    public let cancellationReason: String?
    public let unmet: [CompletionPrecondition]
    public let createdAt: Date
    public let updatedAt: Date
    public let version: Int

    public init(id: String, patientId: String, practiceId: String, locationId: String?, primaryProviderUserId: String?,
                status: ConsultationStatus, reason: String?, concernIds: [String], startedAt: Date?, readyForReviewAt: Date?,
                completedAt: Date?, cancelledAt: Date?, cancellationReason: String?, unmet: [CompletionPrecondition],
                createdAt: Date, updatedAt: Date, version: Int) {
        self.id = id
        self.patientId = patientId
        self.practiceId = practiceId
        self.locationId = locationId
        self.primaryProviderUserId = primaryProviderUserId
        self.status = status
        self.reason = reason
        self.concernIds = concernIds
        self.startedAt = startedAt
        self.readyForReviewAt = readyForReviewAt
        self.completedAt = completedAt
        self.cancelledAt = cancelledAt
        self.cancellationReason = cancellationReason
        self.unmet = unmet
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.version = version
    }
}

/// A state change the workspace offers (spec §5.4.1). The server checks it again.
public enum ConsultationAction: String, Sendable, CaseIterable, Identifiable {
    case start
    case requestInformation
    case resume
    case submitForReview
    case returnToProgress
    case cancel
    case complete
    case archive

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .start: "Start consultation"
        case .requestInformation: "Wait for information"
        case .resume: "Resume"
        case .submitForReview: "Submit for review"
        case .returnToProgress: "Return to progress"
        case .cancel: "Cancel consultation"
        case .complete: "Complete consultation"
        case .archive: "Archive"
        }
    }

    /// The states the action starts from.
    public var from: Set<ConsultationStatus> {
        switch self {
        case .start: [.draft]
        case .requestInformation: [.inProgress]
        case .resume: [.awaitingInformation]
        case .submitForReview: [.inProgress, .awaitingInformation]
        case .returnToProgress: [.readyForReview]
        case .cancel: [.draft, .inProgress, .awaitingInformation, .readyForReview]
        case .complete: [.readyForReview]
        case .archive: [.completed, .cancelled]
        }
    }

    /// The permission it needs; the server decides.
    public var permission: String {
        switch self {
        case .complete, .archive: "consultation.complete"
        default: "consultation.edit"
        }
    }

    public static func available(for status: ConsultationStatus) -> [ConsultationAction] {
        allCases.filter { $0.from.contains(status) }
    }
}

public enum NoteStatus: String, Sendable, Codable, Hashable {
    case draft = "DRAFT"
    case final = "FINAL"
}

public struct ConsultationNote: Sendable, Equatable, Identifiable, Hashable, Codable {
    public let id: String
    public let consultationId: String
    public let authorUserId: String
    public let status: NoteStatus
    public let body: String
    public let correctsNoteId: String?
    public let finalizedAt: Date?
    public let createdAt: Date
    public let updatedAt: Date
    public let version: Int

    public init(id: String, consultationId: String, authorUserId: String, status: NoteStatus, body: String,
                correctsNoteId: String?, finalizedAt: Date?, createdAt: Date, updatedAt: Date, version: Int) {
        self.id = id
        self.consultationId = consultationId
        self.authorUserId = authorUserId
        self.status = status
        self.body = body
        self.correctsNoteId = correctsNoteId
        self.finalizedAt = finalizedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.version = version
    }

    public var isAddendum: Bool { correctsNoteId != nil }

    /// The same note with new text and version (a local edit or a server answer).
    public func with(body: String, version: Int, updatedAt: Date) -> ConsultationNote {
        ConsultationNote(id: id, consultationId: consultationId, authorUserId: authorUserId, status: status, body: body,
                         correctsNoteId: correctsNoteId, finalizedAt: finalizedAt, createdAt: createdAt,
                         updatedAt: updatedAt, version: version)
    }
}

/// The concern areas registered in the api (ADR-0026 K3-08).
public enum ConcernArea: String, Sendable, Codable, CaseIterable, Identifiable, Hashable {
    case forehead = "FOREHEAD"
    case brow = "BROW"
    case eyes = "EYES"
    case nose = "NOSE"
    case cheeks = "CHEEKS"
    case lips = "LIPS"
    case chin = "CHIN"
    case jawline = "JAWLINE"
    case neck = "NECK"
    case faceSkin = "FACE_SKIN"
    case breast = "BREAST"
    case abdomen = "ABDOMEN"
    case flanks = "FLANKS"
    case back = "BACK"
    case buttocks = "BUTTOCKS"
    case arms = "ARMS"
    case thighs = "THIGHS"
    case bodySkin = "BODY_SKIN"
    case other = "OTHER"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .forehead: "Forehead"
        case .brow: "Brow"
        case .eyes: "Eyes"
        case .nose: "Nose"
        case .cheeks: "Cheeks"
        case .lips: "Lips"
        case .chin: "Chin"
        case .jawline: "Jawline"
        case .neck: "Neck"
        case .faceSkin: "Facial skin"
        case .breast: "Breast"
        case .abdomen: "Abdomen"
        case .flanks: "Flanks"
        case .back: "Back"
        case .buttocks: "Buttocks"
        case .arms: "Arms"
        case .thighs: "Thighs"
        case .bodySkin: "Body skin"
        case .other: "Other"
        }
    }
}

public struct PatientConcern: Sendable, Equatable, Identifiable, Hashable, Codable {
    public let id: String
    public let area: ConcernArea
    public let description: String
    public let resolvedAt: Date?
    public let createdAt: Date
    public let version: Int

    public init(id: String, area: ConcernArea, description: String, resolvedAt: Date?, createdAt: Date, version: Int) {
        self.id = id
        self.area = area
        self.description = description
        self.resolvedAt = resolvedAt
        self.createdAt = createdAt
        self.version = version
    }
}

public enum HistoryCategory: String, Sendable, Codable, CaseIterable, Identifiable, Hashable {
    case allergy = "ALLERGY"
    case medication = "MEDICATION"
    case condition = "CONDITION"
    case priorProcedure = "PRIOR_PROCEDURE"
    case priorAestheticTreatment = "PRIOR_AESTHETIC_TREATMENT"
    case other = "OTHER"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .allergy: "Allergy"
        case .medication: "Medication"
        case .condition: "Condition"
        case .priorProcedure: "Prior procedure"
        case .priorAestheticTreatment: "Prior aesthetic treatment"
        case .other: "Other"
        }
    }
}

public struct MedicalHistoryEntry: Sendable, Equatable, Identifiable, Hashable, Codable {
    public let id: String
    public let category: HistoryCategory
    public let description: String
    /// YYYY-MM-DD.
    public let onsetDate: String?
    public let resolvedOn: String?
    public let recordedAt: Date
    public let version: Int

    public init(id: String, category: HistoryCategory, description: String, onsetDate: String?, resolvedOn: String?,
                recordedAt: Date, version: Int) {
        self.id = id
        self.category = category
        self.description = description
        self.onsetDate = onsetDate
        self.resolvedOn = resolvedOn
        self.recordedAt = recordedAt
        self.version = version
    }
}

/// The summary document a generation added a version to (ADR-0026 K3-17).
public struct SummaryVersion: Sendable, Equatable {
    public let documentId: String
    public let versionNumber: Int

    public init(documentId: String, versionNumber: Int) {
        self.documentId = documentId
        self.versionNumber = versionNumber
    }
}
