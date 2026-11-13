import Foundation

/// Waarom Zerophone iets tegenhield.
enum StopKind: String, CaseIterable {
    case reels, explore, swipe, feedEnd, other

    var label: String {
        switch self {
        case .reels: return "Reels"
        case .explore: return "Verkennen"
        case .swipe: return "Doorswipen"
        case .feedEnd: return "Einde van de feed"
        case .other: return "Overig (stories, enz.)"
        }
    }

    static func forPath(_ path: String) -> StopKind {
        let p = PlatformRules.normalized(path)
        if p.hasPrefix("/reels/") || p.contains("/reel/") { return .reels }
        if p.hasPrefix("/explore/") { return .explore }
        return .other
    }
}

struct DayCount: Identifiable {
    let id: String
    let label: String
    let count: Int
}

/// Telt hoe vaak Zerophone iets tegenhield. Alles blijft op het toestel (UserDefaults).
@MainActor
final class StatsStore: ObservableObject {
    static let shared = StatsStore()

    @Published private(set) var perDay: [String: Int]
    @Published private(set) var perKind: [String: Int]

    private static let dayKey = "zerophone.stats.perDay"
    private static let kindKey = "zerophone.stats.perKind"
    private var lastRecorded = Date.distantPast

    private init() {
        let defaults = UserDefaults.standard
        perDay = defaults.dictionary(forKey: Self.dayKey) as? [String: Int] ?? [:]
        perKind = defaults.dictionary(forKey: Self.kindKey) as? [String: Int] ?? [:]
    }

    static func dayString(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Eén gebeurtenis kan via meerdere wegen binnenkomen (route, klik, navigatie);
    /// tellingen binnen 1,5 seconde na de vorige tellen daarom niet mee.
    func record(_ kind: StopKind, now: Date = Date()) {
        guard now.timeIntervalSince(lastRecorded) > 1.5 else { return }
        lastRecorded = now
        let day = Self.dayString(now)
        perDay[day, default: 0] += 1
        perKind[kind.rawValue, default: 0] += 1
        trim(now: now)
        save()
    }

    func reset() {
        perDay = [:]
        perKind = [:]
        save()
    }

    var total: Int { perKind.values.reduce(0, +) }
    var today: Int { perDay[Self.dayString(Date())] ?? 0 }

    func lastDays(_ n: Int) -> [DayCount] {
        let calendar = Calendar.current
        let today = Date()
        return (0..<n).reversed().compactMap { offset -> DayCount? in
            guard let date = calendar.date(byAdding: .day, value: -offset, to: today) else { return nil }
            let key = Self.dayString(date)
            return DayCount(id: key,
                            label: date.formatted(.dateTime.weekday(.abbreviated)),
                            count: perDay[key] ?? 0)
        }
    }

    var weekTotal: Int { lastDays(7).reduce(0) { $0 + $1.count } }

    private func trim(now: Date) {
        guard perDay.count > 120,
              let cutoff = Calendar.current.date(byAdding: .day, value: -90, to: now) else { return }
        let limit = Self.dayString(cutoff)
        perDay = perDay.filter { $0.key >= limit }
    }

    private func save() {
        let defaults = UserDefaults.standard
        defaults.set(perDay, forKey: Self.dayKey)
        defaults.set(perKind, forKey: Self.kindKey)
    }
}

/// Meet hoe lang Zerophone per dag open staat (app actief op de voorgrond). Een meting, geen
/// schatting. Alles blijft op het toestel (UserDefaults).
@MainActor
final class UsageStore: ObservableObject {
    static let shared = UsageStore()

    @Published private(set) var secondsPerDay: [String: Double]

    private static let key = "zerophone.usage.secondsPerDay"
    private var startedAt: Date?

    private init() {
        secondsPerDay = UserDefaults.standard.dictionary(forKey: Self.key) as? [String: Double] ?? [:]
    }

    func begin(now: Date = Date()) {
        if startedAt == nil { startedAt = now }
    }

    func end(now: Date = Date()) {
        guard let start = startedAt else { return }
        startedAt = nil
        let seconds = now.timeIntervalSince(start)
        // Een sessie van meer dan zes uur is een klok die verzet is, geen gebruik.
        guard seconds > 0, seconds < 6 * 3600 else { return }
        secondsPerDay[StatsStore.dayString(now), default: 0] += seconds
        if secondsPerDay.count > 120,
           let cutoff = Calendar.current.date(byAdding: .day, value: -90, to: now) {
            let limit = StatsStore.dayString(cutoff)
            secondsPerDay = secondsPerDay.filter { $0.key >= limit }
        }
        UserDefaults.standard.set(secondsPerDay, forKey: Self.key)
    }

    func reset() {
        secondsPerDay = [:]
        UserDefaults.standard.removeObject(forKey: Self.key)
        if startedAt != nil { startedAt = Date() }
    }

    /// Minuten vandaag, inclusief de sessie die nu loopt.
    func todayMinutes(now: Date = Date()) -> Int {
        var seconds = secondsPerDay[StatsStore.dayString(now)] ?? 0
        if let start = startedAt { seconds += max(0, now.timeIntervalSince(start)) }
        return Int(seconds / 60)
    }

    /// Gemiddeld aantal minuten per dag over de laatste zeven dagen, vandaag meegeteld.
    func weekAverageMinutes(now: Date = Date()) -> Int {
        var seconds = 0.0
        for offset in 0..<7 {
            guard let date = Calendar.current.date(byAdding: .day, value: -offset, to: now) else { continue }
            seconds += secondsPerDay[StatsStore.dayString(date)] ?? 0
        }
        if let start = startedAt { seconds += max(0, now.timeIntervalSince(start)) }
        return Int(seconds / 60 / 7)
    }
}
