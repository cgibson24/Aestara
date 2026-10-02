// End-to-end UI tests of the provider app against the real api, worker,
// image-processing and AWS emulator (Bible §32 #9, #12, #13; Layer 2 exit:
// a standard photo session end to end; docs/TESTING_STRATEGY.md §18.1). CI
// starts them with services/api/scripts/local-stack.ts, which prepares one
// clinician per device, and passes the sign-in through TEST_RUNNER_* variables:
// UITEST_EMAIL, UITEST_PASSWORD, UITEST_TOTP_SECRET, UITEST_TOTP_LAST_STEP.
// The simulator has no camera: the Debug-only synthetic frame source stands in
// (ADR-0023 K2-12). All data is synthetic.
import CryptoKit
import UIKit
import XCTest

@MainActor
final class ProviderFlowTests: XCTestCase {
    func testSignInCreateAPatientRunAPhotoSessionAndSearch() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-AestaraSyntheticCamera", "YES"]
        let env = ProcessInfo.processInfo.environment
        let email = try XCTUnwrap(env["UITEST_EMAIL"], "UITEST_EMAIL is not set")
        let password = try XCTUnwrap(env["UITEST_PASSWORD"], "UITEST_PASSWORD is not set")
        let secret = try XCTUnwrap(env["UITEST_TOTP_SECRET"], "UITEST_TOTP_SECRET is not set")
        let lastStep = try XCTUnwrap(Int(env["UITEST_TOTP_LAST_STEP"] ?? ""), "UITEST_TOTP_LAST_STEP is not set")
        app.launch()

