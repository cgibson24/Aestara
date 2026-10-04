// swift-tools-version: 6.2
// BeforeAfter: Before/after comparison: side by side, slider, cross-fade, blink, overlay; display-only alignment.
// Bible §8. Tier: feature. Built from Layer 3. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "BeforeAfter",
    platforms: [.iOS("26.0")],
    products: [.library(name: "BeforeAfter", targets: ["BeforeAfter"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../CoreNetworking"),
        .package(path: "../Media"),
        .package(path: "../PatientDomain"),
    ],
    targets: [
        .target(name: "BeforeAfter", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "CoreNetworking", package: "CoreNetworking"), .product(name: "Media", package: "Media"), .product(name: "PatientDomain", package: "PatientDomain")]),
        .testTarget(name: "BeforeAfterTests", dependencies: ["BeforeAfter"]),
    ]
)
