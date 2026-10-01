import Foundation
import Testing
@testable import PatientDomain

@Test func readsWhatASearchMeans() {
    #expect(SearchQuery("rey") == .name("rey"))
    #expect(SearchQuery("Ana Reyes") == .name("Ana Reyes"))
    #expect(SearchQuery("1988-04-12") == .dateOfBirth("1988-04-12"))
    #expect(SearchQuery("ana@example.test") == .email("ana@example.test"))
    #expect(SearchQuery("+1 (555) 555-0123") == .phone("+1 (555) 555-0123"))
    #expect(SearchQuery("   ") == nil)
}

@Test func hasTheTwelveProfileTabs() {
    #expect(ProfileTab.allCases.count == 12)
    #expect(ProfileTab(rawValue: "BEFORE_AFTER") == .beforeAfter)
}

@Test func explainsDuplicateReasonsInWords() {
    let candidate = DuplicateCandidate(id: "p", reasons: ["SAME_EMAIL", "SAME_DATE_OF_BIRTH_SIMILAR_NAME"], summary: nil)
    #expect(candidate.reasonText == "same email, same date of birth and a similar name")
}

@Test func sendsTheDatePickedWithoutTimeZoneShift() throws {
    var draft = PatientDraft()
    let picked = try #require(Calendar.current.date(from: DateComponents(year: 1988, month: 4, day: 12)))
    draft.dateOfBirth = picked
    #expect(draft.dateOfBirthString == "1988-04-12")
}

@Test func leavesBlankOptionalFieldsOut() {
    let draft = PatientDraft()
    #expect(draft.optional("  ") == nil)
    #expect(draft.optional(" ana@example.test ") == "ana@example.test")
}
