import AppShell
import Authentication
import DesignSystem
import SwiftUI
import UIKit

@main
struct AestaraProviderApp: App {
    @State private var store: AuthStore?

    init() {
        if let baseURL = APIConfiguration.baseURL(from: Bundle.main) {
            let device = UIDevice.current
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
            _store = State(initialValue: AuthStore(
                baseURL: baseURL,
                deviceName: device.name,
                deviceModel: device.model,
                osVersion: device.systemVersion,
                appVersion: version
            ))
        }
    }

    var body: some Scene {
        WindowGroup {
            if let store {
                ProviderRootView(store: store)
            } else {
                DSStateView(.error(
                    message: "This build has no server address. Install a build made for your environment.",
                    reference: nil
                ))
            }
        }
    }
}

/// The API address comes from the build (`AESTARA_API_BASE_URL`, ADR-0022).
/// Only HTTPS is accepted, except a local development server.
enum APIConfiguration {
    static func baseURL(from bundle: Bundle) -> URL? {
        guard let value = bundle.object(forInfoDictionaryKey: "AestaraAPIBaseURL") as? String,
              let url = URL(string: value.trimmingCharacters(in: .whitespaces)),
              let host = url.host() else { return nil }
        if url.scheme == "https" { return url }
        let local = ["localhost", "127.0.0.1", "::1"].contains(host)
        return url.scheme == "http" && local ? url : nil
    }
}
