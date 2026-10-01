// Client-generated UUIDv7 identifiers (RFC 9562 §5.7).
import CoreNetworking
import Foundation
import Testing

@Test func makesVersionSevenUUIDsWithTheTimeFirst() throws {
    let date = Date(timeIntervalSince1970: 1_790_000_000.5)
    let id = UUIDv7.make(at: date)
    #expect(id == id.lowercased())
    let uuid = try #require(UUID(uuidString: id))
    let bytes = withUnsafeBytes(of: uuid.uuid) { Array($0) }
    #expect(bytes[6] >> 4 == 7)
    #expect(bytes[8] >> 6 == 0b10)
    let millis = bytes[0..<6].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    #expect(millis == 1_790_000_000_500)
}

@Test func sortsByCreationTimeAndNeverRepeats() {
    let earlier = UUIDv7.make(at: Date(timeIntervalSince1970: 1_790_000_000))
    let later = UUIDv7.make(at: Date(timeIntervalSince1970: 1_790_000_001))
    #expect(earlier < later)
    let many = Set((0..<500).map { _ in UUIDv7.make() })
    #expect(many.count == 500)
}
