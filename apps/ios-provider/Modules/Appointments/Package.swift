// swift-tools-version: 6.2
// Appointments: Schedule and appointment lifecycle.
// Bible §15. Tier: feature. Built from Layer 6. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "Appointments",
    platforms: [.iOS("26.0")],
    products: [.library(name: "Appointments", targets: ["Appointments"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../PatientDomain"),
    ],
    targets: [
        .target(name: "Appointments", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "PatientDomain", package: "PatientDomain")]),
    ]
)
