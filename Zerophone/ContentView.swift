import Combine
import SwiftUI
import WebKit

/// Op dit moment alleen Instagram; Snapchat staat klaar in Platform.swift en de regels
/// (zie docs/snapchat-later.md), maar wordt niet getoond of geladen.
struct ContentView: View {
    @ObservedObject private var instagram = WebViewStore.instagram
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
                if phase == .inactive { instagram.captureSnapshot() }
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
            } else if !store.isReady {
                StartupView(snapshot: store.resumeSnapshot)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: store.isReady)
        .overlay(alignment: .top) {
            VStack(spacing: 0) {
                if store.isLoading && store.isReady && store.loadErrorText == nil {
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

/// Eigen laadscherm tot de site echt iets toont. Na een herstart van het webproces staat de
/// laatste schermafdruk erin, zodat je niet naar een leeg scherm kijkt.
struct StartupView: View {
    let snapshot: UIImage?

    var body: some View {
        ZStack(alignment: .top) {
            Color(.systemBackground)
            if let snapshot {
                Image(uiImage: snapshot)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .clipped()
                ProgressView()
                    .padding(10)
                    .background(.ultraThinMaterial, in: Circle())
                    .padding(.top, 12)
            } else {
                VStack(spacing: 18) {
                    Image(systemName: "circle.slash")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(.secondary)
                    ProgressView()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Instagram laden")
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
