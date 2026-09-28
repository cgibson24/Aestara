// swift-tools-version: 6.2
// Photography: Guided clinical capture: protocols, live guidance, ghost overlay, capture review, offline upload queue.
// Bible §6. Tier: feature. Built from Layer 2. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "Photography",
    platforms: [.iOS("26.0")],
    products: [.library(name: "Photography", targets: ["Photography"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../Media"),
        .package(path: "../PatientDomain"),
        .package(path: "../AuditSupport"),
    ],
    targets: [
        .target(name: "Photography", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "Media", package: "Media"), .product(name: "PatientDomain", package: "PatientDomain"), .product(name: "AuditSupport", package: "AuditSupport")]),
    ]
)
