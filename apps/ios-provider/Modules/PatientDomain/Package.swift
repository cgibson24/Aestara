// swift-tools-version: 6.2
// PatientDomain: Patient models, search, create with duplicate check, the offline cache of recent patients.
// Bible §4, §23. Tier: domain. Built from Layer 1. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "PatientDomain",
    platforms: [.iOS("26.0")],
    products: [.library(name: "PatientDomain", targets: ["PatientDomain"])],
    dependencies: [
        .package(path: "../CoreNetworking"),
        .package(path: "../CoreSecurity"),
    ],
    targets: [
        .target(name: "PatientDomain", dependencies: [.product(name: "CoreNetworking", package: "CoreNetworking"), .product(name: "CoreSecurity", package: "CoreSecurity")]),
    ]
)
