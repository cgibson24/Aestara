// Photography and offline use for one signed-in user in one organization
// (ADR-0023 K2-17): the repository, the encrypted store with its upload queue,
// derivative cache, patient summaries and offline view audit, the cache policy
// and the feature flags. On reconnect, offline views replay first, then the
// queue (spec §8 rules 5, 8). The permissions only shape the UI; the server
// authorizes every request.
// Bible §6, §23 · tier: feature · Layer 2.
import AuditSupport
import CoreNetworking
import CoreSecurity
import Foundation
import Media
import Network
import Observation
import PatientDomain

@MainActor
@Observable
public final class PhotographyContext {
    public let repository: PhotographyRepository
    public let queue: UploadQueue
    public let cache: MediaCache
    public let offlineAudit: OfflineAuditQueue
    /// The recent list and opened profiles, for reaching a patient offline.
    public let patients: PatientCache
    let transfer = MediaTransfer()
    private let client: Client
    private let auditSender: ClientOfflineAuditSender
    private let store: EncryptedStore
    private var permissions: Set<String>

    public private(set) var flags: [String: Bool] = [:]
    /// Photos not yet held by the server; lost if the user signs out now.
    public private(set) var unsentCount = 0
    /// False after a request failed for want of a connection.
    public private(set) var isOnline = true
    private var syncing = false
    private var syncRequested = false

    public init(client: Client, scope: StoreScope, permissions: Set<String>, keys: any StoreKeyProviding = KeychainStoreKeys()) {
        let store = EncryptedStore(scope: scope, keys: keys)
        self.store = store
        self.client = client
        self.repository = PhotographyRepository(client: client)
        self.queue = UploadQueue(store: store)
        self.cache = MediaCache(store: store)
        self.offlineAudit = OfflineAuditQueue(store: store)
        self.patients = PatientCache(store: store)
        self.auditSender = ClientOfflineAuditSender(client: client)
        self.permissions = permissions
    }

    /// The user and organization this context belongs to.
    public var scope: StoreScope { store.scope }

    public func can(_ permission: String) -> Bool { permissions.contains(permission) }

    /// The session's permissions changed (they only shape the UI).
    public func updatePermissions(_ permissions: Set<String>) {
        self.permissions = permissions
    }

    public var ghostOverlayEnabled: Bool { flags["photography.ghostOverlay"] ?? true }
    public var liveGuidanceEnabled: Bool { flags["photography.liveGuidance"] ?? true }

    /// After sign-in, after each accepted photo and on reconnect: offline views first,
    /// then the queue, then policy and flags. A request during a run runs once more after it.
    public func sync() async {
        guard !syncing else {
            syncRequested = true
            return
        }
        syncing = true
        defer { syncing = false }
        repeat {
            syncRequested = false
            await syncOnce()
        } while syncRequested
    }

    private func syncOnce() async {
        guard await revalidate() else {
            unsentCount = await queue.unsentCount()
            return
        }
        let replay = await offlineAudit.replay(using: auditSender)
        let outcome = await queue.process(service: repository, uploader: transfer)
        isOnline = replay.remaining == 0 && !outcome.interrupted
        if isOnline {
            do throws(APIError) {
                let policy = try await repository.offlineCachePolicy()
                await cache.apply(policy)
                await patients.apply(maxPatients: policy.maxPatients, maxAgeDays: policy.maxAgeDays)
                flags = try await repository.featureFlags()
            } catch {
                note(error)
            }
        }
        unsentCount = await queue.unsentCount()
    }

    /// A profile opened from the device's copy: recorded here and replayed on reconnect (spec §8 rule 8).
    public func recordOfflinePatientView(_ patientId: String) async {
        await offlineAudit.record(.patientViewed(patientId))
    }

    /// Spec §8 rule 5: the session is checked before anything replays. Its permissions
    /// replace the cached ones; a session of another user or organization replays nothing.
    private func revalidate() async -> Bool {
        let client = self.client
        do throws(APIError) {
            let session = try await callAPI { try await client.getSession().ok.body.json.data }
            reachedServer()
            guard session.user.id == scope.userId, session.organization?.id == scope.organizationId else { return false }
            permissions = Set(session.permissions)
            return true
        } catch {
            note(error)
            return false
        }
    }

    public func refreshUnsent() async {
        unsentCount = await queue.unsentCount()
    }

    /// Records whether the last request reached the server.
    func note(_ error: APIError) {
        if error.status == 0 { isOnline = false }
    }

