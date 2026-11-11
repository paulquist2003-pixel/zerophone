import Foundation

/// Verberg het dichtstbijzijnde element dat past op `hideClosest` zodra een
/// tekstknooppunt exact gelijk is aan een van `texts` (bijv. "Suggested for you").
struct TextRule: Codable, Hashable {
    let texts: [String]
    let hideClosest: String
}

/// Videobewaking (filter.js): in een reelviewer mag één video, doorswipen niet.
/// Alleen doorgegeven aan JS; Swift gebruikt deze velden zelf niet.
struct VideoGuard: Codable, Hashable {
    /// Regex's voor pagina's die één losse video zijn (kleine letters, afsluitende "/").
    let pagePatterns: [String]
    /// Padvoorvoegsels waar video's in een viewer-overlay openen (bijv. "/direct/").
    let overlayPathPrefixes: [String]
    /// Padvoorvoegsels waar de bewaking uit staat (bijv. "/stories/").
    let exemptPathPrefixes: [String]
}

/// Feedfilter (filter.js): op de hoofdfeed wordt elke post verborgen waarvan de kop een
/// Volgen-knop heeft. Zo'n post komt van een account dat je niet volgt, dus is voorgesteld of
/// aanbevolen, ook als er geen label boven staat. Alleen doorgegeven aan JS.
struct FeedFilter: Codable, Hashable {
    /// Paden (kleine letters, afsluitende "/") die als hoofdfeed gelden.
    let feedPaths: [String]
    /// Selector voor één post in de feed.
    let postSelector: String
    /// Knopteksten die betekenen "je volgt dit account niet".
    let followTexts: [String]
}

/// Volgpoort (filter.js): op profielen en posts van accounts die je niet volgt
/// wordt de content verborgen. Alleen doorgegeven aan JS.
struct FollowGate: Codable, Hashable {
    /// Regex's voor profiel- en postpagina's waarop de poort geldt.
    let pathPatterns: [String]
    let exemptPathPrefixes: [String]
    /// Knopteksten die betekenen "je volgt dit account niet".
    let followTexts: [String]
    /// Knopteksten die betekenen "je volgt dit account (of bent het zelf)".
    let followedTexts: [String]
    /// Selector die alleen op je eigen profiel voorkomt.
    let selfSelector: String?
    let hidePostLinks: [String]
    let hideAlways: [String]
    /// Melding die getoond wordt bij een account dat je niet volgt.
    let message: String
}

/// Regels per platform. Paden worden genormaliseerd naar kleine letters met een
/// afsluitende "/", dus "/reels" en "/Reels/" worden allebei "/reels/".
struct PlatformRules: Codable {
    /// Hosts die in de app mogen openen; andere links gaan naar Safari.
    let allowedHostSuffixes: [String]
    /// Uitzonderingen op de blokkades hieronder (bijv. zoeken binnen /explore/).
    let allowedPathPrefixes: [String]
    /// Pad -> pad waar je in plaats daarvan heen gaat.
    let redirects: [String: String]
    let blockedExactPaths: [String]
    let blockedPathPrefixes: [String]
    /// Regex voor een "losse video" (een gedeelde reel of Spotlight). Eén openen mag,
    /// van de ene naar de volgende swipen niet.
    let singleViewPathPattern: String?
    let hideSelectors: [String]
    let textRules: [TextRule]
    let feedFilter: FeedFilter?
    let videoGuard: VideoGuard?
    let followGate: FollowGate?

    static func normalized(_ path: String) -> String {
        let p = path.isEmpty ? "/" : path.lowercased()
        return p.hasSuffix("/") ? p : p + "/"
    }

    func redirect(for path: String) -> String? {
        redirects[Self.normalized(path)]
    }

    func isBlocked(path: String) -> Bool {
        let p = Self.normalized(path)
        if allowedPathPrefixes.contains(where: { p.hasPrefix($0) }) { return false }
        if blockedExactPaths.contains(p) { return true }
        return blockedPathPrefixes.contains { p.hasPrefix($0) }
    }

