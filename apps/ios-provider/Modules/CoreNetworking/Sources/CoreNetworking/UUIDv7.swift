// Client-generated identifiers for offline work (spec §6.1.8, §8 rule 1): the
// server accepts a UUIDv7 as the ID of a session, photo or offline audit event
// created on the device, so a replay creates nothing twice.
// RFC 9562 §5.7: 48 bits of Unix milliseconds, version 7, 74 random bits.
// Bible §20, §23 · tier: foundation · Layer 2.
import Foundation

public enum UUIDv7 {
    /// A new lower-case UUIDv7 string.
    public static func make(at date: Date = Date()) -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        var generator = SystemRandomNumberGenerator()
        for i in 6..<16 { bytes[i] = UInt8.random(in: 0...255, using: &generator) }
        let millis = UInt64(max(0, date.timeIntervalSince1970 * 1000))
        for i in 0..<6 { bytes[i] = UInt8(truncatingIfNeeded: millis >> (8 * (5 - UInt64(i)))) }
        bytes[6] = (bytes[6] & 0x0F) | 0x70
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        let uuid = UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                               bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
        return uuid.uuidString.lowercased()
    }
}
