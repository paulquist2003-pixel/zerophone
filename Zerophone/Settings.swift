import Foundation
import CryptoKit
import Security

/// De onderdelen die de gebruiker per stuk aan of uit kan zetten (alleen Instagram).
/// Standaard: Reels, Verkennen en voorgestelde posts staan uit; Stories en de hoofdfeed aan.
struct SectionSettings: Equatable {
    var blockReels = true
    var blockExplore = true
    var blockSuggested = true
    var blockStories = false
    var messagesOnly = false
}

/// Eén schakelaar in de instellingen. Aan is altijd de strenge stand.
enum FilterSection: String, CaseIterable, Identifiable {
    case blockReels, blockExplore, blockSuggested, blockStories, messagesOnly

    var id: String { rawValue }

    var title: String {
        switch self {
        case .blockReels: return "Reels blokkeren"
        case .blockExplore: return "Verkennen blokkeren"
        case .blockSuggested: return "Voorgestelde posts verbergen"
        case .blockStories: return "Stories blokkeren"
        case .messagesOnly: return "Alleen berichten"
        }
    }
}

/// Bewaart een klein blok gegevens in de sleutelhanger van iOS. Dat blijft meestal staan als de
/// app wordt verwijderd (bekend gedrag van iOS, niet door Apple gegarandeerd), zodat opnieuw
/// installeren de instellingen, de bedenktijd en de pincode niet wist.
enum KeychainBox {
    private static let service = "nl.paulquist.zerophone.state"

