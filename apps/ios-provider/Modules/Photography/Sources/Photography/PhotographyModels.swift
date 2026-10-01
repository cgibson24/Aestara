// Photography domain models (spec §6.3 "Photography"; ADR-0022: generated
// types stop at the repository). Values the server owns, such as statuses,
// stay as the contract's strings, and views compare them to named constants.
// Bible §6, §7 · tier: feature · Layer 2.
import Foundation

public struct PhotoProtocol: Sendable, Equatable, Identifiable, Codable {
    public let id: String
    public let name: String
    public let bodyRegion: String
    public let isStandard: Bool
    public let views: [ProtocolViewSpec]
}

public struct ProtocolViewSpec: Sendable, Equatable, Identifiable, Codable {
    public var id: String { viewKey }
    public let viewKey: String
    public let name: String
    public let sortOrder: Int
    public let isRequired: Bool
    public let instructions: String?
    public let poseTarget: PoseTarget?
}

public struct PhotoSessionModel: Sendable, Equatable, Identifiable, Codable {
    public let id: String
    public let patientId: String
    public let protocolId: String
    public let protocolName: String
    public let status: String
    public let startedAt: Date
    public let views: [SessionViewState]
    public let missingRequiredViews: [String]

    public var isOpen: Bool { status == "IN_PROGRESS" }
}

public struct SessionViewState: Sendable, Equatable, Identifiable, Codable {
    public var id: String { viewKey }
    public let viewKey: String
    public let name: String
    public let sortOrder: Int
    public let isRequired: Bool
    public let captured: Bool
    public let photoCount: Int
}

public enum DerivativeState: String, Sendable, Codable {
    case pending = "PENDING"
    case available = "AVAILABLE"
    case failed = "FAILED"
}

public struct PhotoItem: Sendable, Equatable, Identifiable, Codable {
    public let id: String
    public let patientId: String
    public let sessionId: String?
    public let viewKey: String?
    public let status: String
    public let capturedAt: Date
    public let scanStatus: String
    public let rejectionReason: String?
    public let thumbnail: DerivativeState
    public let preview: DerivativeState
    public let tags: [String]
    public let pose: PoseSample
    public let positionMatchScore: Double?

    public var isArchived: Bool { status == "ARCHIVED" }
    public var isRejected: Bool { status == "REJECTED" }
    /// Quarantined and rejected photos are never served (ADR-0023 K2-14).
    public var isViewable: Bool { status == "ACCEPTED" || status == "ARCHIVED" }
}

/// A presigned upload of one original.
public struct UploadTicket: Sendable, Equatable {
    public let photoId: String
    public let status: String
    public let url: URL?
    public let headers: [String: String]
}

/// The permission categories of Bible §7.1; none implies another.
public enum PermissionCategory: String, CaseIterable, Sendable, Identifiable, Codable {
    case clinicalUse = "CLINICAL_USE"
    case patientApp = "PATIENT_APP"
    case education = "EDUCATION"
    case website = "WEBSITE"
    case socialMedia = "SOCIAL_MEDIA"
    case paidAdvertising = "PAID_ADVERTISING"
    case research = "RESEARCH"
    case aiTraining = "AI_TRAINING"
    case internalAIEvaluation = "INTERNAL_AI_EVALUATION"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .clinicalUse: String(localized: "Clinical use")
        case .patientApp: String(localized: "Patient app")
        case .education: String(localized: "Education")
        case .website: String(localized: "Website")
        case .socialMedia: String(localized: "Social media")
        case .paidAdvertising: String(localized: "Paid advertising")
        case .research: String(localized: "Research")
        case .aiTraining: String(localized: "AI training")
        case .internalAIEvaluation: String(localized: "Internal AI evaluation")
        }
    }
}

/// The states staff may record; EXPIRED is set only by the system (spec §5.4.5).
public enum PermissionChange: String, CaseIterable, Sendable, Identifiable {
    case requested = "REQUESTED"
    case granted = "GRANTED"
    case declined = "DECLINED"
    case revoked = "REVOKED"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .requested: String(localized: "Requested")
        case .granted: String(localized: "Granted")
        case .declined: String(localized: "Declined")
        case .revoked: String(localized: "Revoked")
        }
    }
}

enum PermissionEvidence: String {
    /// The only evidence until signed consents arrive in Layer 4 (ADR-0023 K2-15).
    case staffAttestation = "STAFF_ATTESTATION"
}

public struct PermissionRecord: Sendable, Equatable, Identifiable {
    public let id: String
    public let category: String
    public let scope: String
    public let photoSessionId: String?
    public let photoId: String?
    public let state: String
    public let versionNumber: Int
    public let effectiveAt: Date
    public let expiresAt: Date?
    public let evidence: String?
    public let reason: String?
}

public struct PermissionCategoryState: Sendable, Equatable, Identifiable {
    public var id: String { category.rawValue }
    public let category: PermissionCategory
    /// The patient-wide state, expiry applied; NOT_REQUESTED when nothing is recorded.
    public let state: String
    public let current: PermissionRecord?
    /// Photo- or session-specific rows, which win over the patient-wide one.
    public let exceptions: [PermissionRecord]

    /// The state that governs one photo: its own row, then its session's, then the patient-wide state (K2-15).
    public func effectiveState(forPhoto photoId: String, sessionId: String?, at now: Date = Date()) -> String {
        let row = photoRow(photoId) ?? sessionId.flatMap { session in exceptions.first { $0.photoSessionId == session } }
        guard let row else { return state }
        return row.effectiveState(at: now)
    }

    /// The photo's own exception, if one is recorded.
    public func photoRow(_ photoId: String) -> PermissionRecord? {
        exceptions.first { $0.photoId == photoId }
    }
}

extension PermissionRecord {
    /// A grant past its expiry reads as EXPIRED before the system job records it.
    public func effectiveState(at now: Date = Date()) -> String {
        if state == "GRANTED", let expiresAt, expiresAt <= now { return "EXPIRED" }
        return state
    }
}

extension PermissionChange {
    /// The changes staff may record from a state (spec §5.4.5); the server decides.
    public static func allowed(from state: String) -> [PermissionChange] {
        switch state {
        case "NOT_REQUESTED", "DECLINED", "REVOKED", "EXPIRED": [.requested]
        case "REQUESTED": [.granted, .declined]
        case "GRANTED": [.revoked]
        default: []
        }
    }
}

/// A photo released for one purpose, pinned to the permission versions it relied on (Bible §7.3).
public struct MediaReleaseItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let purpose: PermissionCategory
    public let photoId: String?
    public let releasedAt: Date
    public let revokedAt: Date?
    public let revocationReason: String?
    public let isActive: Bool
}

/// Human words for a contract value such as `NOT_REQUESTED`.
public func words(_ value: String) -> String {
    let lower = value.lowercased().replacingOccurrences(of: "_", with: " ")
    return lower.prefix(1).uppercased() + lower.dropFirst()
}
