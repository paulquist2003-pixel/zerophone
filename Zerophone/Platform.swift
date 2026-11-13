import Foundation

/// De platforms die Zerophone in een gefilterde browser kan laden. Op dit moment toont de app
/// alleen Instagram (zie ContentView); Snapchat blijft hier staan voor later, zie docs/snapchat-later.md.
enum Platform: String, CaseIterable, Identifiable {
    case instagram
    case snapchat

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .instagram: return "Instagram"
        case .snapchat: return "Snapchat"
        }
    }

    var systemImage: String {
        switch self {
        case .instagram: return "camera"
        case .snapchat: return "bubble.left.and.bubble.right"
        }
    }

    var startURL: URL {
        switch self {
        case .instagram: return URL(string: "https://www.instagram.com/")!
        case .snapchat: return URL(string: "https://www.snapchat.com/web")!
        }
    }

    /// Snapchat for Web is gebouwd voor desktopbrowsers; op een mobiele user agent
    /// stuurt de site je naar de App Store. Daarom laden we Snapchat als desktopsite.
    var usesDesktopSite: Bool { self == .snapchat }

    /// Geen pinch-zoom en geen automatisch inzoomen bij typen (alleen mobiele sites).
    var locksZoom: Bool { !usesDesktopSite }

    /// Naar beneden trekken om te verversen (alleen mobiele sites).
    var supportsPullToRefresh: Bool { !usesDesktopSite }

    /// Op deze paden staat verversen uit, zodat het niet botst met scrollen in een chat.
    var pullToRefreshExcludedPrefixes: [String] { ["/direct/"] }

    /// Volledige user agent (alleen voor desktopsites).
    var customUserAgent: String? {
        guard usesDesktopSite else { return nil }
        return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
    }

    /// Wordt achter de standaard WKWebView-user agent geplakt, zodat sites ons als
    /// mobiele Safari herkennen in plaats van als "kale" in-app browser.
    var applicationNameForUserAgent: String {
        // Zelfde versie als Safari op dit toestel, in plaats van een vast getal dat veroudert.
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "Version/\(v.majorVersion).\(v.minorVersion) Mobile/15E148 Safari/604.1"
    }

    /// Melding bij een geblokkeerd pad; specifieker dan `blockMessage` waar dat kan.
    func blockMessage(forPath path: String) -> String {
        if self == .instagram {
            let p = path.lowercased()
            if p.hasPrefix("/stories/") { return "Stories staan uit" }
            if p.hasPrefix("/reels/") { return "Reels staan uit" }
            if p.hasPrefix("/explore/") { return "Verkennen staat uit" }
        }
        return blockMessage
    }

    var blockMessage: String {
        switch self {
        case .instagram: return "Reels en Verkennen staan uit"
        case .snapchat: return "Spotlight en Discover staan uit"
        }
    }
}
