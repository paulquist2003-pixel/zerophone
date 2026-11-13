import Combine
import SwiftUI
import WebKit

/// Op dit moment alleen Instagram; Snapchat staat klaar in Platform.swift en de regels
/// (zie docs/snapchat-later.md), maar wordt niet getoond of geladen.
struct ContentView: View {
    @StateObject private var instagram = WebViewStore(platform: .instagram)
    @ObservedObject private var rulesStore = RulesStore.shared
    @ObservedObject private var settings = ZerophoneSettings.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var showOnboarding = !UserDefaults.standard.bool(forKey: "zerophone.onboardingDone")

    var body: some View {
        TabView {
            PlatformScreen(store: instagram)
                .tabItem { Label(Platform.instagram.displayName, systemImage: Platform.instagram.systemImage) }
            ZerophoneTab()
                .tabItem { Label("Zerophone", systemImage: "circle.slash") }
        }
        .onReceive(rulesStore.$rules.dropFirst()) { rules in   // de eerste keer doet de store het zelf
            instagram.installScripts(rules)
        }
        .onChange(of: settings.revision) { _, _ in
            instagram.settingsChanged()
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active {
                settings.applyDue()            // wat in de wacht stond en aan de beurt is
                UsageStore.shared.begin()
            } else {
                UsageStore.shared.end()
            }
        }
        .fullScreenCover(isPresented: $showOnboarding) {
            OnboardingView {
                UserDefaults.standard.set(true, forKey: "zerophone.onboardingDone")
                showOnboarding = false
            }
        }
    }
}

struct PlatformScreen: View {
    @ObservedObject var store: WebViewStore

    var body: some View {
        ZStack {
            WebViewContainer(webView: store.webView)
            if let error = store.loadErrorText {
                LoadErrorView(text: error) { store.retry() }
            } else if !store.hasCommittedPage {
                ProgressView("\(store.platform.displayName) laden")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.systemBackground))
            }
        }
        .overlay(alignment: .top) {
            VStack(spacing: 0) {
                if store.isLoading && store.hasCommittedPage && store.loadErrorText == nil {
                    ProgressView(value: min(max(store.progress, 0), 1))
                        .progressViewStyle(.linear)
                }
                if let text = store.bannerText {
                    Text(text)
                        .font(.subheadline.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.top, 8)
                        .padding(.horizontal, 16)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: store.bannerText)
        .onAppear { store.loadIfNeeded() }   // een tab laadt pas als je hem opent
    }
}

/// De eerste pagina laadt niet: uitleg en een knop om het opnieuw te proberen.
struct LoadErrorView: View {
    let text: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text(text)
                .multilineTextAlignment(.center)
            Button("Opnieuw", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

/// De WKWebView leeft in de store, zodat hij niet opnieuw laadt als je van tab wisselt.
struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
