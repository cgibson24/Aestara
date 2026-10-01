// swift-tools-version: 6.2
// CoreSecurity: Keychain access, the encrypted local store (GRDB + SQLCipher), biometric gate, secure wipe on sign-out.
// Bible §21.2, §23.3. Tier: foundation. Built from Layer 1. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "CoreSecurity",
    platforms: [.iOS("26.0")],
    products: [.library(name: "CoreSecurity", targets: ["CoreSecurity"])],
    targets: [
        // Keychain tests need an app's entitlements: they run hosted in the
        // provider app (apps/ios-provider/Tests, ADR-0022).
        .target(name: "CoreSecurity"),
    ]
)
