import SwiftUI
import UIKit
import WebKit

/// Eén gefilterde browser per platform. Bevat alle beslislogica:
/// - volledige paginaladingen worden gecontroleerd in `decidePolicyFor`
/// - routewissels binnen de single-page app meldt filter.js via `handleRoute`
/// - een losse gedeelde video mag, doorswipen naar de volgende niet
@MainActor
final class WebViewStore: NSObject, ObservableObject {
    static let swipeBlockedText = "Eén video bekijken mag, doorswipen niet"

    let platform: Platform
    let webView: WKWebView

    /// Startpagina; met "Alleen berichten" is dat de inbox.
    var startURL: URL {
        if platform == .instagram, ZerophoneSettings.shared.current.messagesOnly {
            return URL(string: "https://www.instagram.com/direct/inbox/")!
        }
        return platform.startURL
    }

    @Published var bannerText: String?
    /// Laadstatus voor de balk bovenin en het scherm bij de eerste lading.
    @Published private(set) var isLoading = false
    @Published private(set) var progress: Double = 0
    /// Pas waar zodra er een pagina in beeld staat; tot dan toont de app een laadscherm.
    @Published private(set) var hasCommittedPage = false
    /// Gezet als de eerste pagina niet laadt; de app toont dan een foutscherm met "Opnieuw".
    @Published private(set) var loadErrorText: String?

    private var currentRules: PlatformRules?
    private var lastPath = "/"
    private var lastHandledPath: String?
    private var lastWasSingleView = false
    private var didLoad = false
    private var bannerTask: Task<Void, Never>?
    private var urlObservation: NSKeyValueObservation?
    private var progressObservation: NSKeyValueObservation?
    private var loadingObservation: NSKeyValueObservation?
    private var refreshControl: UIRefreshControl?
    private var refreshTask: Task<Void, Never>?

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
        webView.allowsLinkPreview = false
        if let ua = platform.customUserAgent {
            webView.customUserAgent = ua
        }

        // Geen witte flits bij laden of terugkomen uit de achtergrond.
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
        webView.underPageBackgroundColor = .systemBackground

        // Safari > Ontwikkel > [iPhone] > Zerophone, ook met de TestFlight-build.
        // LET OP: zet dit uit (verwijder deze regel of zet hem terug achter #if DEBUG)
        // voordat de app naar de App Store gaat.
        webView.isInspectable = true

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.configuration.userContentController.add(WeakScriptMessageHandler(self), name: "sv")