        // Login UI: a wrong password shows the server's message.
        let emailField = app.textFields["signin.email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 60), "The sign-in screen did not appear. Screen: \(screen(app))")
        snapshot(app, "01 Sign in")
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields["signin.password"]
        passwordField.tap()
        let wrong = "not the right one"
        passwordField.typeText(wrong)
        app.buttons["signin.submit"].tap()
        XCTAssertTrue(
            element(in: app, containing: "incorrect").waitForExistence(timeout: 15),
            "A wrong password did not show an error. Screen: \(screen(app))"
        )
        passwordField.tap()
        passwordField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: wrong.count))
        passwordField.typeText(password)
        app.buttons["signin.submit"].tap()

        // Second factor.
        let codeField = app.textFields["mfa.code"]
        XCTAssertTrue(codeField.waitForExistence(timeout: 15), "The code screen did not appear. Screen: \(screen(app))")
        codeField.tap()
        codeField.typeText(TOTP.nextCode(secret: secret, after: lastStep))
        app.buttons["mfa.verify"].tap()

        // Signed in: create a patient (duplicate check first).
        let newPatient = app.buttons["patients.new"]
        XCTAssertTrue(newPatient.waitForExistence(timeout: 20), "The patient list did not appear. Screen: \(screen(app))")
        snapshot(app, "02 Patients")
        newPatient.tap()
        // Each run (each device) gets its own synthetic person, so the duplicate check, which
        // matches the same date of birth with a similar name, never links two test runs.
        let letters = { (count: Int) in String((0..<count).map { _ in "abcdefghijklmnopqrstuvwxyz".randomElement()! }) }
        let givenName = "Ana" + letters(5)
        let lastName = "Quill" + letters(6)
        let birthYear = String(Int.random(in: 1940...1999))
        let firstName = app.textFields["patient.firstName"]
        XCTAssertTrue(firstName.waitForExistence(timeout: 10), "The new-patient form did not appear. Screen: \(screen(app))")
        firstName.tap()
        firstName.typeText(givenName)
        let lastNameField = app.textFields["patient.lastName"]
        lastNameField.tap()
        lastNameField.typeText(lastName)
        // Date of birth: month, day, year wheels (en_US).
        let year = app.pickerWheels.element(boundBy: 2)
        XCTAssertTrue(year.waitForExistence(timeout: 5), "The date-of-birth picker did not appear. Screen: \(screen(app))")
        year.adjust(toPickerWheelValue: birthYear)
        let create = app.buttons["patient.create"]
        XCTAssertTrue(waitUntil(timeout: 5) { create.isEnabled }, "Create stayed disabled. Screen: \(screen(app))")
        snapshot(app, "03 New patient")
        create.tap()

        // The profile shell opens with all twelve tabs.
        let photos = app.buttons["profile.tab.PHOTOS"]
        XCTAssertTrue(photos.waitForExistence(timeout: 30),
                      "The new patient's profile did not open. Hierarchy: \(app.debugDescription.prefix(8_000))")
        snapshot(app, "04 Patient profile")
        XCTAssertTrue(element(in: app, containing: lastName).exists, "The profile header does not name the patient. Screen: \(screen(app))")
        for tab in ["OVERVIEW", "TIMELINE", "CONSULTATIONS", "PHOTOS", "BEFORE_AFTER", "SIMULATIONS",
                    "TREATMENT_PLANS", "PROCEDURES", "DOCUMENTS", "INSTRUCTIONS", "APPOINTMENTS", "MESSAGES"] {
            XCTAssertTrue(app.buttons["profile.tab.\(tab)"].exists, "Tab \(tab) is missing. Screen: \(screen(app))")
        }
        // The tab strip scrolls sideways on narrow screens: drag it (no momentum) until Photos is on
        // screen. Frames are known even off screen; hittability is not, so this compares frames.
        let window = app.windows.firstMatch.frame
        let onScreen = { (element: XCUIElement) in window.contains(element.frame) }
        let tabs = ["OVERVIEW", "TIMELINE", "CONSULTATIONS", "PHOTOS"].map { app.buttons["profile.tab.\($0)"] }
        for _ in 0..<6 where !onScreen(photos) {
            guard let handle = tabs.first(where: onScreen) else { break }
            let start = handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: -150, dy: 0)))
        }
        XCTAssertTrue(onScreen(photos), "The Photos tab cannot be reached. Screen: \(screen(app))")
        photos.tap()
        XCTAssertTrue(element(in: app, containing: "no clinical photos").waitForExistence(timeout: 30), "Photos empty state. Screen: \(screen(app))")
        snapshot(app, "05 Photos tab, empty")

        try photoSession(app)

        // Search finds the patient by name prefix.
        // On iPhone the profile covers the list: go back. On iPad the list stays beside it.
        let searchVisible = app.searchFields.firstMatch.exists && onScreen(app.searchFields.firstMatch)
        if !searchVisible, app.navigationBars.buttons.firstMatch.exists {
            app.navigationBars.buttons.firstMatch.tap()
        }
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10), "The search field did not appear. Screen: \(screen(app))")
        search.tap()
        search.typeText(String(lastName.prefix(8)))
        // The result row is in the list (a collection view), not the profile header.
        let row = app.collectionViews.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", lastName)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "Search did not find the patient. Screen: \(screen(app))")
    }

    /// Layer 2 exit (roadmap M2.11): the standard Face protocol, every view captured with
    /// guidance, uploaded, the session completed, thumbnails shown, a tag and a permission.
    private func photoSession(_ app: XCUIApplication) throws {
        let start = app.buttons["photos.startSession"]
        XCTAssertTrue(start.waitForExistence(timeout: 10), "No way to start a photo session. Screen: \(screen(app))")
        start.tap()
        let face = app.buttons["session.protocol.Face"]
        XCTAssertTrue(face.waitForExistence(timeout: 15), "The Face protocol is not offered. Screen: \(screen(app))")
        snapshot(app, "06 Choose a protocol")
        face.tap()

        let remaining = app.staticTexts["session.remaining"]
        XCTAssertTrue(remaining.waitForExistence(timeout: 15), "The session did not open. Screen: \(screen(app))")
        XCTAssertEqual(remaining.label, "5 required views left")
        snapshot(app, "07 Photo session")
        app.buttons["session.captureNext"].tap()

        // Guided capture: one instruction at a time; the shutter never blocks on it.
        let shutter = app.buttons["capture.shutter"]
        let guidance = app.descendants(matching: .any).matching(identifier: "capture.guidance").firstMatch
        XCTAssertTrue(shutter.waitForExistence(timeout: 20), "The camera did not open. Screen: \(screen(app))")
        XCTAssertTrue(app.staticTexts["capture.noReference"].waitForExistence(timeout: 15),
                      "A first session has no reference photo. Screen: \(screen(app))")
        var audited = false
        for view in ["FRONT", "LEFT_45", "RIGHT_45", "LEFT_PROFILE", "RIGHT_PROFILE"] {
            let item = app.buttons["capture.view.\(view)"]
            XCTAssertTrue(waitUntil(timeout: 10) { item.exists && item.isSelected }, "View \(view) is not current. Screen: \(screen(app))")
            XCTAssertTrue(waitUntil(timeout: 20) { guidance.exists && guidance.label.contains("Hold still") },
                          "Guidance never settled for \(view). Screen: \(screen(app))")
            if !audited {
                snapshot(app, "08 Guided capture")
                audit(app, screen: "capture")
                audited = true
            }
            XCTAssertTrue(waitUntil(timeout: 10) { shutter.isEnabled }, "The shutter stayed disabled. Screen: \(screen(app))")
            shutter.tap()
            let accept = app.buttons["capture.accept"]
            XCTAssertTrue(accept.waitForExistence(timeout: 20), "No review after capture. Screen: \(screen(app))")
            if view == "FRONT" { snapshot(app, "09 Review") }
            XCTAssertTrue(element(in: app, containing: "Camera level").exists, "The review lists no checks. Screen: \(screen(app))")
            accept.tap()
            // The photo is saved on the device before the next view opens.
            XCTAssertTrue(waitUntil(timeout: 30) { !accept.exists }, "The review did not close after Accept. Screen: \(screen(app))")
        }

        // Every required view is in; complete once the photos have reached the server.
        XCTAssertTrue(waitUntil(timeout: 20) { remaining.exists && remaining.label == "Every required view is captured" },
                      "The session does not count the photos. Screen: \(screen(app))")
        snapshot(app, "10 Every view captured")
        let complete = app.buttons["session.complete"]
        XCTAssertTrue(waitUntil(timeout: 120) {
            if !complete.exists { return true }
            if complete.isEnabled { complete.tap() }
            RunLoop.current.run(until: Date().addingTimeInterval(3))
            return !complete.exists
        }, "The session could not be completed. Screen: \(screen(app))")

        // The gallery: thumbnails from image-processing replace the "being checked" states,
        // for every view, so the audit sees a settled screen.
        let tile = app.buttons["photos.tile.FRONT"]
        XCTAssertTrue(tile.waitForExistence(timeout: 30), "The captured photo is not in the gallery. Screen: \(screen(app))")
        for view in ["FRONT", "LEFT_45", "RIGHT_45", "LEFT_PROFILE", "RIGHT_PROFILE"] {
            let photo = app.buttons["photos.tile.\(view)"]
            XCTAssertTrue(waitUntil(timeout: 180) {
                let label = photo.label
                return photo.exists && !label.contains("Being checked") && !label.contains("Preparing preview")
                    && !label.contains("could not be checked")
            }, "The \(view) thumbnail never arrived: \(photo.label). Screen: \(screen(app))")
        }
        snapshot(app, "11 Gallery")
        audit(app, screen: "gallery")

        // One photo: its preview and a tag.
        tile.tap()
        let tagField = app.textFields["photo.tagField"]
        XCTAssertTrue(tagField.waitForExistence(timeout: 20), "The photo did not open. Screen: \(screen(app))")
        tagField.tap()
        tagField.typeText("Baseline")
        app.buttons["photo.addTag"].tap()
        XCTAssertTrue(app.staticTexts["baseline"].waitForExistence(timeout: 15), "The tag was not saved. Screen: \(screen(app))")
        snapshot(app, "12 Photo with a tag")
        app.navigationBars.buttons["Close"].tap()

        // Media permissions: requested, then granted by staff attestation.
        let permissions = app.buttons["photos.permissions"]
        XCTAssertTrue(permissions.waitForExistence(timeout: 10), "No media permissions. Screen: \(screen(app))")
        permissions.tap()
        let website = app.buttons["permissions.category.WEBSITE"]
        XCTAssertTrue(website.waitForExistence(timeout: 15), "The permission list did not load. Screen: \(screen(app))")
        snapshot(app, "13 Media permissions")
        audit(app, screen: "permissions",
              sheet: [app.navigationBars["Media permissions"], app.collectionViews["permissions.list"]])
        website.tap()
        let save = app.buttons["permission.save"]
        XCTAssertTrue(save.waitForExistence(timeout: 10), "The change sheet did not open. Screen: \(screen(app))")
        XCTAssertTrue(waitUntil(timeout: 5) { save.isEnabled }, "Requested was not preselected. Screen: \(screen(app))")
        save.tap()
        XCTAssertTrue(waitUntil(timeout: 15) { website.exists && website.label.contains("Requested") },
                      "The request was not recorded. Screen: \(screen(app))")
        website.tap()
        XCTAssertTrue(save.waitForExistence(timeout: 10), "The change sheet did not open again. Screen: \(screen(app))")
        app.buttons["permission.change"].firstMatch.tap()
        let granted = app.buttons["Granted"].firstMatch
        XCTAssertTrue(granted.waitForExistence(timeout: 5), "Granted is not offered after a request. Screen: \(screen(app))")
        snapshot(app, "14 Record a grant")
        granted.tap()
        // The menu closes before Save is pressed; a tap while it closes only closes it.
        XCTAssertTrue(waitUntil(timeout: 10) { !granted.exists && save.isHittable && save.isEnabled },
                      "The choice menu did not close. Screen: \(screen(app))")
        save.tap()
        XCTAssertTrue(waitUntil(timeout: 15) { website.exists && website.label.contains("Granted") },
                      "The grant was not recorded. Screen: \(screen(app))")
        app.navigationBars.buttons["Close"].tap()
    }

    /// A screenshot kept with the results even when the test passes; CI exports them
    /// for review. The data on screen is synthetic.
    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// The XCUITest accessibility audit (ADR-0023 K2-21). Each finding fails the test
    /// with the screen, the element (identifier, label and frame) and the audit's
    /// explanation, and keeps a picture of the element; the flow continues so one run
    /// reports them all. The checks that change the text size run last, so their
    /// re-layout cannot disturb the pixel checks (contrast among them). Left out:
    /// - the synthetic camera's caption, Debug-only scaffolding;
    /// - the clipping, contrast or hit area of an element partly past the visible area,
    ///   which the audit judges by its visible part only: scrolled past the screen's or
    ///   the sheet's edge (the capture screen's view strip, the profile's tab strip, a
    ///   sheet's list; DESIGN_SYSTEM.md §4) or under the tab bar at the bottom, which
    ///   shows it through the bar's edge effect;
    /// - Dynamic Type on the system bars' own buttons and titles, which the system draws
    ///   at a fixed size and enlarges with the Large Content Viewer instead. The app draws
    ///   no UIKit labels, so a UIKit label the audit cannot resolve is one of those titles;
    /// - clipping in the system search field, a single-line field the system draws, whose
    ///   text scrolls;
    /// - in a sheet, findings without an element: the screen dimmed behind the sheet, which
    ///   the system hides from assistive technologies while the sheet is up.
    /// A contrast finding is confirmed on the element's own pixels: it fails when the
    /// measured WCAG ratio is below AA's 4.5:1. On iPad the audit flags text measured at 7:1
    /// and more, and different elements on identical screens; those it does not confirm
    /// are kept with the results, not failed.
    /// `sheet` names the parts of a presented sheet (its bar and its content), whose union
    /// is then the visible area.
    private func audit(_ app: XCUIApplication, screen name: String, sheet: [XCUIElement] = []) {
        let previous = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = previous }
        let window = app.windows.firstMatch.frame
        let tabBar = app.tabBars.firstMatch
        let bottomBar = sheet.isEmpty && tabBar.exists && tabBar.isHittable && tabBar.frame.minY > window.midY ? tabBar : nil
        // Every part of the sheet must be found, or the visible area would be too small.
        let sheetFound = sheet.allSatisfy(\.exists)
        XCTAssertTrue(sheetFound, "The \(name) sheet's parts were not all found. Screen: \(screen(app))")
        let sheetParts = sheetFound ? sheet.map(\.frame) : []
        let visible = sheetParts.isEmpty
            ? bottomBar.map {
                CGRect(x: window.minX, y: window.minY, width: window.width, height: $0.frame.minY - window.minY)
            } ?? window
            : sheetParts.dropFirst().reduce(sheetParts[0]) { $0.union($1) }
        let barItems = bottomBar?.buttons.allElementsBoundByIndex.map(\.frame) ?? []
        let navigationBars = app.navigationBars.allElementsBoundByIndex.map(\.frame)
        let edgeTypes: XCUIAccessibilityAuditType = [.textClipped, .contrast, .hitRegion]
        let sizeTypes: XCUIAccessibilityAuditType = [.dynamicType, .textClipped]
        let findings = AuditFindings()
        for types in [XCUIAccessibilityAuditType.all.subtracting(sizeTypes), sizeTypes] {
            do {
                try app.performAccessibilityAudit(for: types) { issue in
                    guard let element = issue.element else {
                        if !sheet.isEmpty { return true }
                        if issue.auditType == .dynamicType, issue.detailedDescription.contains("UILabel") { return true }
                        findings.items.append("\(issue.compactDescription): \(issue.detailedDescription) (no element)")
                        return true
                    }
                    if element.label == "Synthetic camera" { return true }
                    let frame = element.frame
                    if edgeTypes.contains(issue.auditType), !visible.contains(frame), !barItems.contains(frame) { return true }
                    if issue.auditType == .dynamicType, element.elementType == .button,
                       navigationBars.contains(where: { $0.contains(frame) }) { return true }
                    if issue.auditType == .textClipped, element.elementType == .searchField { return true }
                    let id = element.identifier.isEmpty ? "" : " #\(element.identifier)"
                    let place = "x \(Int(frame.minX)) y \(Int(frame.minY)) w \(Int(frame.width)) h \(Int(frame.height))"
                    var finding = "\(issue.compactDescription): type \(element.elementType.rawValue)\(id) "
                        + "'\(element.label.prefix(60))' at \(place). \(issue.detailedDescription)"
                    let picture = !frame.isEmpty && window.contains(frame) ? element.screenshot() : nil
                    if issue.auditType == .contrast, let picture, let ratio = Contrast.measured(picture.image) {
                        let measured = "Measured \(ratio.formatted(.number.precision(.fractionLength(1)))):1."
                        guard ratio < Contrast.minimum else {
                            findings.unconfirmed.append("\(finding) \(measured)")
                            return true
                        }
                        finding += " \(measured)"
                    }
                    findings.items.append(finding)
                    if let picture { findings.pictures.append(picture) }
                    return true
                }
            } catch {
                XCTFail("The accessibility audit of the \(name) screen could not run: \(error)")
            }
        }
        for (index, picture) in findings.pictures.enumerated() {
            let attachment = XCTAttachment(screenshot: picture)
            attachment.name = "Audit \(name) \(index + 1)"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        if !findings.unconfirmed.isEmpty {
            let note = XCTAttachment(string: findings.unconfirmed.joined(separator: "\n"))
            note.name = "Audit \(name): contrast findings the measurement does not confirm"
            note.lifetime = .keepAlways
            add(note)
        }
        for finding in findings.items {
            XCTFail("Accessibility audit, \(name) screen: \(finding)")
        }
    }

    /// What is on screen, for failure messages: texts, buttons and fields with their identifiers.
    private func screen(_ app: XCUIApplication) -> String {
        var parts: [String] = []
        for (kind, query) in [("text", app.staticTexts), ("button", app.buttons), ("field", app.textFields),
                              ("secure", app.secureTextFields), ("search", app.searchFields)] {
            for element in query.allElementsBoundByIndex.prefix(25) where element.exists {
                let id = element.identifier.isEmpty ? "" : "#\(element.identifier)"
                parts.append("\(kind)\(id)'\(element.label.prefix(40))'")
            }
        }
        return String(parts.joined(separator: " · ").prefix(2_000))
    }

    /// Any element whose label contains the text.
    private func element(in app: XCUIApplication, containing text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }

    private func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }
}

