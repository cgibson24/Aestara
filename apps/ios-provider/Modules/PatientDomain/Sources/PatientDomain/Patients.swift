// Patient models and the repository (Bible §4; spec §6.3 "Patients", §6.6.1;
// ADR-0020 search). Generated API types stop here: views get domain models
// (docs/IOS_ARCHITECTURE.md §5). Patient creation is online-only, because the
// duplicate check needs the server (ADR-0018 K-17).
// Bible §4, §23 · tier: domain · Layer 1.
import CoreNetworking
import Foundation

public struct PatientSummary: Sendable, Equatable, Identifiable, Hashable, Codable {
    public let id: String
    public let firstName: String
    public let lastName: String
    public let preferredName: String?
    public let dateOfBirth: String
    public let mrn: String?
    public let status: String

    public var displayName: String {
        if let preferredName, preferredName != firstName { return "\(firstName) (\(preferredName)) \(lastName)" }
        return "\(firstName) \(lastName)"
    }
}

public struct Patient: Sendable, Equatable, Identifiable, Codable {
    public let id: String
    public let firstName: String
    public let middleName: String?
    public let lastName: String
    public let preferredName: String?
    public let dateOfBirth: String
    public let email: String?
    public let phone: String?
    public let mrn: String?
    public let status: String
    public let version: Int

    public var displayName: String { "\(preferredName ?? firstName) \(lastName)" }
}

/// The twelve profile tabs (Bible §4.3; PR-PATIENT-06). Readability comes from the server.
public enum ProfileTab: String, CaseIterable, Sendable, Identifiable, Codable {
    case overview = "OVERVIEW"
    case timeline = "TIMELINE"
    case consultations = "CONSULTATIONS"
    case photos = "PHOTOS"
    case beforeAfter = "BEFORE_AFTER"
    case simulations = "SIMULATIONS"
    case treatmentPlans = "TREATMENT_PLANS"
    case procedures = "PROCEDURES"
    case documents = "DOCUMENTS"
    case instructions = "INSTRUCTIONS"
    case appointments = "APPOINTMENTS"
    case messages = "MESSAGES"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .overview: "Overview"
        case .timeline: "Timeline"
        case .consultations: "Consultations"
        case .photos: "Photos"
        case .beforeAfter: "Before / After"
        case .simulations: "AI Simulations"
        case .treatmentPlans: "Treatment Plans"
        case .procedures: "Procedures"
        case .documents: "Documents"
        case .instructions: "Instructions"
        case .appointments: "Appointments"
        case .messages: "Messages"
        }
    }

    public var systemImage: String {
        switch self {
        case .overview: "person.text.rectangle"
        case .timeline: "clock"
        case .consultations: "stethoscope"
        case .photos: "camera"
        case .beforeAfter: "square.split.2x1"
        case .simulations: "wand.and.stars"
        case .treatmentPlans: "list.bullet.clipboard"
        case .procedures: "cross.case"
        case .documents: "doc.text"
        case .instructions: "text.book.closed"
        case .appointments: "calendar"
        case .messages: "message"
        }
    }
}

public struct PatientProfile: Sendable, Equatable, Codable {
    public let patient: Patient
    /// Tabs the caller's role may read (spec §6.3 read permissions).
    public let readableTabs: Set<ProfileTab>
}

/// A new patient as typed by staff.
public struct PatientDraft: Sendable, Equatable {
    public var firstName = ""
    public var lastName = ""
    public var preferredName = ""
    public var dateOfBirth = Date()
    public var email = ""
    public var phone = ""

    public init() {}

    /// The calendar date picked on this device, as `YYYY-MM-DD`. A date of birth
    /// is a date, not an instant, so no time-zone conversion applies.
    public var dateOfBirthString: String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: dateOfBirth)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    func optional(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

public struct DuplicateCandidate: Sendable, Equatable, Identifiable {
    public let id: String
    public let reasons: [String]
    public let summary: PatientSummary?

    public var reasonText: String {
        reasons.map { reason in
            switch reason {
            case "SAME_EMAIL": "same email"
            case "SAME_PHONE": "same phone"
            case "SAME_MRN": "same MRN"
            case "SAME_DATE_OF_BIRTH_SIMILAR_NAME": "same date of birth and a similar name"
            default: reason.lowercased().replacingOccurrences(of: "_", with: " ")
            }
        }.joined(separator: ", ")
    }
}

/// What a search box string means: a date, an email, a phone number or a name (ADR-0020).
public enum SearchQuery: Equatable, Sendable {
    case name(String)
    case dateOfBirth(String)
    case email(String)
    case phone(String)

    public init?(_ text: String) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        if value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
            self = .dateOfBirth(value)
        } else if value.contains("@") {
            self = .email(value)
        } else if value.filter(\.isNumber).count >= 7, value.allSatisfy({ $0.isNumber || " +-().".contains($0) }) {
            self = .phone(value)
        } else {
            self = .name(value)
        }
    }
}
