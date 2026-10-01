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
    settings: .settings(
        base: [
            "SWIFT_VERSION": "6.0",
            "SWIFT_STRICT_CONCURRENCY": "complete",
        ],
        // The API address per build (ADR-0022). Release has none until the
        // domain names are decided (F-32, UD-34); such a build says so and stops.
        configurations: [
            .debug(name: "Debug", settings: ["AESTARA_API_BASE_URL": "http://localhost:3000"]),
            .release(name: "Release", settings: ["AESTARA_API_BASE_URL": ""]),
        ]
    ),
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
                "AestaraAPIBaseURL": "$(AESTARA_API_BASE_URL)",
                // Face ID guards the saved sign-in (spec §4.2).
                "NSFaceIDUsageDescription": "Face ID unlocks Aestara and keeps patient information private.",
                // Only local names (localhost, .local) may use plain HTTP, for a development server.
                "NSAppTransportSecurity": ["NSAllowsLocalNetworking": true],
            ]),
            sources: ["Sources/**"],
            dependencies: [.package(product: "AppShell")]
        ),
    ]
)
