import ProjectDescription

// Provider iPad/iPhone app (Bible §2, §24). Generated with Tuist:
//   cd apps/ios-provider && tuist generate
// The app target only hosts AppShell; everything else lives in the local
// Swift packages under Modules/ (one per Bible §24.4 module, modules.json).

let modules = [
    "DesignSystem", "CoreSecurity", "CoreNetworking", "AuditSupport",
    "Authentication", "Media",
    "PatientDomain", "ConsultationDomain",
    "Photography", "Annotations", "BeforeAfter", "Simulation", "TreatmentPlans",
    "DocumentsConsent", "Education", "Appointments", "Messaging", "Telehealth", "Settings",
    "AppShell",
]

let project = Project(
    name: "AestaraProvider",
    organizationName: "Aestara",
    packages: modules.map { .local(path: .relativeToManifest("Modules/\($0)")) },
    settings: .settings(base: [
        "SWIFT_VERSION": "6.0",
        "SWIFT_STRICT_CONCURRENCY": "complete",
    ]),
    targets: [
        .target(
            name: "AestaraProvider",
            destinations: [.iPhone, .iPad],
            product: .app,
            // Bundle identifier prefix is an open decision (UD-34); change it before the first TestFlight build.
            bundleId: "com.aestara.provider",
            deploymentTargets: .iOS("26.0"),
            infoPlist: .extendingDefault(with: [
                "CFBundleDisplayName": "Aestara",
                "UILaunchScreen": ["UIColorName": ""],
                "UIApplicationSceneManifest": [
                    "UIApplicationSupportsMultipleScenes": true,
                ],
                "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"],
                "UISupportedInterfaceOrientations~ipad": [
                    "UIInterfaceOrientationLandscapeLeft",
                    "UIInterfaceOrientationLandscapeRight",
                    "UIInterfaceOrientationPortrait",
                    "UIInterfaceOrientationPortraitUpsideDown",
                ],
                "ITSAppUsesNonExemptEncryption": false,
            ]),
            sources: ["Sources/**"],
            dependencies: [.package(product: "AppShell")]
        ),
    ]
)
