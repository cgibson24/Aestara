// Generated from packages/design-tokens/tokens.json by scripts/build.mjs. Do not edit.
// Colours adapt to light/dark mode; fonts are system text styles so they scale with Dynamic Type.
import SwiftUI
import UIKit

public enum DSColor {
    public static let canvas = Color(light: 0xF5F4F1FF, dark: 0x0E1012FF)
    public static let surface = Color(light: 0xFFFFFFFF, dark: 0x16191CFF)
    public static let surfaceRaised = Color(light: 0xFFFFFFFF, dark: 0x1D2125FF)
    public static let surfaceSunken = Color(light: 0xECEAE5FF, dark: 0x0A0B0DFF)
    public static let border = Color(light: 0xDEDAD2FF, dark: 0x2A2F35FF)
    public static let controlBorder = Color(light: 0x8E877AFF, dark: 0x6E757EFF)
    public static let textPrimary = Color(light: 0x16181CFF, dark: 0xF1F0ECFF)
    public static let textSecondary = Color(light: 0x505762FF, dark: 0xAEB4BDFF)
    public static let textTertiary = Color(light: 0x666C77FF, dark: 0x959BA5FF)
    public static let textOnAccent = Color(light: 0xFFFFFFFF, dark: 0x0B1A19FF)
    public static let accent = Color(light: 0x1D5957FF, dark: 0x6BBDB6FF)
    public static let accentPressed = Color(light: 0x154442FF, dark: 0x57A39DFF)
    public static let accentSoft = Color(light: 0xE2EEEDFF, dark: 0x16312FFF)
    public static let accentText = Color(light: 0x1D5957FF, dark: 0x7CC9C2FF)
    public static let highlight = Color(light: 0x8C6A36FF, dark: 0xD2B37EFF)
    public static let success = Color(light: 0x1E6F44FF, dark: 0x5CC08AFF)
    public static let successSoft = Color(light: 0xE3F2EAFF, dark: 0x13291DFF)
    public static let warning = Color(light: 0x7D5200FF, dark: 0xE0B04FFF)
    public static let warningSoft = Color(light: 0xFBF0DAFF, dark: 0x2B2210FF)
    public static let danger = Color(light: 0xB42318FF, dark: 0xF2877CFF)
    public static let dangerSoft = Color(light: 0xFCE9E7FF, dark: 0x33171AFF)
    public static let info = Color(light: 0x255BA8FF, dark: 0x7DA7E6FF)
    public static let infoSoft = Color(light: 0xE5EDF8FF, dark: 0x152238FF)
    public static let simulation = Color(light: 0x5E4394FF, dark: 0xB49BE6FF)
    public static let simulationSoft = Color(light: 0xEEE9F7FF, dark: 0x241C35FF)
    public static let focusRing = Color(light: 0x2E6FB7FF, dark: 0x7DB6F0FF)
    public static let photoStage = Color(light: 0x0C0D0FFF, dark: 0x050607FF)
    public static let photoStageText = Color(light: 0xF2F1EEFF, dark: 0xF2F1EEFF)
    public static let scrim = Color(light: 0x0C0D0F8C, dark: 0x00000099)
}

public enum DSSpacing {
    public static let xxs: CGFloat = 2
    public static let xs: CGFloat = 4
    public static let sm: CGFloat = 8
    public static let md: CGFloat = 12
    public static let lg: CGFloat = 16
    public static let xl: CGFloat = 20
    public static let xxl: CGFloat = 24
    public static let xxxl: CGFloat = 32
    public static let section: CGFloat = 40
    public static let page: CGFloat = 48
}

public enum DSRadius {
    public static let sm: CGFloat = 6
    public static let md: CGFloat = 10
    public static let lg: CGFloat = 14
    public static let xl: CGFloat = 20
    public static let pill: CGFloat = 999
}

public enum DSSize {
    public static let touchTarget: CGFloat = 44
    public static let controlHeight: CGFloat = 44
    public static let controlHeightLarge: CGFloat = 52
    public static let iconSm: CGFloat = 16
    public static let iconMd: CGFloat = 20
    public static let iconLg: CGFloat = 24
    public static let sidebarWidth: CGFloat = 264
    public static let listPaneWidth: CGFloat = 340
    public static let tabBarHeight: CGFloat = 49
}

public enum DSFont {
    public static let largeTitle = Font.system(.largeTitle).weight(.bold)
    public static let title1 = Font.system(.title).weight(.bold)
    public static let title2 = Font.system(.title2).weight(.semibold)
    public static let title3 = Font.system(.title3).weight(.semibold)
    public static let headline = Font.system(.headline).weight(.semibold)
    public static let body = Font.system(.body).weight(.regular)
    public static let callout = Font.system(.callout).weight(.regular)
    public static let subheadline = Font.system(.subheadline).weight(.regular)
    public static let footnote = Font.system(.footnote).weight(.regular)
    public static let caption1 = Font.system(.caption).weight(.regular)
    public static let caption2 = Font.system(.caption2).weight(.medium)
}

public enum DSMotion {
    public static let fast: Double = 0.12
    public static let standard: Double = 0.2
    public static let slow: Double = 0.32
}

extension Color {
    /// Dynamic colour from 0xRRGGBBAA values for light and dark appearance.
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(rgba: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(rgba: UInt32) {
        self.init(
            red: CGFloat((rgba >> 24) & 0xFF) / 255,
            green: CGFloat((rgba >> 16) & 0xFF) / 255,
            blue: CGFloat((rgba >> 8) & 0xFF) / 255,
            alpha: CGFloat(rgba & 0xFF) / 255
        )
    }
}
