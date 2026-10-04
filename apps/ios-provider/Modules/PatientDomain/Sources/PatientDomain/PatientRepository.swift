// Networking for patients through the generated client. Every call is
// authorized by the server; a 403 or 404 is the real answer (spec §4.6).
import CoreNetworking
import Foundation

public actor PatientRepository {
    private let client: Client

    public init(client: Client) {
        self.client = client
    }

    /// For extensions in other files of the module.
    var apiClient: Client { client }

    /// Search by name prefix, or an exact date of birth, email or phone. The term travels in the body.
    public func search(_ query: SearchQuery) async throws(APIError) -> [PatientSummary] {
        let body: Components.Schemas.PatientSearchRequest = switch query {
        case let .name(name): .init(name: name)
        case let .dateOfBirth(date): .init(dateOfBirth: date)
        case let .email(email): .init(email: email)
        case let .phone(phone): .init(phone: phone)
        }
        let client = self.client
        let page = try await callAPI { try await client.searchPatients(body: .json(body)).ok.body.json }
        return page.data.map(Self.summary)
    }

    /// Recently updated patients of the organization.
    public func recent() async throws(APIError) -> [PatientSummary] {
        let client = self.client
        let page = try await callAPI { try await client.listPatients(query: .init(limit: 50)).ok.body.json }
        return page.data.map(Self.summary)
    }

    public func duplicates(of draft: PatientDraft) async throws(APIError) -> [DuplicateCandidate] {
        let client = self.client
        let request = Components.Schemas.DuplicateCheckRequest(
            firstName: draft.firstName,
            lastName: draft.lastName,
            dateOfBirth: draft.dateOfBirthString,
            email: draft.optional(draft.email),
            phone: draft.optional(draft.phone)
        )
        let result = try await callAPI { try await client.checkPatientDuplicates(body: .json(request)).ok.body.json.data }
        return result.candidates.map {
            DuplicateCandidate(id: $0.patientId, reasons: $0.matchReasons.map(\.rawValue), summary: $0.summary.map(Self.summary))
        }
    }

    /// Creates the patient. The same idempotency key on a retry returns the same patient (spec §6.1.8).
    public func create(_ draft: PatientDraft, confirmNoDuplicate: Bool, idempotencyKey: String) async throws(APIError) -> Patient {
        let client = self.client
        let request = Components.Schemas.PatientCreate(
            firstName: draft.firstName,
            lastName: draft.lastName,
            preferredName: draft.optional(draft.preferredName),
            dateOfBirth: draft.dateOfBirthString,
            email: draft.optional(draft.email),
            phone: draft.optional(draft.phone),
            confirmNoDuplicate: confirmNoDuplicate
        )
        let created = try await callAPI {
            try await client.createPatient(headers: .init(idempotencyKey: idempotencyKey), body: .json(request)).created.body.json.data
        }
        return Self.patient(created)
    }

    /// Opens the profile; the server records PATIENT_VIEWED.
    public func profile(id: String) async throws(APIError) -> PatientProfile {
        let client = self.client
        let profile = try await callAPI { try await client.getPatient(path: .init(patientId: id)).ok.body.json.data }
        let readable = Set(profile.tabs.filter(\.readable).compactMap { ProfileTab(rawValue: $0.key.rawValue) })
        return PatientProfile(patient: Self.patient(profile.patient), readableTabs: readable)
    }

    static func summary(_ p: Components.Schemas.PatientSummary) -> PatientSummary {
        PatientSummary(
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            preferredName: p.preferredName,
            dateOfBirth: p.dateOfBirth,
            mrn: p.mrn,
            status: p.status.rawValue
        )
    }

    static func patient(_ p: Components.Schemas.Patient) -> Patient {
        Patient(
            id: p.id,
            firstName: p.firstName,
            middleName: p.middleName,
            lastName: p.lastName,
            preferredName: p.preferredName,
            dateOfBirth: p.dateOfBirth,
            email: p.email,
            phone: p.phone,
            mrn: p.mrn,
            status: p.status.rawValue,
            version: p.version
        )
    }
}
