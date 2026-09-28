// swift-tools-version: 6.2
// Telehealth: Virtual consultation sessions through the approved vendor SDK.
// Bible §16. Tier: feature. Built from Layer 6. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "Telehealth",
    platforms: [.iOS("26.0")],
    products: [.library(name: "Telehealth", targets: ["Telehealth"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../PatientDomain"),
    ],
    targets: [
        .target(name: "Telehealth", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "PatientDomain", package: "PatientDomain")]),
    ]
)
