// CoreNetworking
//
// The API client generated from packages/api-contracts/openapi.json, with
// request correlation, idempotency keys and error-envelope handling.
// Bible §20 · tier: foundation · Layer 1.
import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

/// Builds the generated client for a server.
public enum APIClientFactory {
    public static func make(baseURL: URL, middlewares: [any ClientMiddleware] = []) -> Client {
        Client(
            serverURL: baseURL.appending(path: "api/v1"),
            transport: URLSessionTransport(),
            middlewares: middlewares
        )
    }
}