/// RFC 6238 codes, for a time step after the last one used (the api refuses replays).
enum TOTP {
    static func nextCode(secret: String, after lastStep: Int) -> String {
        var now = Int(Date().timeIntervalSince1970 / 30)
        let step = max(now, lastStep + 1)
        // The api accepts one step ahead; beyond that, wait for the clock.
        while step > now + 1 {
            Thread.sleep(forTimeInterval: 1)
            now = Int(Date().timeIntervalSince1970 / 30)
        }
        return code(secret: secret, step: step)
    }

    static func code(secret: String, step: Int) -> String {
        var counter = UInt64(step).bigEndian
        let message = withUnsafeBytes(of: &counter) { Data($0) }
        let mac = Array(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: SymmetricKey(data: base32(secret))))
        let offset = Int(mac[mac.count - 1] & 0x0f)
        let value = (UInt32(mac[offset] & 0x7f) << 24 | UInt32(mac[offset + 1]) << 16
            | UInt32(mac[offset + 2]) << 8 | UInt32(mac[offset + 3])) % 1_000_000
        return String(format: "%06d", value)
    }

    static func base32(_ text: String) -> Data {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var bits = 0
        var buffer = 0
        var bytes = [UInt8]()
        for character in text.uppercased() where character != "=" {
            guard let index = alphabet.firstIndex(of: character) else { continue }
            buffer = (buffer << 5) | index
            bits += 5
            if bits >= 8 {
                bytes.append(UInt8((buffer >> (bits - 8)) & 0xff))
                bits -= 8
            }
        }
        return Data(bytes)
    }
}

