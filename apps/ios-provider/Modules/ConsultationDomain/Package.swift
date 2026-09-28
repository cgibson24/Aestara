// swift-tools-version: 6.2
// ConsultationDomain: Consultation lifecycle, notes and concerns, following the spec §5.4.1 state machine.
// Bible §5. Tier: domain. Built from Layer 3. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "ConsultationDomain",
    platforms: [.iOS("26.0")],
    products: [.library(name: "ConsultationDomain", targets: ["ConsultationDomain"])],
    dependencies: [
        .package(path: "../CoreNetworking"),
        .package(path: "../PatientDomain"),
    ],
    targets: [
        .target(name: "ConsultationDomain", dependencies: [.product(name: "CoreNetworking", package: "CoreNetworking"), .product(name: "PatientDomain", package: "PatientDomain")]),
    ]
)
