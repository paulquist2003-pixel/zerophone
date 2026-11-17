import SwiftUI

@main
struct ZerophoneApp: App {
    init() {
        SpeedStore.launchedAt = Date()
        // Eerst wat in de wacht stond toepassen, dan meteen beginnen met laden: zo hoeft de
        // pagina niet direct na de start nog eens te herladen, en loopt het laden al terwijl
        // SwiftUI het eerste scherm opbouwt.
        ZerophoneSettings.shared.applyDue()
        WebViewStore.instagram.loadIfNeeded()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .task { await RulesStore.shared.refresh() }
        }
    }
}
