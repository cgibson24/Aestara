// Shared SwiftUI components (docs/DESIGN_SYSTEM.md §6, §8): buttons that say
// what they do, labelled fields, the view states every data view implements,
// and the privacy cover for the app switcher.
import SwiftUI

/// Primary and secondary actions, at least the 44-pt touch target (DESIGN_SYSTEM.md C1).
public struct DSButtonStyle: ButtonStyle {
    public enum Kind: Sendable { case primary, secondary, destructive }
    let kind: Kind
    @Environment(\.isEnabled) private var isEnabled

    public init(_ kind: Kind = .primary) { self.kind = kind }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(DSFont.headline)
            .frame(maxWidth: .infinity, minHeight: DSSize.controlHeight)
            .padding(.horizontal, DSSpacing.lg)
            .foregroundStyle(foreground)
            .background(background(pressed: configuration.isPressed), in: RoundedRectangle(cornerRadius: DSRadius.md))
            .overlay {
                if kind == .secondary {
                    RoundedRectangle(cornerRadius: DSRadius.md).stroke(DSColor.controlBorder, lineWidth: 1)
                }
            }
            .opacity(isEnabled ? 1 : 0.5)
            .contentShape(Rectangle())
    }

    private var foreground: Color {
        switch kind {
        case .primary, .destructive: DSColor.textOnAccent
        case .secondary: DSColor.textPrimary
        }
    }

    private func background(pressed: Bool) -> Color {
        switch kind {
        case .primary: pressed ? DSColor.accentPressed : DSColor.accent
        case .destructive: DSColor.danger
        case .secondary: DSColor.surface
        }
    }
}

/// A labelled text field; the label stays visible while typing (DESIGN_SYSTEM.md C4).
public struct DSTextField: View {
    let label: String
    @Binding var text: String
    let prompt: String?
    let isSecure: Bool
    let error: String?

    public init(_ label: String, text: Binding<String>, prompt: String? = nil, isSecure: Bool = false, error: String? = nil) {
        self.label = label
        self._text = text
        self.prompt = prompt
        self.isSecure = isSecure
        self.error = error
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text(label).font(DSFont.subheadline.weight(.semibold)).foregroundStyle(DSColor.textPrimary)
            Group {
                if isSecure {
                    SecureField(label, text: $text, prompt: prompt.map { Text($0) })
                } else {
                    TextField(label, text: $text, prompt: prompt.map { Text($0) })
                }
            }
            .font(DSFont.body)
            .padding(.horizontal, DSSpacing.md)
            .frame(minHeight: DSSize.controlHeight)
            .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.sm))
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.sm)
                    .stroke(error == nil ? DSColor.controlBorder : DSColor.danger, lineWidth: 1)
            )
            .accessibilityLabel(label)
            if let error {
                Text(error).font(DSFont.footnote).foregroundStyle(DSColor.danger)
            }
        }
    }
}

/// A message banner. Errors are announced to VoiceOver.
public struct DSBanner: View {
    public enum Tone: Sendable { case info, success, warning, danger }
    let tone: Tone
    let text: String

    public init(_ text: String, tone: Tone) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        Text(text)
            .font(DSFont.callout)
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(DSSpacing.md)
            .background(background, in: RoundedRectangle(cornerRadius: DSRadius.md))
            .accessibilityAddTraits(tone == .danger ? .isStaticText : [])
    }

    private var foreground: Color {
        switch tone {
        case .info: DSColor.info
        case .success: DSColor.success
        case .warning: DSColor.warning
        case .danger: DSColor.danger
        }
    }

    private var background: Color {
        switch tone {
        case .info: DSColor.infoSoft
        case .success: DSColor.successSoft
        case .warning: DSColor.warningSoft
        case .danger: DSColor.dangerSoft
        }
    }
}

/// The six view states of every data view (DESIGN_SYSTEM.md §6): normal is the
/// content itself; these are the other five.
public enum DSViewState: Equatable, Sendable {
    case loading(String)
    case empty(title: String, message: String)
    case error(message: String, reference: String?)
    case permissionDenied
    case offline
}

