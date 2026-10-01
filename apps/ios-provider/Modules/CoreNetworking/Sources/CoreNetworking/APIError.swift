// The error envelope as a Swift error (spec §6.1.5, §6.2). Messages are safe
// to show; the request ID is the reference a user quotes to support.
import Foundation

public struct APIError: Error, Sendable, Equatable {
    public let status: Int
    /// The catalog code, e.g. `PERMISSION_DENIED` or `PATIENT_NOT_FOUND`.
    public let code: String
    public let message: String
    public let requestId: String?
    public let fieldErrors: [FieldError]
    /// The sign-in challenge of a `401 MFA_REQUIRED`.
    public let challenge: MFAChallenge?
    /// Probable duplicates of a `409 DUPLICATE_PATIENT_SUSPECTED`: patient IDs and match reasons.
    public let duplicateCandidates: [DuplicateCandidateReference]
    /// The current version in a `412 VERSION_CONFLICT`.
    public let currentVersion: Int?
    public let retryAfterSeconds: Int?

    public struct FieldError: Sendable, Equatable {
        public let path: String
        public let message: String
    }

    public struct DuplicateCandidateReference: Sendable, Equatable {
        public let patientId: String
        public let matchReasons: [String]
    }

    public init(
        status: Int,
        code: String,
        message: String,
        requestId: String? = nil,
        fieldErrors: [FieldError] = [],
        challenge: MFAChallenge? = nil,
        duplicateCandidates: [DuplicateCandidateReference] = [],
        currentVersion: Int? = nil,
        retryAfterSeconds: Int? = nil
    ) {
        self.status = status
        self.code = code
        self.message = message
        self.requestId = requestId
        self.fieldErrors = fieldErrors
        self.challenge = challenge
        self.duplicateCandidates = duplicateCandidates
        self.currentVersion = currentVersion
        self.retryAfterSeconds = retryAfterSeconds
    }

    /// Parses an error envelope; anything unreadable becomes a generic error with the status.
    public init(status: Int, envelope: Data, retryAfter: String? = nil) {
        let root = (try? JSONSerialization.jsonObject(with: envelope)) as? [String: Any]
        let error = root?["error"] as? [String: Any]
        let details = error?["details"] as? [String: Any]
        let fields = (details?["fieldErrors"] as? [[String: Any]] ?? []).compactMap { item -> FieldError? in
            guard let path = item["path"] as? String, let message = item["message"] as? String else { return nil }
            return FieldError(path: path, message: message)
        }
        let candidates = (details?["candidates"] as? [[String: Any]] ?? []).compactMap { item -> DuplicateCandidateReference? in
            guard let id = item["patientId"] as? String else { return nil }
            return DuplicateCandidateReference(patientId: id, matchReasons: item["matchReasons"] as? [String] ?? [])
        }
        let code = error?["code"] as? String ?? "INTERNAL_ERROR"
        self.init(
            status: status,
            code: code,
            message: error?["message"] as? String ?? "Something went wrong.",
            requestId: error?["requestId"] as? String,
            fieldErrors: fields,
            challenge: code == "MFA_REQUIRED" ? MFAChallenge(details: details) : nil,
            duplicateCandidates: candidates,
            currentVersion: details?["currentVersion"] as? Int,
            retryAfterSeconds: retryAfter.flatMap { Int($0) }
        )
    }

    /// No connection to the server.
    public static let offline = APIError(status: 0, code: "OFFLINE", message: "You are offline. Check your connection and try again.")
    /// A response the app could not read.
    public static let unexpected = APIError(status: 0, code: "UNEXPECTED", message: "Something went wrong. Try again.")

    public var isPermissionDenied: Bool { status == 403 && code == "PERMISSION_DENIED" }
    public var isNotFound: Bool { status == 404 }
    public var endsSession: Bool { code == "SESSION_INVALID" || code == "UNAUTHENTICATED" }

    /// What to show: field messages when present, else the server's message.
    public var displayMessage: String {
        fieldErrors.isEmpty ? message : fieldErrors.map(\.message).joined(separator: " ")
    }
}

/// The second step of sign-in (`error.details` of `401 MFA_REQUIRED`).
public struct MFAChallenge: Sendable, Equatable {
    public let challengeToken: String
    public let enrollmentRequired: Bool
    public let factors: [String]

    public init(challengeToken: String, enrollmentRequired: Bool, factors: [String]) {
        self.challengeToken = challengeToken
        self.enrollmentRequired = enrollmentRequired
        self.factors = factors
    }

    init?(details: [String: Any]?) {
        guard let token = details?["challengeToken"] as? String else { return nil }
        self.init(
            challengeToken: token,
            enrollmentRequired: details?["enrollmentRequired"] as? Bool ?? false,
            factors: details?["factors"] as? [String] ?? []
        )
    }
}
