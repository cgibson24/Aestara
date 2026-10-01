import Foundation
import Testing
@testable import CoreNetworking

@Test func clientTargetsVersionOne() {
    _ = APIClientFactory.make(baseURL: URL(string: "https://api.example.test")!)
}