/// The findings of one accessibility audit, collected by its issue handler.
@MainActor
private final class AuditFindings {
    var items: [String] = []
    /// A picture of each finding's element, in order.
    var pictures: [XCUIScreenshot] = []
    /// Contrast findings whose measured ratio meets AA.
    var unconfirmed: [String] = []
}

/// WCAG 2 contrast, measured on an element's picture. The background is the most common
/// colour (grouped into near shades, so a material's grain counts as one); the text is
/// the 1% of pixels that differ most from it, the cores of the glyphs rather than their
/// anti-aliased edges. Text covering less than 1% of the picture measures low, so the
/// measurement can wrongly fail but never wrongly pass.
@MainActor
private enum Contrast {
    /// WCAG 2 AA for body text.
    static let minimum = 4.5

    static func measured(_ image: UIImage) -> Double? {
        guard let cgImage = image.cgImage else { return nil }
        let width = cgImage.width
        let height = cgImage.height
        guard width > 0, height > 0 else { return nil }
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                          bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        // Near shades share a group (5 bits a channel); a group's colour is its average.
        var groups: [UInt32: (count: Int, red: Int, green: Int, blue: Int)] = [:]
        var colours: [UInt32] = []
        colours.reserveCapacity(width * height)
        for index in stride(from: 0, to: pixels.count, by: 4) {
            let (red, green, blue) = (pixels[index], pixels[index + 1], pixels[index + 2])
            let key = UInt32(red >> 3) << 10 | UInt32(green >> 3) << 5 | UInt32(blue >> 3)
            let group = groups[key] ?? (count: 0, red: 0, green: 0, blue: 0)
            groups[key] = (count: group.count + 1, red: group.red + Int(red), green: group.green + Int(green),
                           blue: group.blue + Int(blue))
            colours.append(UInt32(red) << 16 | UInt32(green) << 8 | UInt32(blue))
        }
        guard let common = groups.values.max(by: { $0.count < $1.count }) else { return nil }
        let background = luminance(Double(common.red) / Double(common.count), Double(common.green) / Double(common.count),
                                   Double(common.blue) / Double(common.count))
        let ratios = colours.map { rgb in
            ratio(background, luminance(Double(rgb >> 16 & 0xFF), Double(rgb >> 8 & 0xFF), Double(rgb & 0xFF)))
        }.sorted(by: >)
        return ratios[max(0, ratios.count / 100 - 1)]
    }

    static func ratio(_ first: Double, _ second: Double) -> Double {
        (max(first, second) + 0.05) / (min(first, second) + 0.05)
    }

    /// Relative luminance of an sRGB colour with 0–255 channels.
    static func luminance(_ red: Double, _ green: Double, _ blue: Double) -> Double {
        func linear(_ value: Double) -> Double {
            let c = value / 255
            return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }
}
