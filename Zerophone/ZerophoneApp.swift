import SwiftUI

@main
struct ZerophoneApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .task { await RulesStore.shared.refresh() }
        }
    }
}
