// swift-tools-version: 6.2
// AuditSupport: Client audit context and the offline audit replay queue.
// Bible §22, §23.3. Tier: foundation. Built from Layer 2. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "AuditSupport",
    platforms: [.iOS("26.0")],
    products: [.library(name: "AuditSupport", targets: ["AuditSupport"])],
    dependencies: [
        .package(path: "../CoreNetworking"),
        .package(path: "../CoreSecurity"),
    ],
    targets: [
        .target(name: "AuditSupport", dependencies: [.product(name: "CoreNetworking", package: "CoreNetworking"), .product(name: "CoreSecurity", package: "CoreSecurity")]),
        .testTarget(name: "AuditSupportTests", dependencies: ["AuditSupport", .product(name: "CoreNetworking", package: "CoreNetworking"), .product(name: "CoreSecurity", package: "CoreSecurity")]),
    ]
)
