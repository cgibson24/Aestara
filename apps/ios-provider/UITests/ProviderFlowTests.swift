// End-to-end UI tests of the provider app against the real Layer 1 api
// (Bible §32 #9, #12, #13; docs/TESTING_STRATEGY.md §18.1). CI starts the api
// with services/api/scripts/local-stack.ts, which prepares one clinician per
// device, and passes the sign-in through TEST_RUNNER_* variables:
// UITEST_EMAIL, UITEST_PASSWORD, UITEST_TOTP_SECRET, UITEST_TOTP_LAST_STEP.
// All data is synthetic.
import CryptoKit
import XCTest

@MainActor
final class ProviderFlowTests: XCTestCase {
    func testSignInCreateSearchAndOpenAPatient() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        let env = ProcessInfo.processInfo.environment
        let email = try XCTUnwrap(env["UITEST_EMAIL"], "UITEST_EMAIL is not set")
        let password = try XCTUnwrap(env["UITEST_PASSWORD"], "UITEST_PASSWORD is not set")
        let secret = try XCTUnwrap(env["UITEST_TOTP_SECRET"], "UITEST_TOTP_SECRET is not set")
        let lastStep = try XCTUnwrap(Int(env["UITEST_TOTP_LAST_STEP"] ?? ""), "UITEST_TOTP_LAST_STEP is not set")
        app.launch()

        // Login UI: a wrong password shows the server's message.
        let emailField = app.textFields["signin.email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 20), "The sign-in screen did not appear")
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields["signin.password"]
        passwordField.tap()
        let wrong = "not the right one"
        passwordField.typeText(wrong)
        app.buttons["signin.submit"].tap()
        XCTAssertTrue(
            element(in: app, containing: "incorrect").waitForExistence(timeout: 15),
            "A wrong password did not show an error"
        )
        passwordField.tap()
        passwordField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: wrong.count))
        passwordField.typeText(password)
        app.buttons["signin.submit"].tap()

        // Second factor.
        let codeField = app.textFields["mfa.code"]
        XCTAssertTrue(codeField.waitForExistence(timeout: 15), "The code screen did not appear")
        codeField.tap()
        codeField.typeText(TOTP.nextCode(secret: secret, after: lastStep))
        app.buttons["mfa.verify"].tap()

        // Signed in: create a patient (duplicate check first).
        let newPatient = app.buttons["patients.new"]
        XCTAssertTrue(newPatient.waitForExistence(timeout: 20), "The patient list did not appear")
        newPatient.tap()
        let lastName = "Quill" + String((0..<6).map { _ in "abcdefghijklmnopqrstuvwxyz".randomElement()! })
        let firstName = app.textFields["patient.firstName"]
        XCTAssertTrue(firstName.waitForExistence(timeout: 10))
        firstName.tap()
        firstName.typeText("Ana")
        let lastNameField = app.textFields["patient.lastName"]
        lastNameField.tap()
        lastNameField.typeText(lastName)
        // Date of birth: month, day, year wheels (en_US).
        let year = app.pickerWheels.element(boundBy: 2)
        XCTAssertTrue(year.waitForExistence(timeout: 5), "The date-of-birth picker did not appear")
        year.adjust(toPickerWheelValue: "1988")
        let create = app.buttons["patient.create"]
        XCTAssertTrue(waitUntil(timeout: 5) { create.isEnabled }, "Create stayed disabled")
        create.tap()

        // The profile shell opens with all twelve tabs.
        let photos = app.buttons["profile.tab.PHOTOS"]
        XCTAssertTrue(photos.waitForExistence(timeout: 20), "The new patient's profile did not open")
        XCTAssertTrue(element(in: app, containing: lastName).exists, "The profile header does not name the patient")
        for tab in ["OVERVIEW", "TIMELINE", "CONSULTATIONS", "PHOTOS", "BEFORE_AFTER", "SIMULATIONS",
                    "TREATMENT_PLANS", "PROCEDURES", "DOCUMENTS", "INSTRUCTIONS", "APPOINTMENTS", "MESSAGES"] {
            XCTAssertTrue(app.buttons["profile.tab.\(tab)"].exists, "Tab \(tab) is missing")
        }
        photos.tap()
        XCTAssertTrue(element(in: app, containing: "no clinical photos").waitForExistence(timeout: 5), "Photos empty state")

        // Search finds the patient by name prefix.
        if app.navigationBars.buttons.firstMatch.exists, !app.searchFields.firstMatch.isHittable {
            app.navigationBars.buttons.firstMatch.tap()
        }
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10), "The search field did not appear")
        search.tap()
        search.typeText(String(lastName.prefix(8)))
        let row = app.cells.containing(NSPredicate(format: "label CONTAINS %@", lastName)).firstMatch
        let combinedRow = app.cells.matching(NSPredicate(format: "label CONTAINS %@", lastName)).firstMatch
        XCTAssertTrue(waitUntil(timeout: 15) { row.exists || combinedRow.exists }, "Search did not find the patient")
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
