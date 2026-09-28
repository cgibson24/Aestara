// swift-tools-version: 6.2
// Simulation: AI visualization request, provider review, approve and separate release, with the mandatory disclaimer.
// Bible §9. Tier: feature. Built from Layer 8. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "Simulation",
    platforms: [.iOS("26.0")],
    products: [.library(name: "Simulation", targets: ["Simulation"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../Media"),
        .package(path: "../PatientDomain"),
        .package(path: "../ConsultationDomain"),
    ],
    targets: [
        .target(name: "Simulation", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "Media", package: "Media"), .product(name: "PatientDomain", package: "PatientDomain"), .product(name: "ConsultationDomain", package: "ConsultationDomain")]),
    ]
)