    func isSingleView(path: String) -> Bool {
        guard let pattern = singleViewPathPattern else { return false }
        return path.range(of: pattern, options: .regularExpression) != nil
    }

    func isAllowedHost(_ host: String?) -> Bool {
        guard let host = host?.lowercased() else { return false }
        return allowedHostSuffixes.contains { host == $0 || host.hasSuffix("." + $0) }
    }
}

extension PlatformRules {
    /// Past de instellingen van de gebruiker toe op de meegeleverde regels (alleen Instagram).
    /// Strenger zetten haalt niets weg; een onderdeel toestaan haalt de bijbehorende regels weg.
    func applying(_ s: SectionSettings) -> PlatformRules {
        var blocked = blockedPathPrefixes
        var redirects = self.redirects
        var hide = hideSelectors
        var texts = textRules
        var feed = feedFilter
        var guardConfig = videoGuard
        var single = singleViewPathPattern

        if !s.blockReels {
            blocked.removeAll { $0 == "/reels/" }
            hide.removeAll { $0.contains("/reels/") }
            guardConfig = nil
            single = nil
        }
        if !s.blockExplore {
            blocked.removeAll { $0 == "/explore/" }
            redirects.removeValue(forKey: "/explore/")
            hide.removeAll { $0.contains("/explore/") }
        }
        if !s.blockSuggested {
            texts = []
            feed = nil
        }
        if s.blockStories {
            blocked.append("/stories/")
        }
        if s.messagesOnly {
            redirects["/"] = "/direct/inbox/"
        }

        return PlatformRules(allowedHostSuffixes: allowedHostSuffixes,
                             allowedPathPrefixes: allowedPathPrefixes,
                             redirects: redirects,
                             blockedExactPaths: blockedExactPaths,
                             blockedPathPrefixes: blocked,
                             singleViewPathPattern: single,
                             hideSelectors: hide,
                             textRules: texts,
                             feedFilter: feed,
                             videoGuard: guardConfig,
                             followGate: followGate)
    }
}

struct FilterRules: Codable {
    let version: Int
    let platforms: [String: PlatformRules]

    func rules(for platform: Platform) -> PlatformRules? {
        platforms[platform.rawValue]
    }
}

/// Laadt de filterregels: eerst een gecachte versie van de server (als die nieuwer
/// is), anders de meegeleverde rules.json. Zo kun je kapotte selectors repareren
/// zonder een nieuwe app-versie te bouwen.
@MainActor
final class RulesStore: ObservableObject {
    static let shared = RulesStore()

    /// Zet hier later een URL naar een gehoste rules.json (bijv. een GitHub raw-link).
    /// Verhoog dan "version" in dat bestand bij elke wijziging.
    static let remoteURL: URL? = nil

    @Published private(set) var rules: FilterRules

    private init() {
        let bundled = Self.loadBundled()
        if let cached = Self.loadCached(), cached.version > bundled.version {
            rules = cached
        } else {
            rules = bundled
        }
    }

    private static var cacheURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("rules.json")
    }

    private static func loadBundled() -> FilterRules {
        guard let url = Bundle.main.url(forResource: "rules", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let rules = try? JSONDecoder().decode(FilterRules.self, from: data) else {
            fatalError("rules.json ontbreekt of is ongeldig")
        }
        return rules
    }

    private static func loadCached() -> FilterRules? {
        guard let data = try? Data(contentsOf: cacheURL) else { return nil }
        return try? JSONDecoder().decode(FilterRules.self, from: data)
    }

    func refresh() async {
        guard let url = Self.remoteURL else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let fresh = try JSONDecoder().decode(FilterRules.self, from: data)
            guard fresh.version > rules.version else { return }
            try FileManager.default.createDirectory(
                at: Self.cacheURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: Self.cacheURL)
            rules = fresh
        } catch {
            print("Regels verversen mislukt: \(error)")
        }
    }
}
