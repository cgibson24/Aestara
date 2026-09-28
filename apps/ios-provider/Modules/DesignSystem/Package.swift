// swift-tools-version: 6.2
// DesignSystem: Design tokens (generated from packages/design-tokens) and the shared SwiftUI components: buttons, cards, lists, badges, states.
// Bible §24.1–24.2. Tier: foundation. Built from Layer 0. Allowed dependencies: see modules.json.
import PackageDescription

let package = Package(
    name: "DesignSystem",
    platforms: [.iOS("26.0")],
    products: [.library(name: "DesignSystem", targets: ["DesignSystem"])],
    targets: [
        .target(name: "DesignSystem"),
        .testTarget(name: "DesignSystemTests", dependencies: ["DesignSystem"]),
    ]
)
