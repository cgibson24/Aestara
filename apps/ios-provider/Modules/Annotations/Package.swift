// swift-tools-version: 6.2
// Annotations: Annotation layers drawn over photos, stored separately from the immutable original.
// Bible §6.6. Tier: feature. Built from Layer 3. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "Annotations",
    platforms: [.iOS("26.0")],
    products: [.library(name: "Annotations", targets: ["Annotations"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../Media"),
    ],
    targets: [
        .target(name: "Annotations", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "Media", package: "Media")]),
    ]
)
