import Foundation
import CryptoKit

/// De onderdelen die de gebruiker per stuk aan of uit kan zetten (alleen Instagram).
/// Standaard: Reels, Verkennen en voorgestelde posts staan uit; Stories en de hoofdfeed aan.
struct SectionSettings: Equatable {
    var blockReels = true
    var blockExplore = true
    var blockSuggested = true
    var blockStories = false
    var messagesOnly = false
}

@MainActor
final class ZerophoneSettings: ObservableObject {
    static let shared = ZerophoneSettings()

    /// Wordt hoger bij elke wijziging; ContentView past dan de webview aan.
    @Published private(set) var revision = 0

    @Published var blockReels: Bool { didSet { persist("blockReels", blockReels, old: oldValue) } }
    @Published var blockExplore: Bool { didSet { persist("blockExplore", blockExplore, old: oldValue) } }
    @Published var blockSuggested: Bool { didSet { persist("blockSuggested", blockSuggested, old: oldValue) } }
    @Published var blockStories: Bool { didSet { persist("blockStories", blockStories, old: oldValue) } }
    @Published var messagesOnly: Bool { didSet { persist("messagesOnly", messagesOnly, old: oldValue) } }

    var current: SectionSettings {
        SectionSettings(blockReels: blockReels,
                        blockExplore: blockExplore,
                        blockSuggested: blockSuggested,
                        blockStories: blockStories,
                        messagesOnly: messagesOnly)
    }

    private static func key(_ name: String) -> String { "zerophone.setting." + name }

    private static func read(_ name: String, _ fallback: Bool) -> Bool {
        let defaults = UserDefaults.standard
        return defaults.object(forKey: key(name)) == nil ? fallback : defaults.bool(forKey: key(name))
    }

    private init() {
        let d = SectionSettings()
        blockReels = Self.read("blockReels", d.blockReels)
        blockExplore = Self.read("blockExplore", d.blockExplore)
        blockSuggested = Self.read("blockSuggested", d.blockSuggested)
        blockStories = Self.read("blockStories", d.blockStories)
        messagesOnly = Self.read("messagesOnly", d.messagesOnly)
    }

    private func persist(_ name: String, _ value: Bool, old: Bool) {
        guard value != old else { return }
        UserDefaults.standard.set(value, forKey: Self.key(name))
        revision += 1
    }
}

// MARK: - Pincode

enum PinCheck {
    case ok
    case wrong(attemptsLeft: Int)
    case locked(seconds: Int)
}

/// Pincode van 4 cijfers op de instellingen. Bewaard als gezouten hash in UserDefaults,
/// dus verwijderen en opnieuw installeren van de app zet hem terug.
@MainActor
final class PinStore: ObservableObject {
    static let shared = PinStore()

    private static let hashKey = "zerophone.pin.hash"
    private static let saltKey = "zerophone.pin.salt"
    private static let failKey = "zerophone.pin.fails"
    private static let lockKey = "zerophone.pin.lockedUntil"
    private static let maxAttempts = 5
    private static let lockSeconds = 60.0

    @Published private(set) var hasPin: Bool

    private init() {
        hasPin = Self.hasStoredPin()
    }

    nonisolated static func hasStoredPin() -> Bool {
        UserDefaults.standard.string(forKey: hashKey) != nil
    }

    private static func hash(_ pin: String, salt: String) -> String {
        let digest = SHA256.hash(data: Data((salt + pin).utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    func set(_ pin: String) {
        let defaults = UserDefaults.standard
        let salt = UUID().uuidString
        defaults.set(salt, forKey: Self.saltKey)
        defaults.set(Self.hash(pin, salt: salt), forKey: Self.hashKey)
        defaults.set(0, forKey: Self.failKey)
        defaults.set(0.0, forKey: Self.lockKey)
        hasPin = true
    }

    func remove() {
        let defaults = UserDefaults.standard
        [Self.hashKey, Self.saltKey, Self.failKey, Self.lockKey].forEach { defaults.removeObject(forKey: $0) }
        hasPin = false
    }

    func verify(_ pin: String) -> PinCheck {
        let defaults = UserDefaults.standard
        let now = Date().timeIntervalSince1970
        let lockedUntil = defaults.double(forKey: Self.lockKey)
        if lockedUntil > now {
            return .locked(seconds: Int((lockedUntil - now).rounded(.up)))
        }
        guard let salt = defaults.string(forKey: Self.saltKey),
              let stored = defaults.string(forKey: Self.hashKey) else { return .ok }
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
