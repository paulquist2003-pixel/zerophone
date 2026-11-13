import SwiftUI
import Charts

/// De tab van Zerophone zelf: wat er is tegengehouden, de instellingen (achter de pincode)
/// en de uitleg om terug te lezen.
struct ZerophoneTab: View {
    @ObservedObject private var stats = StatsStore.shared
    @ObservedObject private var usage = UsageStore.shared
    @ObservedObject private var settings = ZerophoneSettings.shared
    @State private var showSettings = false
    private let feedbackURL = URL(string: "mailto:paulquist2003@gmail.com?subject=Zerophone%20feedback")!

    var body: some View {
        NavigationStack {
            List {
                Section("Tegengehouden") {
                    StatRow(title: "Vandaag", value: "\(stats.today)")
                    StatRow(title: "Laatste 7 dagen", value: "\(stats.weekTotal)")
                    StatRow(title: "Totaal", value: "\(stats.total)")

                    if stats.weekTotal > 0 {
                        Chart(stats.lastDays(7)) { day in
                            BarMark(x: .value("Dag", day.label), y: .value("Keer", day.count))
                        }
                        .frame(height: 120)
                        .padding(.vertical, 4)
                    }

                    ForEach(StopKind.allCases, id: \.self) { kind in
                        let count = stats.perKind[kind.rawValue] ?? 0
                        if count > 0 {
                            StatRow(title: kind.label, value: "\(count)")
                        }
                    }
                }

                Section {
                    StatRow(title: "Vandaag", value: Self.duration(usage.todayMinutes()))
                    StatRow(title: "Gemiddeld per dag (7 dagen)", value: Self.duration(usage.weekAverageMinutes()))
                } header: {
                    Text("Tijd in Zerophone")
                } footer: {
                    Text("Gemeten op dit toestel, terwijl Zerophone open staat. Vergelijk het met wat Schermtijd voor de Instagram-app liet zien.")
                }

                Section {
                    Button {
                        showSettings = true
                    } label: {
                        Label(settings.hasPin ? "Instellingen (met pincode)" : "Instellingen",
                              systemImage: settings.hasPin ? "lock.fill" : "gearshape")
                    }
                }

                Section("Zerophone") {
                    ListBlock(title: "Blijft", items: ZerophoneTexts.keeps, icon: "checkmark.circle.fill", tint: .green)
                    ListBlock(title: "Staat uit", items: ZerophoneTexts.removes, icon: "xmark.circle.fill", tint: .red)
                }
                Section("Eerlijk vooraf") {
                    ForEach(ZerophoneTexts.honest, id: \.self) { item in
                        Label(item.text, systemImage: item.icon)
                    }
                }
                Section("Zet de echte app vast") {
                    ScreenTimeSteps()
                }
                Section {
                    Link("Feedback sturen", destination: feedbackURL)
                }
                Section {
                    Text(ZerophoneTexts.disclaimer)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Zerophone")
        }
        .fullScreenCover(isPresented: $showSettings) {
            SettingsGate()
        }
    }

    private static func duration(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes) min" }
        return "\(minutes / 60) u \(minutes % 60) min"
    }
}

private struct StatRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            Text(value).foregroundStyle(.secondary).monospacedDigit()
        }
    }
}
