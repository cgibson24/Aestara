// swift-tools-version: 6.2
// Media: Signed upload and download, checksum verification, the encrypted local media cache.
// Bible §6.6, §21.2. Tier: platform. Built from Layer 2. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "Media",
    platforms: [.iOS("26.0")],
    products: [.library(name: "Media", targets: ["Media"])],
    dependencies: [
        .package(path: "../CoreNetworking"),
        .package(path: "../CoreSecurity"),
    ],
    targets: [
        .target(name: "Media", dependencies: [.product(name: "CoreNetworking", package: "CoreNetworking"), .product(name: "CoreSecurity", package: "CoreSecurity")]),
    ]
)
