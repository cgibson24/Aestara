// The patient profile's Timeline tab (Bible §4.3; ADR-0026 K3-18): what
// happened to the patient, newest first, filterable by domain. The server
// shows each domain only to a caller who can read it; items carry no record
// text. Online only: the timeline is not kept on the device.
// Bible §4.3 · tier: app · Layer 3.
import CoreNetworking
import DesignSystem
import PatientDomain
import SwiftUI

struct TimelineTab: View {
    let repository: PatientRepository
    let patientId: String
    @State private var domain: TimelineDomain?
    @State private var items: [TimelineItem] = []
    @State private var nextCursor: String?
    @State private var state: DSViewState? = .loading("Loading the timeline")
    @State private var loadingMore = false

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            Picker("Show", selection: $domain) {
                Text("Everything").tag(TimelineDomain?.none)
                ForEach(TimelineDomain.allCases) { domain in
                    Text(domain.title).tag(Optional(domain))
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("timeline.filter")
            if let state {
                DSStateView(state) { Task { await load() } }
            } else {
                LazyVStack(alignment: .leading, spacing: DSSpacing.sm) {
                    ForEach(items) { item in
                        TimelineRow(item: item)
                    }
                    if nextCursor != nil {
                        Button(loadingMore ? "Loading" : "Show older") { Task { await loadMore() } }
                            .buttonStyle(DSButtonStyle(.secondary))
                            .disabled(loadingMore)
                            .accessibilityIdentifier("timeline.more")
                    }
                }
            }
        }
        .task(id: domain) { await load() }
    }

    private func load() async {
        state = .loading("Loading the timeline")
        do throws(APIError) {
            let page = try await repository.timeline(patientId: patientId, domain: domain)
            items = page.items
            nextCursor = page.nextCursor
            state = items.isEmpty
                ? .empty(title: "Nothing yet", message: "Visits, photos and documents will appear here in date order.")
                : nil
        } catch {
            state = error.viewState
        }
    }

    private func loadMore() async {
        guard let cursor = nextCursor else { return }
        loadingMore = true
        defer { loadingMore = false }
        do throws(APIError) {
            let page = try await repository.timeline(patientId: patientId, domain: domain, cursor: cursor)
            items += page.items
            nextCursor = page.nextCursor
        } catch {
            state = error.viewState
        }
    }
}

struct TimelineRow: View {
    let item: TimelineItem
    /// The icon's column grows with the text, so a large icon never runs into the title.
    @ScaledMetric(relativeTo: .body) private var iconWidth = DSSize.iconLg

    var body: some View {
        HStack(alignment: .top, spacing: DSSpacing.md) {
            Image(systemName: item.systemImage)
                .font(DSFont.body)
                .foregroundStyle(DSColor.accent)
                .frame(width: iconWidth)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                Text(item.title).font(DSFont.body).foregroundStyle(DSColor.textPrimary)
                Text(item.occurredAt, format: .dateTime.day().month().year().hour().minute())
                    .font(DSFont.footnote)
                    .foregroundStyle(DSColor.textSecondary)
            }
            Spacer()
        }
        .padding(DSSpacing.md)
        .background(DSColor.surface, in: RoundedRectangle(cornerRadius: DSRadius.md))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("timeline.item.\(item.kind)")
    }
}
