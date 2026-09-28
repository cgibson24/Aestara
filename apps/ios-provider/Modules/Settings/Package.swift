// swift-tools-version: 6.2
// Settings: Account, security and device settings.
// Bible §17, §21.1. Tier: feature. Built from Layer 1. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "Settings",
    platforms: [.iOS("26.0")],
    products: [.library(name: "Settings", targets: ["Settings"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../Authentication"),
    ],
    targets: [
        .target(name: "Settings", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "Authentication", package: "Authentication")]),
    ]
)
