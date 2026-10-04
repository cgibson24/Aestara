// swift-tools-version: 6.2
// Snapshot tests of the provider app's screens and components (ADR-0023 K2-21;
// ADR-0026 K3-22, F-68): swift-snapshot-testing (Point-Free, MIT), pinned
// exactly. CI records a missing reference into its job log; the references are
// reviewed and committed under Tests/ProviderSnapshotsTests/__Snapshots__.
// Not a module of the app: it depends on the modules it renders.
import PackageDescription

let package = Package(
    name: "ProviderSnapshots",
    platforms: [.iOS("26.0")],
    products: [.library(name: "ProviderSnapshots", targets: ["ProviderSnapshots"])],
    dependencies: [
        .package(path: "../Modules/DesignSystem"),
        .package(path: "../Modules/PatientDomain"),
        .package(path: "../Modules/ConsultationDomain"),
        .package(path: "../Modules/Photography"),
        .package(path: "../Modules/Annotations"),
        .package(path: "../Modules/BeforeAfter"),
        .package(path: "../Modules/DocumentsConsent"),
        .package(path: "../Modules/AppShell"),
        .package(url: "https://github.com/pointfreeco/swift-snapshot-testing", exact: "1.19.6"),
    ],
    targets: [
        .target(name: "ProviderSnapshots", dependencies: [.product(name: "DesignSystem", package: "DesignSystem")]),
        .testTarget(
            name: "ProviderSnapshotsTests",
            dependencies: [
                "ProviderSnapshots",
                .product(name: "DesignSystem", package: "DesignSystem"),
                .product(name: "PatientDomain", package: "PatientDomain"),
                .product(name: "ConsultationDomain", package: "ConsultationDomain"),
                .product(name: "Photography", package: "Photography"),
                .product(name: "Annotations", package: "Annotations"),
                .product(name: "BeforeAfter", package: "BeforeAfter"),
                .product(name: "DocumentsConsent", package: "DocumentsConsent"),
                .product(name: "AppShell", package: "AppShell"),
                .product(name: "SnapshotTesting", package: "swift-snapshot-testing"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ]
)