    func reachedServer() {
        isOnline = true
    }

    /// Sign-out (ADR-0023 K2-17): queued photos, cached images and cached lists go. The
    /// offline view records stay sealed for this user and organization and replay at their
    /// next sign-in, so no audited view is lost (spec §8 rule 8).
    public func purgeForSignOut() async {
        await queue.purge()
        await purgeCache()
        unsentCount = 0
    }

    /// The session ended (absolute expiry or device revocation): cached images and lists go;
    /// the queue stays sealed until the same user signs in to this organization again.
    public func purgeCache() async {
        await cache.removeAll()
        await patients.removeAll()
        for name in store.names(withPrefix: Self.photosPrefix) { store.remove(name) }
        store.remove(Self.protocolsRecord)
    }

    /// Before signing out: one last attempt to upload, then what would be lost.
    public func unsentBeforeSignOut() async -> Int {
        await sync()
        return unsentCount
    }

    /// Replays after reconnecting (spec §8 rule 5): runs while the shell is shown.
    public func monitorConnectivity() async {
        let (paths, continuation) = AsyncStream.makeStream(of: Bool.self, bufferingPolicy: .bufferingNewest(1))
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { path in continuation.yield(path.status == .satisfied) }
        monitor.start(queue: DispatchQueue(label: "com.aestara.provider.network"))
        defer { monitor.cancel() }
        var wasSatisfied = true
        for await satisfied in paths {
            if satisfied, !wasSatisfied { await sync() }
            wasSatisfied = satisfied
        }
    }

    // MARK: Offline copies of server lists

    private static let photosPrefix = "photos."
    private static let protocolsRecord = "protocols.json"

    /// Offline copies are written off the main thread; no screen waits for them.
    func savePhotos(_ photos: [PhotoItem], patientId: String) {
        let store = self.store
        let name = "\(Self.photosPrefix)\(Self.safe(patientId)).json"
        Task.detached(priority: .utility) { try? store.writeJSON(photos, as: name) }
    }

    func cachedPhotos(patientId: String) -> [PhotoItem] {
        (try? store.readJSON([PhotoItem].self, from: "\(Self.photosPrefix)\(Self.safe(patientId)).json")) ?? []
    }

    func saveProtocols(_ protocols: [PhotoProtocol]) {
        let store = self.store
        let name = Self.protocolsRecord
        Task.detached(priority: .utility) { try? store.writeJSON(protocols, as: name) }
    }

    func cachedProtocols() -> [PhotoProtocol] {
        (try? store.readJSON([PhotoProtocol].self, from: Self.protocolsRecord)) ?? []
    }

    static func safe(_ id: String) -> String {
        String(id.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "-" })
    }

    // MARK: Derivatives

    /// Thumbnails or previews. Online, the signed URLs are always requested, because
    /// the server audits each view as it issues them (`PHOTO_VIEWED`); bytes already in
    /// the encrypted cache are not downloaded again. Offline, cached images are shown
    /// and each view is recorded for replay (spec §8 rule 8).
    func derivatives(patientId: String, photoIds: [String], variant: DerivativeVariant) async -> [String: Data] {
        guard !photoIds.isEmpty else { return [:] }
        var found: [String: Data] = [:]
        do throws(APIError) {
            let urls = try await repository.accessURLs(patientId: patientId, photoIds: photoIds, variant: variant)
            reachedServer()
            for (id, url) in urls {
                if let cached = await cache.data(photoId: id, variant: variant) {
                    found[id] = cached
                    continue
                }
                do throws(TransferError) {
                    let data = try await transfer.download(url)
                    found[id] = data
                    await cache.put(data, photoId: id, patientId: patientId, variant: variant)
                } catch {
                    continue
                }
            }
            return found
        } catch {
            note(error)
            guard error.status == 0 else { return [:] }
        }
        let auditVariant: OfflineViewEvent.Variant = variant == .thumbnail ? .thumbnail : .displayPreview
        for id in photoIds {
            guard let cached = await cache.data(photoId: id, variant: variant) else { continue }
            found[id] = cached
            await offlineAudit.record(.photoViewed(patientId: patientId, photoId: id, variant: auditVariant))
        }
        return found
    }

    /// The camera, or in Debug builds the synthetic source the UI tests ask for.
    func frameSource(for target: PoseTarget) -> any FrameSource {
        #if DEBUG
        if SyntheticFrameSource.isRequested { return SyntheticFrameSource(target: target) }
        #endif
        return CameraFrameSource(subject: target.subject)
    }
}
