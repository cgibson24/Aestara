// swift-tools-version: 6.2
// Education: Education content and care instructions assigned to patients.
// Bible §12.5. Tier: feature. Built from Layer 4. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "Education",
    platforms: [.iOS("26.0")],
    products: [.library(name: "Education", targets: ["Education"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../PatientDomain"),
    ],
    targets: [
        .target(name: "Education", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "PatientDomain", package: "PatientDomain")]),
    ]
)
