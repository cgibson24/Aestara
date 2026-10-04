// Diagnosis of F-70 (ADR-0025, ADR-0027): in Debug builds a screen can record
// in the device log when it appears and disappears, with a number that is new
// whenever SwiftUI builds the screen again, so a UI test's device log shows a
// screen that is rebuilt. Only screen names and state words are logged, never
// data. Release builds log nothing.
import SwiftUI
#if DEBUG
import os
#endif

public enum DSTrace {
    #if DEBUG
    static let log = Logger(subsystem: "com.aestara.provider", category: "lifecycle")
    #endif

    /// A fixed word about a screen's state, such as "editing on" (Debug builds only).
    public static func note(_ text: StaticString) {
        #if DEBUG
        log.notice("\(String(describing: text), privacy: .public)")
        #endif
    }
}

extension View {
    /// Records the view appearing and disappearing in the device log (Debug builds only).
    public func traceLifecycle(_ name: StaticString) -> some View {
        modifier(LifecycleTraceModifier(name: String(describing: name)))
    }
}

private struct LifecycleTraceModifier: ViewModifier {
    let name: String
    /// New whenever SwiftUI builds the view again; kept while it stays the same view.
    @State private var instance = UInt16.random(in: 1...UInt16.max)

    func body(content: Content) -> some View {
        #if DEBUG
        content
            .onAppear { DSTrace.log.notice("\(name, privacy: .public) #\(instance, privacy: .public) appeared") }
            .onDisappear { DSTrace.log.notice("\(name, privacy: .public) #\(instance, privacy: .public) disappeared") }
        #else
        content
        #endif
    }
}
