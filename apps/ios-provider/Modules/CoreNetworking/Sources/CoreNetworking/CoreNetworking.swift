// CoreNetworking
//
// The API client generated from packages/api-contracts/openapi.json (spec §2.2,
// §6.8), with request correlation, the access token, one refresh-and-retry on
// 401, and error envelopes turned into `APIError` (spec §6.1).
// Bible §20 · tier: foundation · Layer 1.
import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

/// Supplies the access token and renews it once when the server answers 401.
public protocol AccessTokenProviding: Sendable {
    func currentAccessToken() async -> String?
    /// Renews the session; returns the new access token, or nil when it has ended.
    func refreshAccessToken() async -> String?
}

/// Builds the generated client for a server.
public enum APIClientFactory {
    public static func make(baseURL: URL, tokens: (any AccessTokenProviding)? = nil) -> Client {
        var middlewares: [any ClientMiddleware] = [CorrelationMiddleware(), ErrorEnvelopeMiddleware()]
        if let tokens { middlewares.append(AuthorizationMiddleware(tokens: tokens)) }
        return Client(
            serverURL: baseURL.appending(path: "api/v1"),
            // Server timestamps carry milliseconds (spec §6.1.2).
            configuration: Configuration(dateTranscoder: .iso8601WithFractionalSeconds),
            transport: URLSessionTransport(),
            middlewares: middlewares
        )
    }

    /// For tests: the same middleware over another transport.
    public static func make(baseURL: URL, transport: any ClientTransport, tokens: (any AccessTokenProviding)? = nil) -> Client {
        var middlewares: [any ClientMiddleware] = [CorrelationMiddleware(), ErrorEnvelopeMiddleware()]
        if let tokens { middlewares.append(AuthorizationMiddleware(tokens: tokens)) }
        return Client(
            serverURL: baseURL.appending(path: "api/v1"),
            configuration: Configuration(dateTranscoder: .iso8601WithFractionalSeconds),
            transport: transport,
            middlewares: middlewares
        )
    }
}

/// A fresh `Idempotency-Key` for a create that must not run twice (spec §6.1.8).
public func newIdempotencyKey() -> String { UUID().uuidString.lowercased() }

/// An `If-Match` value for a resource version (spec §6.1.7).
public func ifMatch(_ version: Int) -> String { "\"v\(version)\"" }

/// Maps an app enum onto the generated enum with the same raw values (the
/// contract's values, which both sides spell identically). Generated types stop
/// at the repositories (ADR-0022), so this is the only crossing.
public func wire<Source: RawRepresentable, Target: RawRepresentable>(_ value: Source) -> Target
    where Source.RawValue == String, Target.RawValue == String {
    guard let mapped = Target(rawValue: value.rawValue) else {
        preconditionFailure("\(value.rawValue) is not a value of \(Target.self)")
    }
    return mapped
}

/// Maps a generated enum back onto the app enum with the same raw values, when it has one.
public func unwire<Source: RawRepresentable, Target: RawRepresentable>(_ value: Source) -> Target?
    where Source.RawValue == String, Target.RawValue == String {
    Target(rawValue: value.rawValue)
}

/// Runs a generated-client call and surfaces the server's error as `APIError`.
public func callAPI<T: Sendable>(_ operation: @Sendable () async throws -> T) async throws(APIError) -> T {
    do {
        return try await operation()
    } catch let error as APIError {
        throw error
    } catch let error as ClientError {
        if let apiError = error.underlyingError as? APIError { throw apiError }
        if error.underlyingError is URLError { throw APIError.offline }
        throw APIError.unexpected
    } catch is URLError {
        throw APIError.offline
    } catch {
        throw APIError.unexpected
    }
}

// MARK: - Middleware

/// Adds `X-Client-Request-Id`, logged by the server and never trusted (spec §6.1.4).
struct CorrelationMiddleware: ClientMiddleware {
    static let header = HTTPField.Name("X-Client-Request-Id")!

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        request.headerFields[Self.header] = UUID().uuidString.lowercased()
        return try await next(request, body, baseURL)
    }
}

/// Sends the access token; on 401 renews the session once and retries.
struct AuthorizationMiddleware: ClientMiddleware {
    let tokens: any AccessTokenProviding

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        // Sign-in steps carry their own proof in the body.
        let anonymous: Set<String> = ["login", "verifyMfa", "refreshToken", "forgotPassword", "resetPassword", "acceptInvitation"]
        guard !anonymous.contains(operationID) else { return try await next(request, body, baseURL) }
        var authorized = request
        if let token = await tokens.currentAccessToken() {
            authorized.headerFields[.authorization] = "Bearer \(token)"
        }
        let (response, responseBody) = try await next(authorized, body, baseURL)
        guard response.status.code == 401, let renewed = await tokens.refreshAccessToken() else {
            return (response, responseBody)
        }
        var retry = request
        retry.headerFields[.authorization] = "Bearer \(renewed)"
        return try await next(retry, body, baseURL)
    }
}

/// Turns every error response into `APIError` from its envelope (spec §6.1.5).
struct ErrorEnvelopeMiddleware: ClientMiddleware {
    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let (response, responseBody) = try await next(request, body, baseURL)
        guard response.status.code >= 400 else { return (response, responseBody) }
        var data = Data()
        if let responseBody { data = try await Data(collecting: responseBody, upTo: 256 * 1024) }
        throw APIError(status: response.status.code, envelope: data, retryAfter: response.headerFields[.retryAfter])
    }
}
