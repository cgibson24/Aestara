import ProjectDescription

// Patient iPhone app (Bible §13). Generated with Tuist:
//   cd apps/ios-patient && tuist generate
// Reuses the provider app's DesignSystem, CoreNetworking and CoreSecurity
// modules (spec §2.2); it may not depend on any other provider module
// (checked by apps/ios-provider/scripts/check_module_graph.py).

let sharedModules = ["DesignSystem", "CoreNetworking", "CoreSecurity"]

let project = Project(
    name: "AestaraPatient",
    organizationName: "Aestara",
    packages: sharedModules.map { .local(path: .relativeToManifest("../ios-provider/Modules/\($0)")) },
    settings: .settings(base: [
        "SWIFT_VERSION": "6.0",
        "SWIFT_STRICT_CONCURRENCY": "complete",
    ]),
    targets: [
        .target(
            name: "AestaraPatient",
            destinations: [.iPhone],
            product: .app,
            // Bundle identifier prefix is an open decision (UD-34); change it before the first TestFlight build.
            bundleId: "com.aestara.patient",
            deploymentTargets: .iOS("26.0"),
            infoPlist: .extendingDefault(with: [
                "CFBundleDisplayName": "Aestara",
                "UILaunchScreen": ["UIColorName": ""],
                "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"],
                "ITSAppUsesNonExemptEncryption": false,
            ]),
            sources: ["Sources/**"],
            dependencies: sharedModules.map { .package(product: $0) }
        ),
    ]
)
