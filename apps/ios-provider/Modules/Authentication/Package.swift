// swift-tools-version: 6.2
// Authentication: Sign-in, MFA, token refresh, biometric unlock, session revocation handling.
// Bible §21.1. Tier: platform. Built from Layer 1. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "Authentication",
    platforms: [.iOS("26.0")],
    products: [.library(name: "Authentication", targets: ["Authentication"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../CoreNetworking"),
        .package(path: "../CoreSecurity"),
    ],
    targets: [
        .target(name: "Authentication", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "CoreNetworking", package: "CoreNetworking"), .product(name: "CoreSecurity", package: "CoreSecurity")]),
    ]
)
