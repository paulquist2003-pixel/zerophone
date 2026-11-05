import SwiftUI

/// Teksten die zowel de eerste start als de tab Zerophone gebruiken.
enum ZerophoneTexts {
    static let keeps = ["Je chats en DM's", "Posts en stories van wie je volgt", "Zoeken en profielen", "Een video die een vriend je stuurt"]
    static let removes = ["Reels en Verkennen", "Voorgestelde posts", "Doorswipen na een gedeelde video", "Automatisch afspelen"]

    struct HonestItem: Hashable {
        let icon: String
        let text: String
    }

    static let honest: [HonestItem] = [
        HonestItem(icon: "bell.slash", text: "Je krijgt geen meldingen van nieuwe berichten. Open Zerophone zelf een paar keer per dag."),
        HonestItem(icon: "person.crop.circle.badge.questionmark", text: "Profielen van accounts die je niet volgt blijven leeg. Dat is met opzet."),
        HonestItem(icon: "globe", text: "Zerophone gebruikt de website van Instagram. Wat de website niet kan, kan Zerophone ook niet."),
        HonestItem(icon: "clock", text: "De bespaarde tijd is een schatting: een minuut per keer dat Zerophone iets tegenhoudt.")
    ]

    static let screenTimeSteps = [
        "Log eerst hier in Zerophone in.",
        "Open Instellingen > Schermtijd > Applimieten > Voeg limiet toe.",
        "Kies Instagram en stel 1 minuut in.",
        "Laat iemand anders de Schermtijd-toegangscode kiezen. Anders tik je de limiet in een zwak moment zelf weg."
    ]

    static let disclaimer = "Zerophone is niet gelieerd aan, goedgekeurd door of gesponsord door Instagram of Meta Platforms. Instagram is een merk van de eigenaar. Zerophone toont de openbare website van de dienst; je logt in op hun eigen inlogpagina en Zerophone slaat geen wachtwoorden op en stuurt geen gegevens naar eigen servers."
}

/// Eerste start: vier pagina's. Wordt één keer getoond; daarna staat dezelfde uitleg in de tab Zerophone.
struct OnboardingView: View {
    let onDone: () -> Void
    @State private var page = 0
    private let lastPage = 3

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $page) {
                WelcomePage().tag(0)
                HonestPage().tag(1)
                ScreenTimePage().tag(2)
                PinPage().tag(3)
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))

            Button {
                if page < lastPage { withAnimation { page += 1 } } else { onDone() }
            } label: {
                Text(page < lastPage ? "Volgende" : "Klaar, naar Instagram")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .interactiveDismissDisabled()
    }
}

private struct WelcomePage: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Welkom bij Zerophone")
                    .font(.largeTitle.weight(.bold))
                Text("Je vrienden blijven. De eindeloze video's niet.")
                    .font(.title3)
                ListBlock(title: "Blijft", items: ZerophoneTexts.keeps, icon: "checkmark.circle.fill", tint: .green)
                ListBlock(title: "Staat uit", items: ZerophoneTexts.removes, icon: "xmark.circle.fill", tint: .red)
            }
            .padding(24)
        }
    }
}

private struct HonestPage: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Eerlijk vooraf")
                    .font(.largeTitle.weight(.bold))
                ForEach(ZerophoneTexts.honest, id: \.self) { item in
                    Label {
                        Text(item.text)
                    } icon: {
                        Image(systemName: item.icon).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(24)
        }
    }
}

private struct ScreenTimePage: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Zet de echte app vast")
                    .font(.largeTitle.weight(.bold))
                Text("Zonder deze stap tik je uit gewoonte toch op het Instagram-icoon, en daar staan Reels gewoon aan.")
                ScreenTimeSteps()
                Text(ZerophoneTexts.disclaimer)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(24)
        }
    }
}

private struct PinPage: View {
    @ObservedObject private var pin = PinStore.shared
    @State private var showSetup = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Pincode op de instellingen")
                    .font(.largeTitle.weight(.bold))
                Text("In de instellingen kun je Reels, Verkennen en meer weer openzetten. Met een pincode kan dat niet in een zwak moment. Laat bij voorkeur iemand anders de pincode kiezen. Je kunt dit ook later doen.")
                if pin.hasPin {
                    Label("Pincode is ingesteld", systemImage: "lock.fill")
                        .foregroundStyle(.green)
                } else {
                    Button("Pincode instellen") { showSetup = true }
                        .buttonStyle(.bordered)
                }
            }
            .padding(24)
        }
        .sheet(isPresented: $showSetup) {
            PinSetupView { _ in showSetup = false }
        }
    }
}

struct ScreenTimeSteps: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(ZerophoneTexts.screenTimeSteps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("\(index + 1)")
                        .font(.headline)
                        .frame(width: 24)
                    Text(step)
                }
            }
        }
    }
}

struct ListBlock: View {
    let title: String
    let items: [String]
    let icon: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            ForEach(items, id: \.self) { item in
                Label {
                    Text(item)
                } icon: {
                    Image(systemName: icon).foregroundStyle(tint)
                }
            }
        }
    }
}
