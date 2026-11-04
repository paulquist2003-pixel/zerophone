import SwiftUI
import WebKit

struct ContentView: View {
    @StateObject private var instagram = WebViewStore(platform: .instagram)
    @StateObject private var snapchat = WebViewStore(platform: .snapchat)
    @ObservedObject private var rulesStore = RulesStore.shared

    var body: some View {
        TabView {
            PlatformScreen(store: instagram)
                .tabItem { Label(Platform.instagram.displayName, systemImage: Platform.instagram.systemImage) }
            PlatformScreen(store: snapchat)
                .tabItem { Label(Platform.snapchat.displayName, systemImage: Platform.snapchat.systemImage) }
        }
        .onReceive(rulesStore.$rules) { rules in
            instagram.installScripts(rules)
            snapchat.installScripts(rules)
        }
    }
}

struct PlatformScreen: View {
    @ObservedObject var store: WebViewStore

    var body: some View {
        WebViewContainer(webView: store.webView)
            .overlay(alignment: .top) {
                if let text = store.bannerText {
                    Text(text)
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.2), value: store.bannerText)
            .onAppear { store.loadIfNeeded() }   // Snapchat laadt pas als je de tab opent
    }
}

/// De WKWebView leeft in de store, zodat hij niet opnieuw laadt als je van tab wisselt.
struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
