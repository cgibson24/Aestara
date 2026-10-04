// swift-tools-version: 6.2
// DocumentsConsent: Consent assignment and signing, including staff-assisted in-clinic signing mode, and documents.
// Bible §12. Tier: feature. Built from Layer 3 (documents; consent in Layer 4). Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "DocumentsConsent",
    platforms: [.iOS("26.0")],
    products: [.library(name: "DocumentsConsent", targets: ["DocumentsConsent"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../PatientDomain"),
        .package(path: "../CoreSecurity"),
    ],
    targets: [
        .target(name: "DocumentsConsent", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "PatientDomain", package: "PatientDomain"), .product(name: "CoreSecurity", package: "CoreSecurity")]),
    ]
)
