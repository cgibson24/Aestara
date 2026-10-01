// Signed transfers (spec §3.4 flow A, §6.1.9; ADR-0023 K2-03): originals go up
// through the presigned write-once PUT the api issues; thumbnails and previews
// come down through short-lived signed URLs. The session is ephemeral with no
// URL cache, so no image ever reaches an unencrypted cache on disk, and signed
// URLs are never logged.
// Bible §6.6, §21.2 · tier: platform · Layer 2.
import CryptoKit
import Foundation

public enum TransferError: Error, Sendable, Equatable {
    /// No connection: try again later.
    case offline
    /// The URL expired or was refused; a fresh one is needed.
    case refused(status: Int)
    /// The server failed; try again later.
    case server(status: Int)
}

public struct MediaTransfer: Sendable {
    private let session: URLSession

    public init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 60
        self.session = URLSession(configuration: configuration)
    }

    /// PUTs an original with exactly the headers the URL was signed with. A `412`
    /// means an earlier attempt already stored it: the object is write-once, and
    /// the api verifies its size and checksum at completion.
    public func upload(_ data: Data, to url: URL, headers: [String: String]) async throws(TransferError) {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let status: Int
        do {
            let (_, response) = try await session.upload(for: request, from: data)
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
        } catch {
            throw .offline
        }
        if status == 200 || status == 412 { return }
        throw status >= 500 ? .server(status: status) : .refused(status: status)
    }

    /// GETs a derivative through its signed URL.
    public func download(_ url: URL) async throws(TransferError) -> Data {
        let data: Data
        let status: Int
        do {
            let (body, response) = try await session.data(from: url)
            data = body
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
        } catch {
            throw .offline
        }
        guard status == 200 else { throw status >= 500 ? .server(status: status) : .refused(status: status) }
        return data
    }
}

/// Lower-case hex SHA-256: what the upload intent declares and S3 verifies.
public func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}
