import DesignSystem
import SwiftUI

@main
struct AestaraPatientApp: App {
    var body: some Scene {
        WindowGroup {
            PatientRootView()
        }
    }
}

/// Root of the patient app. Layer 0 shows the brand name only; Layer 5 adds
/// sign-in and the patient tabs, showing only content the practice has
/// explicitly released (Bible §13.2).
struct PatientRootView: View {
    var body: some View {
        ZStack {
            DSColor.canvas.ignoresSafeArea()
            Text("Aestara")
                .font(DSFont.largeTitle)
                .foregroundStyle(DSColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
        }
    }
}