        // Elke routewissel die de pagina zelf niet meldt (bijv. een link of terugswipen)
        // komt hier alsnog langs de routelogica.
        urlObservation = webView.observe(\.url, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in
                guard let self, let url = self.webView.url else { return }
                self.urlChanged(url)
            }
        }

        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.progress = self.webView.estimatedProgress
            }
        }
        loadingObservation = webView.observe(\.isLoading, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isLoading = self.webView.isLoading
            }
        }

        setUpPullToRefresh()
        installScripts(RulesStore.shared.rules)
    }

    /// Knop "Opnieuw" op het foutscherm.
    func retry() {
        loadErrorText = nil
        if webView.url != nil {
            webView.reload()
        } else {
            webView.load(URLRequest(url: startURL))
        }
    }

    /// Een pagina laadt niet. Zolang er nog niets in beeld stond: foutscherm. Anders blijft de
    /// oude pagina staan en volstaat een korte melding.
    private func handleLoadFailure(_ error: Error) {
        endRefreshing()
        let ns = error as NSError
        // Geannuleerd (eigen blokkade of een nieuwe navigatie) is geen fout.
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return }

        let offline = [NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost,
                       NSURLErrorTimedOut, NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost,
                       NSURLErrorDNSLookupFailed, NSURLErrorDataNotAllowed,
                       NSURLErrorInternationalRoamingOff]
        let long: String
        let short: String
        if ns.domain == "WebKitErrorDomain" && (ns.code == 104 || ns.code == 105) {
            // Ongedocumenteerde codes; volgens Apple DTS het gevolg van Schermtijd-webbeperkingen.
            long = "Instagram lijkt geblokkeerd door Schermtijd. Staat instagram.com bij de websitebeperkingen of websitelimieten? Haal hem daar weg: de limiet hoort op de app, niet op de website."
            short = "Geblokkeerd door Schermtijd"
        } else if ns.domain == NSURLErrorDomain && offline.contains(ns.code) {
            long = "Geen verbinding. Controleer je internet en probeer het opnieuw."
            short = "Geen verbinding"
        } else {
            long = "Instagram laadt niet. Probeer het opnieuw."
            short = "Laden mislukt"
        }
        if hasCommittedPage {
            showBanner(short)
        } else {
            loadErrorText = long
        }
    }

    /// Laadt de startpagina één keer, bij de eerste keer dat de tab in beeld komt.
    func loadIfNeeded() {
        guard !didLoad else { return }
        didLoad = true
        webView.load(URLRequest(url: startURL))
    }

    /// Injecteert filter.js met de regels van dit platform. Werkt vanaf de
    /// volgende paginalading.
    func installScripts(_ rules: FilterRules) {
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()

        guard let baseRules = rules.rules(for: platform),
              let jsURL = Bundle.main.url(forResource: "filter", withExtension: "js"),
              let js = try? String(contentsOf: jsURL, encoding: .utf8) else {
            assertionFailure("Filterscript of regels niet gevonden voor \(platform)")
            return
        }

        // Instellingen van de gebruiker (schakelaars per onderdeel) gelden voor Instagram.
        let platformRules = platform == .instagram
            ? baseRules.applying(ZerophoneSettings.shared.current)
            : baseRules
        guard let configData = try? JSONEncoder().encode(platformRules),
              let configJSON = String(data: configData, encoding: .utf8) else {
            assertionFailure("Regels niet te coderen voor \(platform)")
            return
        }

        currentRules = platformRules
        let env = "window.__SV_ENV = {\"lockZoom\":\(platform.locksZoom)};\n"
        let source = "window.__SV_CONFIG = \(configJSON);\n" + env + js
        controller.addUserScript(
            WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
    }

    /// De gebruiker heeft een schakelaar omgezet: regels opnieuw injecteren en de pagina verversen,
    /// zodat het meteen geldt (een nu geblokkeerde pagina wordt dan alsnog tegengehouden).
    func settingsChanged() {
        installScripts(RulesStore.shared.rules)
        lastHandledPath = nil
        if didLoad, webView.url != nil {
            webView.reload()
        }
    }

    // MARK: - Routelogica

    private func urlChanged(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              currentRules?.isAllowedHost(url.host) == true else { return }
        // Binnen een beperkte host (facebook.com) doorgeklikt naar iets anders dan inloggen.
        if currentRules?.isAllowedPath(host: url.host, path: url.path) == false {
            webView.load(URLRequest(url: startURL))
            showBanner("Deze pagina opent niet in Zerophone")
            return
        }
        handleRoute(url.path)
    }

    func handleRoute(_ path: String) {
        guard let rules = currentRules else { return }

        // Dezelfde route komt van filter.js én van de URL-observer; één keer verwerken.
        let normalizedPath = PlatformRules.normalized(path)
        if normalizedPath == lastHandledPath { return }
        lastHandledPath = normalizedPath
        updatePullToRefresh(for: normalizedPath)

        if let target = rules.redirect(for: path) {
            load(path: target)
            return
        }
        if rules.isBlocked(path: path) {
            block(message: platform.blockMessage(forPath: path), kind: .forPath(path))
            return
        }

        let isSingle = rules.isSingleView(path: path)
        if isSingle && lastWasSingleView && PlatformRules.normalized(path) != PlatformRules.normalized(lastPath) {
            block(message: Self.swipeBlockedText, kind: .swipe)
            return
        }

        lastPath = path
        lastWasSingleView = isSingle
    }

    // MARK: - Pull-to-refresh

    private func setUpPullToRefresh() {
        guard platform.supportsPullToRefresh else { return }
        let control = UIRefreshControl()
        control.addTarget(self, action: #selector(handlePullToRefresh), for: .valueChanged)
        refreshControl = control
        webView.scrollView.refreshControl = control
    }

    /// In chats (bijv. /direct/) staat verversen uit, anders botst het met scrollen.
    private func updatePullToRefresh(for normalizedPath: String) {
        guard let control = refreshControl else { return }
        let excluded = platform.pullToRefreshExcludedPrefixes.contains { normalizedPath.hasPrefix($0) }
        let desired: UIRefreshControl? = excluded ? nil : control
        if webView.scrollView.refreshControl !== desired {
            webView.scrollView.refreshControl = desired
        }
    }

    @objc private func handlePullToRefresh() {
        webView.reload()
        refreshTask?.cancel()
        // Vangnet: de spinner mag nooit blijven hangen.
        refreshTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard !Task.isCancelled else { return }
            self?.endRefreshing()
        }
    }

    private func endRefreshing() {
        refreshTask?.cancel()
        refreshTask = nil
        if refreshControl?.isRefreshing == true {
            refreshControl?.endRefreshing()
        }
    }

    private func block(message: String, kind: StopKind) {
        StatsStore.shared.record(kind)
        if webView.canGoBack {
            webView.goBack()
        } else {
            webView.load(URLRequest(url: startURL))
        }
        showBanner(message)
    }

    private func load(path: String) {
        var components = URLComponents(url: webView.url ?? startURL, resolvingAgainstBaseURL: false)
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
            let path = body["path"] as? String ?? ""
            StatsStore.shared.record(.forPath(path))
            showBanner(platform.blockMessage(forPath: path))
        case "swipeBlocked":
            if (body["leave"] as? Bool) == true {
                block(message: Self.swipeBlockedText, kind: .swipe)
            } else {
                StatsStore.shared.record(.swipe)
                showBanner(Self.swipeBlockedText)
            }
        case "notice":
            // De pagina stuurt alleen een code; de tekst komt uit de regels, niet uit de pagina.
            if (body["code"] as? String) == "followGate", let text = currentRules?.followGate?.message {
                showBanner(text)
            }
        case "feedEnd":
            StatsStore.shared.record(.feedEnd)
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
        guard scheme == "https" || scheme == "http" else {
            if ["mailto", "tel", "sms"].contains(scheme) {
                _ = await UIApplication.shared.open(url)
            } else if navigationAction.navigationType == .linkActivated {
                // Alleen bij een tik: anders voelt de knop kapot. Pogingen van de pagina zelf blijven stil.
                showBanner("De \(platform.displayName)-app openen staat uit")
            }
            return .cancel
        }

        // Iframes (inlogschermen, media) laten we met rust.
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        guard isMainFrame, let rules = currentRules else { return .allow }

        if !rules.isAllowedHost(url.host) {
            _ = await UIApplication.shared.open(url)   // externe links naar Safari
            return .cancel
        }

        // facebook.com mag alleen voor inloggen; de rest (video's, feed) hoort niet in Zerophone.
        if !rules.isAllowedPath(host: url.host, path: url.path) {
            _ = await UIApplication.shared.open(url)
            return .cancel
        }

        if let target = rules.redirect(for: url.path) {
            DispatchQueue.main.async { [weak self] in self?.load(path: target) }
            return .cancel
        }

        if rules.isBlocked(path: url.path) {
            StatsStore.shared.record(.forPath(url.path))
            showBanner(platform.blockMessage(forPath: url.path))
            if webView.url == nil {
                // Eerste lading van een geblokkeerde pagina: ga naar de startpagina.
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.webView.load(URLRequest(url: self.startURL))
                }
            }
            return .cancel
        }

        return .allow
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        hasCommittedPage = true
        loadErrorText = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        endRefreshing()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(error)
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        handleLoadFailure(error)
    }

    /// iOS beëindigt het webproces in de achtergrond; zonder reload blijft het scherm wit.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView.url != nil {
            webView.reload()
        } else if didLoad {
            webView.load(URLRequest(url: startURL))
        }
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
                 decideMediaCapturePermissionsFor origin: WKSecurityOrigin,
                 initiatedBy frame: WKFrameInfo,
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
