// swift-tools-version: 6.2
// TreatmentPlans: Plans A/B/C, estimates and procedure tracking.
// Bible §11. Tier: feature. Built from Layer 4. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "TreatmentPlans",
    platforms: [.iOS("26.0")],
    products: [.library(name: "TreatmentPlans", targets: ["TreatmentPlans"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../PatientDomain"),
        .package(path: "../ConsultationDomain"),
    ],
    targets: [
        .target(name: "TreatmentPlans", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "PatientDomain", package: "PatientDomain"), .product(name: "ConsultationDomain", package: "ConsultationDomain")]),
    ]
)
