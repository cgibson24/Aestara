import DesignSystem
import SwiftUI
import Testing
import UIKit

@Suite("Design tokens (packages/design-tokens → DesignTokens.swift)")
struct DesignTokenTests {
    @Test("Every control meets the 44-pt touch target (DESIGN_SYSTEM.md C1)")
    func touchTargets() {
        #expect(DSSize.touchTarget >= 44)
        #expect(DSSize.controlHeight >= DSSize.touchTarget)
        #expect(DSSize.controlHeightLarge >= DSSize.controlHeight)
    }

    @Test("Spacing and radius scales only grow")
    func scalesAreOrdered() {
        let spacing = [
            DSSpacing.xxs, DSSpacing.xs, DSSpacing.sm, DSSpacing.md, DSSpacing.lg,
            DSSpacing.xl, DSSpacing.xxl, DSSpacing.xxxl, DSSpacing.section, DSSpacing.page,
        ]
        #expect(spacing == spacing.sorted())
        let radius = [DSRadius.sm, DSRadius.md, DSRadius.lg, DSRadius.xl, DSRadius.pill]
        #expect(radius == radius.sorted())
    }

    @Test("Colour roles adapt to light and dark appearance")
    @MainActor
    func coloursAreDynamic() {
        for role in [DSColor.canvas, DSColor.surface, DSColor.textPrimary, DSColor.accent] {
            let dynamic = UIColor(role)
            let light = dynamic.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light))
            let dark = dynamic.resolvedColor(with: UITraitCollection(userInterfaceStyle: .dark))
            #expect(light != dark)
        }
    }

    @Test("AI content has its own colour, distinct from the accent (DESIGN_SYSTEM.md §3)")
    @MainActor
    func simulationColourIsDistinct() {
        let traits = UITraitCollection(userInterfaceStyle: .light)
        let simulation = UIColor(DSColor.simulation).resolvedColor(with: traits)
        let accent = UIColor(DSColor.accent).resolvedColor(with: traits)
        #expect(simulation != accent)
    }
}