public struct DSStateView: View {
    let state: DSViewState
    let retry: (() -> Void)?

    public init(_ state: DSViewState, retry: (() -> Void)? = nil) {
        self.state = state
        self.retry = retry
    }

    public var body: some View {
        VStack(spacing: DSSpacing.md) {
            switch state {
            case let .loading(label):
                ProgressView()
                Text(label).font(DSFont.callout).foregroundStyle(DSColor.textSecondary)
            case let .empty(title, message):
                Text(title).font(DSFont.title3).foregroundStyle(DSColor.textPrimary)
                Text(message).font(DSFont.callout).foregroundStyle(DSColor.textSecondary)
            case let .error(message, reference):
                Image(systemName: "exclamationmark.triangle").font(DSFont.title2).foregroundStyle(DSColor.danger)
                    .accessibilityHidden(true)
                Text("This could not be loaded").font(DSFont.title3).foregroundStyle(DSColor.textPrimary)
                Text(message).font(DSFont.callout).foregroundStyle(DSColor.textSecondary)
                if let reference {
                    Text("Reference \(reference)").font(DSFont.caption1).foregroundStyle(DSColor.textTertiary)
                        .textSelection(.enabled)
                }
            case .permissionDenied:
                Image(systemName: "lock").font(DSFont.title2).foregroundStyle(DSColor.textSecondary)
                    .accessibilityHidden(true)
                Text("Not available for your role").font(DSFont.title3).foregroundStyle(DSColor.textPrimary)
                Text("Ask an administrator if you need access.").font(DSFont.callout)
                    .foregroundStyle(DSColor.textSecondary)
            case .offline:
                Image(systemName: "wifi.slash").font(DSFont.title2).foregroundStyle(DSColor.textSecondary)
                    .accessibilityHidden(true)
                Text("You are offline").font(DSFont.title3).foregroundStyle(DSColor.textPrimary)
                Text("Reconnect to continue.").font(DSFont.callout).foregroundStyle(DSColor.textSecondary)
            }
            if let retry, state != .permissionDenied, !isLoading {
                Button("Try again", action: retry).buttonStyle(DSButtonStyle(.secondary)).frame(maxWidth: 240)
            }
        }
        .multilineTextAlignment(.center)
        .padding(DSSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var isLoading: Bool {
        if case .loading = state { return true }
        return false
    }
}

/// A status badge. Its text is `caption1`: `caption2` keeps one size from the default text
/// size down, which the accessibility audit reports as partial Dynamic Type support.
public struct DSBadge: View {
    let text: String
    let color: Color
    let background: Color

    public init(_ text: String, color: Color = DSColor.textSecondary, background: Color = DSColor.surfaceSunken) {
        self.text = text
        self.color = color
        self.background = background
    }

    /// Wraps rather than cutting the word off at large text sizes. One line keeps the capsule's
    /// look (a corner radius is never more than half the height); more lines get round corners.
    public var body: some View {
        Text(text)
            .font(DSFont.caption1)
            .foregroundStyle(color)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, DSSpacing.sm)
            .padding(.vertical, DSSpacing.xxs)
            .background(background, in: RoundedRectangle(cornerRadius: DSRadius.lg))
    }
}

/// Covers the app while it is not active, so the app switcher never shows
/// patient data (docs/THREAT_MODEL.md; ADR-0022).
public struct PrivacyCover: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase

    public init() {}

    public func body(content: Content) -> some View {
        content.overlay {
            if scenePhase != .active {
                ZStack {
                    DSColor.canvas.ignoresSafeArea()
                    Text("Aestara").font(DSFont.largeTitle).foregroundStyle(DSColor.textPrimary)
                }
                .accessibilityHidden(true)
            }
        }
    }
}

extension View {
    /// Hides content behind the brand cover whenever the scene is not active.
    public func privacyCover() -> some View { modifier(PrivacyCover()) }
}
