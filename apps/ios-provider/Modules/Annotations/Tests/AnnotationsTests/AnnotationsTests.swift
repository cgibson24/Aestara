// Annotation layers (ADR-0026 K3-10; ADR-0027): the contract's JSON exactly,
// through the generated types and back; the limits; the screen geometry; and
// the offline queue, which keeps the client ID and base version and never
// overwrites a layer that moved on.
@testable import Annotations
import CoreSecurity
import Foundation
import Testing

private func store() -> AnnotationStore {
    AnnotationStore(store: EncryptedStore(
        scope: StoreScope(userId: UUID().uuidString, organizationId: UUID().uuidString),
        keys: InMemoryStoreKeys(),
        baseDirectory: FileManager.default.temporaryDirectory.appending(path: "annotations-\(UUID().uuidString)")
    ))
}

private let sample = AnnotationDrawing(shapes: [
    .freehand(points: [NormalizedPoint(x: 0.1, y: 0.2), NormalizedPoint(x: 0.3, y: 0.4)], color: .red, stroke: .thin),
    .line(from: NormalizedPoint(x: 0, y: 0), to: NormalizedPoint(x: 1, y: 1), color: .yellow, stroke: .medium),
    .arrow(from: NormalizedPoint(x: 0.5, y: 0.5), to: NormalizedPoint(x: 0.6, y: 0.4), color: .green, stroke: .thick),
    .ellipse(center: NormalizedPoint(x: 0.5, y: 0.5), radiusX: 0.1, radiusY: 0.2, color: .blue, stroke: .medium),
    .rectangle(origin: NormalizedPoint(x: 0.2, y: 0.2), width: 0.25, height: 0.5, color: .white, stroke: .thin),
    .text(position: NormalizedPoint(x: 0.7, y: 0.1), text: "Left brow", color: .black, size: .large),
])

private func json(_ drawing: AnnotationDrawing) throws -> [String: Any] {
    try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(drawing)) as? [String: Any])
}

@Test func encodesTheContractsJSON() throws {
    let object = try json(sample)
    #expect(object["schemaVersion"] as? Int == 1)
    let shapes = try #require(object["shapes"] as? [[String: Any]])
    #expect(shapes.map { $0["type"] as? String } == ["FREEHAND", "LINE", "ARROW", "ELLIPSE", "RECTANGLE", "TEXT"])
    #expect((shapes[0]["points"] as? [[Double]]) == [[0.1, 0.2], [0.3, 0.4]])
    #expect(shapes[0]["color"] as? String == "RED")
    #expect(shapes[0]["stroke"] as? String == "THIN")
    #expect((shapes[1]["from"] as? [Double]) == [0, 0])
    #expect(shapes[3]["radiusY"] as? Double == 0.2)
    #expect((shapes[4]["size"] as? [Double]) == [0.25, 0.5])
    #expect((shapes[4]["origin"] as? [Double]) == [0.2, 0.2])
    #expect(shapes[5]["size"] as? String == "LARGE")
    #expect(shapes[5]["text"] as? String == "Left brow")
    #expect(Set(shapes[5].keys) == ["type", "position", "text", "color", "size"])
}

@Test func decodesWhatItEncodes() throws {
    let data = try JSONEncoder().encode(sample)
    #expect(try JSONDecoder().decode(AnnotationDrawing.self, from: data) == sample)
}

@Test func travelsThroughTheGeneratedTypes() throws {
    let generated = try AnnotationsRepository.wire(sample)
    #expect(AnnotationsRepository.drawing(generated) == sample)
}

@Test func refusesAnUnknownShape() {
    let data = Data(#"{"schemaVersion":1,"shapes":[{"type":"RULER","from":[0,0],"to":[1,1]}]}"#.utf8)
    #expect(throws: DecodingError.self) { try JSONDecoder().decode(AnnotationDrawing.self, from: data) }
}

@Test func keepsPointsOnThePhoto() {
    #expect(NormalizedPoint(x: -0.2, y: 1.4) == NormalizedPoint(x: 0, y: 1))
}

@Test func knowsTheLimits() {
    let line = AnnotationShape.line(from: NormalizedPoint(x: 0, y: 0), to: NormalizedPoint(x: 1, y: 1), color: .red, stroke: .thin)
    #expect(AnnotationDrawing(shapes: Array(repeating: line, count: AnnotationLimits.maxShapes)).isWithinLimits)
    #expect(!AnnotationDrawing(shapes: Array(repeating: line, count: AnnotationLimits.maxShapes + 1)).isWithinLimits)
}

@Test func fitsThePhotoOnScreen() {
    let rect = AnnotationRenderer.fittedRect(imageSize: CGSize(width: 300, height: 400), in: CGSize(width: 600, height: 400))
    #expect(rect == CGRect(x: 150, y: 0, width: 300, height: 400))
    let point = AnnotationRenderer.point(NormalizedPoint(x: 0.5, y: 0.25), in: rect)
    #expect(point == CGPoint(x: 300, y: 100))
    #expect(AnnotationRenderer.normalized(point, in: rect) == NormalizedPoint(x: 0.5, y: 0.25))
}

@Test func queuesALayerDrawnOfflineAndCoalescesItsChanges() async {
    let s = store()
    await s.queueCreate(patientId: "p", photoId: "ph", layerId: "l1", label: nil, drawing: AnnotationDrawing())
    await s.queueEdit(patientId: "p", photoId: "ph", layerId: "l1", label: "Brow", drawing: sample, baseVersion: 0)
    let queue = await s.queue()
    #expect(queue.count == 1)
    #expect(queue[0].kind == .create)
    #expect(queue[0].drawing == sample)
    #expect(queue[0].label == "Brow")
}

@Test func keepsTheBaseVersionOfASentLayer() async {
    let s = store()
    await s.queueEdit(patientId: "p", photoId: "ph", layerId: "l1", label: nil, drawing: AnnotationDrawing(), baseVersion: 3)
    await s.queueEdit(patientId: "p", photoId: "ph", layerId: "l1", label: nil, drawing: sample, baseVersion: 4)
    let queue = await s.queue()
    #expect(queue.count == 1)
    #expect(queue[0].baseVersion == 3)
    #expect(queue[0].drawing == sample)
}

@Test func keepsTheLayersForOfflineUseWithinThePolicy() async {
    let s = store()
    // Whole seconds: the store keeps dates as ISO 8601 without fractions.
    let now = Date(timeIntervalSince1970: 1_790_000_000)
    let layer = AnnotationLayerItem(id: "l1", photoId: "ph", authorUserId: "u", label: nil, drawing: sample, updatedAt: now, version: 2)
    await s.save([layer], patientId: "p", photoId: "ph", now: now)
    #expect(await s.layers(photoId: "ph", now: now) == [layer])
    await s.apply(maxPatients: 25, maxAgeDays: 1, now: now.addingTimeInterval(2 * 86_400))
    #expect(await s.layers(photoId: "ph", now: now.addingTimeInterval(2 * 86_400)) == nil)
}

@Test func forgetsEverythingAtSignOut() async {
    let s = store()
    await s.save([], patientId: "p", photoId: "ph")
    await s.queueCreate(patientId: "p", photoId: "ph", layerId: "l1", label: nil, drawing: sample)
    await s.removeAll()
    #expect(await s.queue().isEmpty)
    #expect(await s.layers(photoId: "ph") == nil)
}
