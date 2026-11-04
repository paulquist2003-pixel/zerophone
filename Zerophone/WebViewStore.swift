import SwiftUI
import UIKit
import WebKit

/// Eén gefilterde browser per platform. Bevat alle beslislogica:
/// - volledige paginaladingen worden gecontroleerd in `decidePolicyFor`
/// - routewissels binnen de single-page app meldt filter.js via `handleRoute`
/// - een losse gedeelde video mag, doorswipen naar de volgende niet
@MainActor
final class WebViewStore: NSObject, ObservableObject {
    let platform: Platform
    let webView: WKWebView

    @Published var bannerText: String?

    private var currentRules: PlatformRules?
    private var lastPath = "/"
    private var lastWasSingleView = false
    private var bannerTask: Task<Void, Never>?

    init(platform: Platform) {
        self.platform = platform

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()          // inlogcookies blijven bewaard
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all   // geen autoplay
        config.applicationNameForUserAgent = platform.applicationNameForUserAgent
        if platform.usesDesktopSite {
            config.defaultWebpagePreferences.preferredContentMode = .desktop
        }

        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        webView.allowsBackForwardNavigationGestures = true
        if let ua = platform.customUserAgent {
            webView.customUserAgent = ua
        }
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true   // Safari > Ontwikkel > [iPhone] om selectors te testen
        }
        #endif

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.configuration.userContentController.add(WeakScriptMessageHandler(self), name: "sv")

        installScripts(RulesStore.shared.rules)
        webView.load(URLRequest(url: platform.startURL))
    }

    /// Injecteert filter.js met de regels van dit platform. Werkt vanaf de
    /// volgende paginalading.
    func installScripts(_ rules: FilterRules) {
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()

        guard let platformRules = rules.rules(for: platform),
              let jsURL = Bundle.main.url(forResource: "filter", withExtension: "js"),
              let js = try? String(contentsOf: jsURL, encoding: .utf8),
              let configData = try? JSONEncoder().encode(platformRules),
              let configJSON = String(data: configData, encoding: .utf8) else {
            assertionFailure("Filterscript of regels niet gevonden voor \(platform)")
            return
        }

        currentRules = platformRules
        let source = "window.__SV_CONFIG = \(configJSON);\n" + js
        controller.addUserScript(
            WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
    }

    // MARK: - Routelogica

    func handleRoute(_ path: String) {
        guard let rules = currentRules else { return }

        if let target = rules.redirect(for: path) {
            load(path: target)
            return
        }
        if rules.isBlocked(path: path) {
            block(message: platform.blockMessage)
            return
        }

        let isSingle = rules.isSingleView(path: path)
        if isSingle && lastWasSingleView && PlatformRules.normalized(path) != PlatformRules.normalized(lastPath) {
            block(message: "Eén video bekijken mag, doorswipen niet")
            return
        }

        lastPath = path
        lastWasSingleView = isSingle
    }

    private func block(message: String) {
        if webView.canGoBack {
            webView.goBack()
        } else {
            webView.load(URLRequest(url: platform.startURL))
        }
        showBanner(message)
    }

    private func load(path: String) {
        var components = URLComponents(url: webView.url ?? platform.startURL, resolvingAgainstBaseURL: false)
        components?.path = path
        components?.query = nil
        components?.fragment = nil
        if let url = components?.url {
            webView.load(URLRequest(url: url))
        }
    }

    func showBanner(_ text: String) {
        bannerText = text
        bannerTask?.cancel()
        bannerTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            guard !Task.isCancelled else { return }
            self?.bannerText = nil
        }
    }
}

// MARK: - Berichten uit filter.js

extension WebViewStore: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }

        switch type {
        case "route":
            if let path = body["path"] as? String { handleRoute(path) }
        case "blockedClick":
            showBanner(platform.blockMessage)
        default:
            break
        }
    }
}

// MARK: - Navigatie (volledige paginaladingen)

extension WebViewStore: WKNavigationDelegate {
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        let scheme = url.scheme?.lowercased() ?? ""

        if ["about", "blob", "data"].contains(scheme) { return .allow }

        // instagram://, snapchat://, itms-apps:// zouden je terugsturen naar de echte app.
        guard scheme == "https" || scheme == "http" else { return .cancel }

        // Iframes (inlogschermen, media) laten we met rust.
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        guard isMainFrame, let rules = currentRules else { return .allow }

        if !rules.isAllowedHost(url.host) {
            _ = await UIApplication.shared.open(url)   // externe links naar Safari
            return .cancel
        }

        if let target = rules.redirect(for: url.path) {
            DispatchQueue.main.async { [weak self] in self?.load(path: target) }
            return .cancel
        }

        if rules.isBlocked(path: url.path) {
            showBanner(platform.blockMessage)
            if webView.url == nil {
                // Eerste lading van een geblokkeerde pagina: ga naar de startpagina.
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.webView.load(URLRequest(url: self.platform.startURL))
                }
            }
            return .cancel
        }

        return .allow
    }
}

// MARK: - Nieuwe vensters en camera/microfoon

extension WebViewStore: WKUIDelegate {
    /// Links met target="_blank" openen in dezelfde webview (en gaan dus ook door het filter).
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }

    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType) async -> WKPermissionDecision {
        currentRules?.isAllowedHost(origin.host) == true ? .prompt : .deny
    }
}

/// WKUserContentController houdt zijn handlers sterk vast; deze proxy voorkomt
/// een retain cycle tussen webview en store.
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
