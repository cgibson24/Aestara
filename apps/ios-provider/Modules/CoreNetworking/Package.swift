// swift-tools-version: 6.2
// CoreNetworking: API client generated from packages/api-contracts/openapi.json, request correlation, idempotency keys, error-envelope handling.
// Bible §20. Tier: foundation. Built from Layer 1. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "CoreNetworking",
    platforms: [.iOS("26.0")],
    products: [.library(name: "CoreNetworking", targets: ["CoreNetworking"])],
    targets: [
        .target(name: "CoreNetworking"),
    ]
)
