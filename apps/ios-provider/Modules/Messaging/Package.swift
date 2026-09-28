// swift-tools-version: 6.2
// Messaging: Secure patient messaging with attachments; no PHI in notifications.
// Bible §14. Tier: feature. Built from Layer 5. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "Messaging",
    platforms: [.iOS("26.0")],
    products: [.library(name: "Messaging", targets: ["Messaging"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../PatientDomain"),
        .package(path: "../Media"),
    ],
    targets: [
        .target(name: "Messaging", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "PatientDomain", package: "PatientDomain"), .product(name: "Media", package: "Media")]),
    ]
)
