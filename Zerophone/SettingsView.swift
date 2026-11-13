import SwiftUI

/// Toont de instellingen, achter de pincode als die is ingesteld. Sluit zodra de app naar
/// de achtergrond gaat, zodat de volgende keer weer om de pincode wordt gevraagd.
struct SettingsGate: View {
    @ObservedObject private var pin = PinStore.shared
    @ObservedObject private var settings = ZerophoneSettings.shared
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @State private var unlocked = !PinStore.hasStoredPin()

    var body: some View {
        Group {
            if unlocked || !settings.hasPin {
                SettingsView()
            } else {
                NavigationStack {
                    PinGateView { unlocked = true }
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Sluit") { dismiss() }
                            }
                        }
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { dismiss() }
        }
    }
}

struct SettingsView: View {
    @ObservedObject private var settings = ZerophoneSettings.shared
    @ObservedObject private var pin = PinStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var showPinSetup = false
    @State private var confirmRemovePin = false
    @State private var confirmResetStats = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(FilterSection.allCases) { section in
                        SectionToggleRow(section: section)
                    }
                } header: {
                    Text("Instagram")
                } footer: {
                    Text("Een schakelaar uit betekent dat dat onderdeel weer open staat. Zet je Reels uit het slot, dan ook het doorswipen. Bij Stories blijft de balk zichtbaar maar opent een story niet. Alleen berichten start Instagram in je inbox en laat de hoofdfeed dicht. Voorgestelde posts verbergen laat de feed ook stoppen zodra de posts van wie je volgt op zijn.")
                }

                Section {
                    Picker("Bedenktijd", selection: Binding(get: { settings.delayHours },
                                                            set: { settings.setDelay($0) })) {
                        ForEach(ZerophoneSettings.delayChoices, id: \.self) { hours in
                            Text(SettingsView.delayLabel(hours)).tag(hours)
                        }
                    }
                    if let pending = settings.pendingDelay {
                        HStack {
                            Text("Wordt \(SettingsView.delayLabel(pending.hours)) op \(pending.date.formatted(date: .abbreviated, time: .shortened))")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button("Annuleer") { settings.cancelPendingDelay() }
                                .font(.footnote)
                                .buttonStyle(.borderless)
                        }
                    }
                } header: {
                    Text("Bedenktijd")
                } footer: {
                    Text("Strenger zetten gaat direct. Een onderdeel openzetten gaat pas in na je bedenktijd. De drang om even te kijken is sterk maar gaat snel voorbij; een bewuste keuze staat er over twee dagen nog. We raden 48 uur aan. Langer zetten gaat meteen, korter zetten pas na je huidige bedenktijd. Heb je net iets strenger gezet en bedenk je je, dan kun je tien minuten lang direct terug.")
                }

                Section {
                    if pin.hasPin {
                        Button("Pincode wijzigen") { showPinSetup = true }
                        Button("Pincode verwijderen", role: .destructive) { confirmRemovePin = true }
                    } else {
                        Button("Pincode instellen") { showPinSetup = true }
                    }
                } header: {
                    Text("Pincode")
                } footer: {
                    Text("Met een pincode kan niemand de instellingen openen zonder jou. Tip: laat iemand anders de pincode kiezen. Vergeten? Vraag dan op het pincodescherm een reset aan; die gaat in na je bedenktijd, op zijn vroegst na 24 uur. De app verwijderen en opnieuw installeren haalt de pincode niet weg.")
                }

                Section("Statistieken") {
                    Button("Statistieken wissen", role: .destructive) { confirmResetStats = true }
                }
            }
            .navigationTitle("Instellingen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Klaar") { dismiss() }
                }
            }
            .sheet(isPresented: $showPinSetup) {
                PinSetupView { _ in showPinSetup = false }
            }
            .confirmationDialog("Pincode verwijderen?", isPresented: $confirmRemovePin, titleVisibility: .visible) {
                Button("Verwijderen", role: .destructive) { pin.remove() }
            }
            .confirmationDialog("Alle statistieken wissen?", isPresented: $confirmResetStats, titleVisibility: .visible) {
                Button("Wissen", role: .destructive) {
                    StatsStore.shared.reset()
                    UsageStore.shared.reset()
                }
            }
        }
    }
}

extension SettingsView {
    static func delayLabel(_ hours: Int) -> String {
        hours == 0 ? "Geen" : "\(hours) uur"
    }
}

/// Eén schakelaar. Openzetten kan in de wacht staan; dan staat erbij wanneer het ingaat.
private struct SectionToggleRow: View {
    @ObservedObject private var settings = ZerophoneSettings.shared
    let section: FilterSection

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(section.title, isOn: Binding(get: { settings.isOn(section) },
                                                set: { settings.set(section, $0) }))
            if let date = settings.pendingDate(section) {
                HStack {
                    Text("Gaat open op \(date.formatted(date: .abbreviated, time: .shortened))")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Annuleer") { settings.cancelPending(section) }
                        .font(.footnote)
                        .buttonStyle(.borderless)
                }
            }
        }
    }
}
