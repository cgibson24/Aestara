import DesignSystem
import SwiftUI

/// Composition root of the provider app (Bible §24.4–24.5). It owns
/// navigation and wires the feature modules together.
///
/// Layer 0 shows the brand name only. Layer 1 replaces it with sign-in and the
/// adaptive navigation: sidebar on iPad, tab bar on iPhone
/// (docs/DESIGN_SYSTEM.md §4, docs/IOS_ARCHITECTURE.md).
public struct ProviderRootView: View {
    public init() {}

    public var body: some View {
        ZStack {
            DSColor.canvas.ignoresSafeArea()
            Text("Aestara")
                .font(DSFont.largeTitle)
                .foregroundStyle(DSColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
        }
    }
}
