// The patient timeline (Bible §4.3; spec §6.3 `/timeline`; ADR-0026 K3-18):
// metadata items from the domain tables, newest first. The server shows each
// domain only to a caller who can read it, and an item never holds record text.
// Bible §4.3 · tier: domain · Layer 3.
import CoreNetworking
import Foundation

public enum TimelineDomain: String, Sendable, Codable, CaseIterable, Identifiable, Hashable {
    case patient = "PATIENT"
    case consultation = "CONSULTATION"
    case photography = "PHOTOGRAPHY"
    case document = "DOCUMENT"
    case mediaPermission = "MEDIA_PERMISSION"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .patient: "Patient"
        case .consultation: "Consultations"
        case .photography: "Photography"
        case .document: "Documents"
        case .mediaPermission: "Media permissions"
        }
    }
}

public struct TimelineItem: Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    /// The event, e.g. `CONSULTATION_COMPLETED`.
    public let kind: String
    public let domain: TimelineDomain
    public let occurredAt: Date
    public let actorUserId: String?
    public let resourceType: String
    public let resourceId: String

    public init(id: String, kind: String, domain: TimelineDomain, occurredAt: Date, actorUserId: String?,
                resourceType: String, resourceId: String) {
        self.id = id
        self.kind = kind
        self.domain = domain
        self.occurredAt = occurredAt
        self.actorUserId = actorUserId
        self.resourceType = resourceType
        self.resourceId = resourceId
    }

    /// What happened, in words.
    public var title: String {
        switch kind {
        case "PATIENT_CREATED": "Patient added"
        case "PATIENT_ARCHIVED": "Patient archived"
        case "CONSULTATION_CREATED": "Consultation created"
        case "CONSULTATION_STARTED": "Consultation started"
        case "CONSULTATION_SUBMITTED_FOR_REVIEW": "Consultation submitted for review"
        case "CONSULTATION_COMPLETED": "Consultation completed"
        case "CONSULTATION_CANCELLED": "Consultation cancelled"
        case "CONSULTATION_ARCHIVED": "Consultation archived"
        case "PHOTO_SESSION_COMPLETED": "Photo session completed"
        case "BEFORE_AFTER_CREATED": "Before and after pair created"
        case "DOCUMENT_ADDED": "Document added"
        case "MEDIA_PERMISSION_CHANGED": "Media permission recorded"
        case "MEDIA_RELEASED": "Media released"
        case "MEDIA_RELEASE_REVOKED": "Media release revoked"
        default: "Event"
        }
    }

    public var systemImage: String {
        switch domain {
        case .patient: "person"
        case .consultation: "stethoscope"
        case .photography: "camera"
        case .document: "doc.text"
        case .mediaPermission: "hand.raised"
        }
    }
}

/// One page of the timeline and where the next one starts.
public struct TimelinePage: Sendable, Equatable {
    public let items: [TimelineItem]
    public let nextCursor: String?
}

extension PatientRepository {
    /// A page of the timeline, optionally one domain only.
    public func timeline(patientId: String, domain: TimelineDomain? = nil, cursor: String? = nil) async throws(APIError) -> TimelinePage {
        let client = self.apiClient
        let page = try await callAPI {
            try await client.getPatientTimeline(
                path: .init(patientId: patientId),
                query: .init(limit: 50, cursor: cursor, domain: domain.flatMap { Components.Schemas.TimelineDomain(rawValue: $0.rawValue) })
            ).ok.body.json
        }
        let items = page.data.compactMap { item -> TimelineItem? in
            guard let domain = TimelineDomain(rawValue: item.domain.rawValue) else { return nil }
            return TimelineItem(id: item.id, kind: item.kind.rawValue, domain: domain, occurredAt: item.occurredAt,
                                actorUserId: item.actorUserId, resourceType: item.resource._type.rawValue,
                                resourceId: item.resource.id)
        }
        return TimelinePage(items: items, nextCursor: page.page.hasMore ? page.page.nextCursor : nil)
    }
}
