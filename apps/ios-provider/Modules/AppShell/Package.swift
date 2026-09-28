// swift-tools-version: 6.2
// AppShell: Composition root: adaptive navigation (iPad sidebar, iPhone tabs), routing, deep links that re-run authorization.
// Bible §24.4–24.5. Tier: app. Built from Layer 1. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "AppShell",
    platforms: [.iOS("26.0")],
    products: [.library(name: "AppShell", targets: ["AppShell"])],
    dependencies: [
        .package(path: "../DesignSystem"),
        .package(path: "../Authentication"),
        .package(path: "../Photography"),
        .package(path: "../Annotations"),
        .package(path: "../BeforeAfter"),
        .package(path: "../Simulation"),
        .package(path: "../TreatmentPlans"),
        .package(path: "../DocumentsConsent"),
        .package(path: "../Education"),
        .package(path: "../Appointments"),
        .package(path: "../Messaging"),
        .package(path: "../Telehealth"),
        .package(path: "../Settings"),
    ],
    targets: [
        .target(name: "AppShell", dependencies: [.product(name: "DesignSystem", package: "DesignSystem"), .product(name: "Authentication", package: "Authentication"), .product(name: "Photography", package: "Photography"), .product(name: "Annotations", package: "Annotations"), .product(name: "BeforeAfter", package: "BeforeAfter"), .product(name: "Simulation", package: "Simulation"), .product(name: "TreatmentPlans", package: "TreatmentPlans"), .product(name: "DocumentsConsent", package: "DocumentsConsent"), .product(name: "Education", package: "Education"), .product(name: "Appointments", package: "Appointments"), .product(name: "Messaging", package: "Messaging"), .product(name: "Telehealth", package: "Telehealth"), .product(name: "Settings", package: "Settings")]),
    ]
)
