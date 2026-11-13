import SwiftUI

/// Cijfertoetsen met vier bolletjes. Roept `onComplete` aan zodra er vier cijfers zijn en
/// wist ze daarna zelf; de aanroeper bepaalt wat er met de code gebeurt.
struct PinPadView: View {
    let title: String
    var message: String?
    let onComplete: (String) -> Void

    @State private var digits = ""
    private let length = 4

    var body: some View {
        VStack(spacing: 28) {
            Text(title)
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)

            HStack(spacing: 16) {
                ForEach(0..<length, id: \.self) { index in
                    ZStack {
                        Circle().stroke(Color.primary, lineWidth: 1.5)
                        Circle().fill(index < digits.count ? Color.primary : Color.clear)
                    }
                    .frame(width: 16, height: 16)
                }
            }

            Text(message ?? " ")
                .font(.footnote)
                .foregroundStyle(.red)
                .multilineTextAlignment(.center)
                .frame(minHeight: 36)

            VStack(spacing: 14) {
                ForEach([["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]], id: \.self) { row in
                    HStack(spacing: 24) {
                        ForEach(row, id: \.self) { digit in key(digit) }
                    }
                }
                HStack(spacing: 24) {
                    Color.clear.frame(width: 72, height: 72)
                    key("0")
                    Button {
                        if !digits.isEmpty { digits.removeLast() }
                    } label: {
                        Image(systemName: "delete.left")
                            .font(.title2)
                            .frame(width: 72, height: 72)
                    }
                    .foregroundStyle(.primary)
                    .accessibilityLabel("Wis laatste cijfer")
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func key(_ digit: String) -> some View {
        Button {
            tap(digit)
        } label: {
            Text(digit)
                .font(.title.weight(.medium))
                .frame(width: 72, height: 72)
                .background(Circle().fill(Color(.secondarySystemBackground)))
        }
        .foregroundStyle(.primary)
    }

    private func tap(_ digit: String) {
        guard digits.count < length else { return }
        digits.append(digit)
        if digits.count == length {
            let code = digits
            digits = ""
            onComplete(code)
        }
    }
}

/// Vraagt om de pincode voor de instellingen.
struct PinGateView: View {
    @ObservedObject private var pin = PinStore.shared
    @ObservedObject private var settings = ZerophoneSettings.shared
    let onUnlock: () -> Void
    @State private var message: String?
    @State private var confirmReset = false

    var body: some View {
        VStack(spacing: 0) {
            PinPadView(title: "Pincode voor de instellingen", message: message) { code in
                switch pin.verify(code) {
                case .ok:
                    settings.cancelPinReset()   // de pincode is dus niet vergeten
                    onUnlock()
                case .wrong(let left):
                    message = "Onjuiste pincode. Nog \(left) \(left == 1 ? "poging" : "pogingen")."
                case .locked(let seconds):
                    message = "Te veel pogingen. Probeer het over \(seconds) seconden opnieuw."
                }
            }
            if let date = settings.pinResetDate {
                Text("De pincode vervalt op \(date.formatted(date: .abbreviated, time: .shortened)).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Verzoek intrekken") { settings.cancelPinReset() }
                    .font(.footnote)
                    .padding(.vertical, 12)
            } else {
                Button("Pincode vergeten?") { confirmReset = true }
                    .font(.footnote)
                    .padding(.vertical, 12)
            }
        }
        .confirmationDialog("De pincode vervalt over \(settings.pinResetHours) uur. Tot die tijd blijven de instellingen op slot.",
                            isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Reset aanvragen") { settings.requestPinReset() }
        }
    }
}

/// Nieuwe pincode kiezen: twee keer invoeren.
struct PinSetupView: View {
    /// `true` als er een pincode is ingesteld, `false` bij annuleren.
    let onFinish: (Bool) -> Void

    @State private var firstEntry: String?
    @State private var message: String?

    var body: some View {
        NavigationStack {
            PinPadView(title: firstEntry == nil ? "Kies een pincode van 4 cijfers"
                                                : "Voer dezelfde pincode nog een keer in",
                       message: message) { code in
                if let first = firstEntry {
                    if code == first {
                        PinStore.shared.set(code)
                        onFinish(true)
                    } else {
                        firstEntry = nil
                        message = "De codes komen niet overeen. Begin opnieuw."
                    }
                } else {
                    firstEntry = code
                    message = nil
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuleer") { onFinish(false) }
                }
            }
        }
    }
}
