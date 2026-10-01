// swift-tools-version: 6.2
// CoreNetworking: API client generated from packages/api-contracts/openapi.json, request correlation, idempotency keys, error-envelope handling.
// Bible §20. Tier: foundation. Built from Layer 1. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "CoreNetworking",
    platforms: [.iOS("26.0")],
    products: [.library(name: "CoreNetworking", targets: ["CoreNetworking"])],
    dependencies: [
        // Apple's OpenAPI generator, runtime and URLSession transport (spec §2.2, §6.8), pinned exactly.
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.13.1"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.12.2"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", exact: "1.3.2"),
    ],
    targets: [
        .target(
            name: "CoreNetworking",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
            ],
            plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
        ),
        .testTarget(name: "CoreNetworkingTests", dependencies: ["CoreNetworking"]),
    ]
)
