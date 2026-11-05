import SwiftUI

/// Toont de instellingen, achter de pincode als die is ingesteld. Sluit zodra de app naar
/// de achtergrond gaat, zodat de volgende keer weer om de pincode wordt gevraagd.
struct SettingsGate: View {
    @ObservedObject private var pin = PinStore.shared
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @State private var unlocked = !PinStore.hasStoredPin()

    var body: some View {
        Group {
            if unlocked {
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
                    Toggle("Reels blokkeren", isOn: $settings.blockReels)
                    Toggle("Verkennen blokkeren", isOn: $settings.blockExplore)
                    Toggle("Voorgestelde posts verbergen", isOn: $settings.blockSuggested)
                    Toggle("Stories blokkeren", isOn: $settings.blockStories)
                    Toggle("Alleen berichten", isOn: $settings.messagesOnly)
                } header: {
                    Text("Instagram")
                } footer: {
                    Text("Een schakelaar uit betekent dat dat onderdeel weer open staat. Zet je Reels uit het slot, dan ook het doorswipen. Bij Stories blijft de balk zichtbaar maar opent een story niet. Alleen berichten start Instagram in je inbox en laat de hoofdfeed dicht.")
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
                    Text("Met een pincode kan niemand de instellingen openen zonder jou. Tip: laat iemand anders de pincode kiezen. Vergeten? Dan helpt alleen de app verwijderen en opnieuw installeren; je statistieken verdwijnen dan ook.")
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
                Button("Wissen", role: .destructive) { StatsStore.shared.reset() }
            }
        }
    }
}
