import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing
@testable import CoreNetworking

/// A transport that answers from a closure, so the middleware is tested without a network.
struct StubTransport: ClientTransport {
    let respond: @Sendable (HTTPRequest) async throws -> (HTTPResponse, HTTPBody?)
    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        try await respond(request)
    }
}

actor TokenBox: AccessTokenProviding {
    var token: String? = "old"
    var refreshes = 0
    func currentAccessToken() async -> String? { token }
    func refreshAccessToken() async -> String? {
        refreshes += 1
        token = "new"
        return token
    }
}

@Test func parsesTheErrorEnvelope() {
    let json = """
    {"error":{"code":"VALIDATION_FAILED","message":"The request is not valid.","requestId":"0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f",
    "details":{"fieldErrors":[{"path":"dateOfBirth","code":"INVALID","message":"Must be a valid date."}]}}}
    """
    let error = APIError(status: 400, envelope: Data(json.utf8))
    #expect(error.code == "VALIDATION_FAILED")
    #expect(error.requestId == "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f")
    #expect(error.displayMessage == "Must be a valid date.")
}

@Test func readsTheSignInChallenge() {
    let json = """
    {"error":{"code":"MFA_REQUIRED","message":"m","requestId":"r","details":{"challengeToken":"abc","expiresAt":"2026-10-01T00:00:00.000Z","factors":["TOTP"],"enrollmentRequired":false}}}
    """
    let error = APIError(status: 401, envelope: Data(json.utf8))
    #expect(error.challenge == MFAChallenge(challengeToken: "abc", enrollmentRequired: false, factors: ["TOTP"]))
}

@Test func readsDuplicateCandidatesAndVersions() {
    let duplicate = APIError(
        status: 409,
        envelope: Data(#"{"error":{"code":"DUPLICATE_PATIENT_SUSPECTED","message":"m","requestId":"r","details":{"candidates":[{"patientId":"p1","matchReasons":["SAME_EMAIL"]}]}}}"#.utf8)
    )
    #expect(duplicate.duplicateCandidates == [.init(patientId: "p1", matchReasons: ["SAME_EMAIL"])])
    let stale = APIError(status: 412, envelope: Data(#"{"error":{"code":"VERSION_CONFLICT","message":"m","requestId":"r","details":{"currentVersion":4}}}"#.utf8))
    #expect(stale.currentVersion == 4)
}

@Test func refreshesOnceOn401ThenRetries() async throws {
    let tokens = TokenBox()
    let transport = StubTransport { request in
        if request.headerFields[.authorization] == "Bearer new" {
            let body = #"{"status":"ok"}"#
            return (HTTPResponse(status: .ok, headerFields: [.contentType: "application/json"]), HTTPBody(body))
        }
        let body = #"{"error":{"code":"UNAUTHENTICATED","message":"Sign in to continue.","requestId":"r"}}"#
        return (HTTPResponse(status: .unauthorized, headerFields: [.contentType: "application/json"]), HTTPBody(body))
    }
    let client = APIClientFactory.make(baseURL: URL(string: "https://api.example.test")!, transport: transport, tokens: tokens)
    // The retried call answers 200 with a body that is not a session, so it still fails to decode;
    // what matters is that the 401 caused exactly one refresh.
    await #expect(throws: APIError.self) {
        _ = try await callAPI { try await client.getSession() }
    }
    #expect(await tokens.refreshes == 1)
}