    private static func base(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    static func read(_ account: String) -> Data? {
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    @discardableResult
    static func write(_ account: String, _ data: Data) -> Bool {
        let update = [kSecValueData as String: data]
        if SecItemUpdate(base(account) as CFDictionary, update as CFDictionary) == errSecSuccess {
            return true
        }
        var add = base(account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }
}

/// Alles wat een zwak moment moet overleven: de schakelaars, de bedenktijd, wat er in de wacht
/// staat en de pincode. Tijden zijn seconden sinds 1970.
struct StoredState: Codable, Equatable {
    var blockReels = true
    var blockExplore = true
    var blockSuggested = true
    var blockStories = false
    var messagesOnly = false

    /// Zo lang duurt het voordat een onderdeel dat je openzet ook echt opengaat.
    var delayHours = 48
    /// Een kortere bedenktijd die pas later ingaat.
    var pendingDelayHours: Int?
    var pendingDelayAt: Double?
    /// Onderdeel -> moment waarop het opengaat.
    var pendingOpen: [String: Double] = [:]
    /// Onderdeel -> moment waarop het strenger is gezet (voor de korte terugdraaitijd).
    var tightenedAt: [String: Double] = [:]

    var pinHash: String?
    var pinSalt: String?
    /// Moment waarop een vergeten pincode vervalt.
    var pinResetAt: Double?

    init() {}

    /// Ontbrekende sleutels krijgen de standaardwaarde, zodat een latere versie velden kan toevoegen.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = StoredState()
        blockReels = try c.decodeIfPresent(Bool.self, forKey: .blockReels) ?? d.blockReels
        blockExplore = try c.decodeIfPresent(Bool.self, forKey: .blockExplore) ?? d.blockExplore
        blockSuggested = try c.decodeIfPresent(Bool.self, forKey: .blockSuggested) ?? d.blockSuggested
        blockStories = try c.decodeIfPresent(Bool.self, forKey: .blockStories) ?? d.blockStories
        messagesOnly = try c.decodeIfPresent(Bool.self, forKey: .messagesOnly) ?? d.messagesOnly
        delayHours = try c.decodeIfPresent(Int.self, forKey: .delayHours) ?? d.delayHours
        pendingDelayHours = try c.decodeIfPresent(Int.self, forKey: .pendingDelayHours)
        pendingDelayAt = try c.decodeIfPresent(Double.self, forKey: .pendingDelayAt)
        pendingOpen = try c.decodeIfPresent([String: Double].self, forKey: .pendingOpen) ?? [:]
        tightenedAt = try c.decodeIfPresent([String: Double].self, forKey: .tightenedAt) ?? [:]
        pinHash = try c.decodeIfPresent(String.self, forKey: .pinHash)
        pinSalt = try c.decodeIfPresent(String.self, forKey: .pinSalt)
        pinResetAt = try c.decodeIfPresent(Double.self, forKey: .pinResetAt)
    }

    func value(_ section: FilterSection) -> Bool {
        switch section {
        case .blockReels: return blockReels
        case .blockExplore: return blockExplore
        case .blockSuggested: return blockSuggested
        case .blockStories: return blockStories
        case .messagesOnly: return messagesOnly
        }
    }

    mutating func setValue(_ section: FilterSection, _ on: Bool) {
        switch section {
        case .blockReels: blockReels = on
        case .blockExplore: blockExplore = on
        case .blockSuggested: blockSuggested = on
        case .blockStories: blockStories = on
        case .messagesOnly: messagesOnly = on
        }
    }

    // MARK: Opslag

    private static let account = "state"
    private static let fallbackKey = "zerophone.state"

    /// Sleutelhanger eerst; lukt dat niet, dan de kopie in UserDefaults; anders de instellingen
    /// van build 8 en eerder (losse sleutels in UserDefaults).
    static func load() -> StoredState {
        let decoder = JSONDecoder()
        if let data = KeychainBox.read(account), let state = try? decoder.decode(StoredState.self, from: data) {
            return state
        }
        let defaults = UserDefaults.standard
        if let data = defaults.data(forKey: fallbackKey), let state = try? decoder.decode(StoredState.self, from: data) {
            return state
        }
        var state = StoredState()
        for section in FilterSection.allCases {
            let key = "zerophone.setting." + section.rawValue
            if defaults.object(forKey: key) != nil {
                state.setValue(section, defaults.bool(forKey: key))
            }
        }
        state.pinHash = defaults.string(forKey: "zerophone.pin.hash")
        state.pinSalt = defaults.string(forKey: "zerophone.pin.salt")
        if state.pinHash == nil || state.pinSalt == nil {
            state.pinHash = nil
            state.pinSalt = nil
        }
        return state
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        let stored = KeychainBox.write(Self.account, data)
        // Kopie voor het geval de sleutelhanger niet werkt; die overleeft herinstalleren niet.
        if stored {
            UserDefaults.standard.removeObject(forKey: Self.fallbackKey)
        } else {
            UserDefaults.standard.set(data, forKey: Self.fallbackKey)
        }
    }
}

/// De instellingen met het principe: strenger zetten gaat direct, losser zetten pas na de
/// bedenktijd. Wie zich binnen tien minuten bedenkt na het strenger zetten, mag direct terug.
/// De klok van het toestel telt; wie die verzet, kan de bedenktijd omzeilen.
@MainActor
final class ZerophoneSettings: ObservableObject {
    static let shared = ZerophoneSettings()

    static let delayChoices = [0, 6, 12, 24, 48, 72]
    static let undoWindow: TimeInterval = 600
    static let minPinResetHours = 24

    /// Wordt hoger bij elke wijziging die de webview raakt; ContentView past dan de webview aan.
    @Published private(set) var revision = 0
    @Published private(set) var state: StoredState

    private init() {
        var loaded = StoredState.load()
        _ = Self.applyDue(to: &loaded, now: Date().timeIntervalSince1970)
        state = loaded
        loaded.save()
    }

    var current: SectionSettings {
        SectionSettings(blockReels: state.blockReels,
                        blockExplore: state.blockExplore,
                        blockSuggested: state.blockSuggested,
                        blockStories: state.blockStories,
                        messagesOnly: state.messagesOnly)
    }

    var hasPin: Bool { state.pinHash != nil }
    var delayHours: Int { state.delayHours }

    func isOn(_ section: FilterSection) -> Bool { state.value(section) }

    /// Moment waarop dit onderdeel opengaat, als dat in de wacht staat.
    func pendingDate(_ section: FilterSection) -> Date? {
        state.pendingOpen[section.rawValue].map { Date(timeIntervalSince1970: $0) }
    }

    var pendingDelay: (hours: Int, date: Date)? {
        guard let hours = state.pendingDelayHours, let at = state.pendingDelayAt else { return nil }
        return (hours, Date(timeIntervalSince1970: at))
    }

    var pinResetDate: Date? {
        state.pinResetAt.map { Date(timeIntervalSince1970: $0) }
    }

    func set(_ section: FilterSection, _ on: Bool, now: Date = Date()) {
        let key = section.rawValue
        let t = now.timeIntervalSince1970
        var next = state
        var changedFilter = false

        if on {
            next.pendingOpen[key] = nil
            if !next.value(section) {
                next.setValue(section, true)
                next.tightenedAt[key] = t
                changedFilter = true
            }
        } else {
            guard next.value(section) else { return }
            let justTightened = t - (next.tightenedAt[key] ?? 0) < Self.undoWindow
            if next.delayHours == 0 || justTightened {
                next.pendingOpen[key] = nil
                next.setValue(section, false)
                changedFilter = true
            } else if next.pendingOpen[key] == nil {
                next.pendingOpen[key] = t + Double(next.delayHours) * 3600
            }
        }
        store(next, filterChanged: changedFilter)
    }

    func cancelPending(_ section: FilterSection) {
        var next = state
        next.pendingOpen[section.rawValue] = nil
        store(next, filterChanged: false)
    }

    /// Langer zetten gaat meteen; korter zetten pas na de huidige bedenktijd.
    func setDelay(_ hours: Int, now: Date = Date()) {
        var next = state
        if hours >= next.delayHours {
            next.delayHours = hours
            next.pendingDelayHours = nil
            next.pendingDelayAt = nil
        } else {
            next.pendingDelayHours = hours
            next.pendingDelayAt = now.timeIntervalSince1970 + Double(next.delayHours) * 3600
        }
        store(next, filterChanged: false)
    }

    func cancelPendingDelay() {
        var next = state
        next.pendingDelayHours = nil
        next.pendingDelayAt = nil
        store(next, filterChanged: false)
    }

    // MARK: Pincode

    func setPin(hash: String, salt: String) {
        var next = state
        next.pinHash = hash
        next.pinSalt = salt
        next.pinResetAt = nil
        store(next, filterChanged: false)
    }

    func clearPin() {
        var next = state
        next.pinHash = nil
        next.pinSalt = nil
        next.pinResetAt = nil
        store(next, filterChanged: false)
    }

    /// Uren tot een vergeten pincode vervalt: de bedenktijd, maar minstens een dag.
    var pinResetHours: Int { max(state.delayHours, Self.minPinResetHours) }

    func requestPinReset(now: Date = Date()) {
        guard hasPin, state.pinResetAt == nil else { return }
        var next = state
        next.pinResetAt = now.timeIntervalSince1970 + Double(pinResetHours) * 3600
        store(next, filterChanged: false)
    }

    func cancelPinReset() {
        var next = state
        next.pinResetAt = nil
        store(next, filterChanged: false)
    }

    // MARK: Wat in de wacht staat

    /// Voert uit wat aan de beurt is. Aanroepen als de app actief wordt en bij het openen van
    /// de instellingen.
    func applyDue(now: Date = Date()) {
        var next = state
        let filterChanged = Self.applyDue(to: &next, now: now.timeIntervalSince1970)
        if next != state { store(next, filterChanged: filterChanged) }
    }

    /// Geeft terug of een schakelaar is omgezet.
    private static func applyDue(to state: inout StoredState, now: Double) -> Bool {
        var filterChanged = false
        for section in FilterSection.allCases {
            guard let at = state.pendingOpen[section.rawValue], at <= now else { continue }
            state.pendingOpen[section.rawValue] = nil
            if state.value(section) {
                state.setValue(section, false)
                filterChanged = true
            }
        }
        if let hours = state.pendingDelayHours, let at = state.pendingDelayAt, at <= now {
            state.delayHours = hours
            state.pendingDelayHours = nil
            state.pendingDelayAt = nil
        }
        if let at = state.pinResetAt, at <= now {
            state.pinHash = nil
            state.pinSalt = nil
            state.pinResetAt = nil
        }
        return filterChanged
    }

    private func store(_ next: StoredState, filterChanged: Bool) {
        guard next != state else { return }
        state = next
        next.save()
        if filterChanged { revision += 1 }
    }
}

// MARK: - Pincode

enum PinCheck {
    case ok
    case wrong(attemptsLeft: Int)
    case locked(seconds: Int)
}

/// Pincode van 4 cijfers op de instellingen. De gezouten hash staat bij de instellingen in de
/// sleutelhanger, dus opnieuw installeren haalt hem niet weg. Vergeten? Dan kan een reset worden
/// aangevraagd; die gaat in na de bedenktijd (zie `ZerophoneSettings.requestPinReset`).
@MainActor
final class PinStore: ObservableObject {
    static let shared = PinStore()

    private static let failKey = "zerophone.pin.fails"
    private static let lockKey = "zerophone.pin.lockedUntil"
    private static let maxAttempts = 5
    private static let lockSeconds = 60.0

    private init() {}

    var hasPin: Bool { ZerophoneSettings.shared.hasPin }

    nonisolated static func hasStoredPin() -> Bool {
        StoredState.load().pinHash != nil
    }

    private static func hash(_ pin: String, salt: String) -> String {
        let digest = SHA256.hash(data: Data((salt + pin).utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    func set(_ pin: String) {
        let defaults = UserDefaults.standard
        let salt = UUID().uuidString
        ZerophoneSettings.shared.setPin(hash: Self.hash(pin, salt: salt), salt: salt)
        defaults.set(0, forKey: Self.failKey)
        defaults.set(0.0, forKey: Self.lockKey)
        // Sleutels van build 8 en eerder opruimen.
        defaults.removeObject(forKey: "zerophone.pin.hash")
        defaults.removeObject(forKey: "zerophone.pin.salt")
        objectWillChange.send()
    }

    func remove() {
        let defaults = UserDefaults.standard
        ZerophoneSettings.shared.clearPin()
        ["zerophone.pin.hash", "zerophone.pin.salt", Self.failKey, Self.lockKey].forEach { defaults.removeObject(forKey: $0) }
        objectWillChange.send()
    }

    func verify(_ pin: String) -> PinCheck {
        let defaults = UserDefaults.standard
        let now = Date().timeIntervalSince1970
        let lockedUntil = defaults.double(forKey: Self.lockKey)
        if lockedUntil > now {
            return .locked(seconds: Int((lockedUntil - now).rounded(.up)))
        }
        let state = ZerophoneSettings.shared.state
        guard let salt = state.pinSalt, let stored = state.pinHash else { return .ok }
        if Self.hash(pin, salt: salt) == stored {
            defaults.set(0, forKey: Self.failKey)
            return .ok
        }
        let fails = defaults.integer(forKey: Self.failKey) + 1
        if fails >= Self.maxAttempts {
            defaults.set(0, forKey: Self.failKey)
            defaults.set(now + Self.lockSeconds, forKey: Self.lockKey)
            return .locked(seconds: Int(Self.lockSeconds))
        }
        defaults.set(fails, forKey: Self.failKey)
        return .wrong(attemptsLeft: Self.maxAttempts - fails)
    }
}
