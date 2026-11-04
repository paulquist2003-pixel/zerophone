# Werkregels voor Claude in deze repo

Zerophone: iOS-app (Swift/SwiftUI, WKWebView) die Instagram en Snapchat als website laadt
en Reels/Spotlight wegfiltert. Paul werkt zonder lokale Xcode; alles bouwt in GitHub Actions.
Communiceer in het Nederlands, direct en zonder em-dashes.

## Voor je begint
- Lees eerst `claude/ZEROPHONE_CONTEXT.md` uit de projectkennis (Projects-tool). Dat is de bron
  van waarheid voor status, beslissingen en wat al mislukt is. Pas het bij mijlpalen aan
  (eerst opnieuw inlezen, alleen de betreffende secties wijzigen, changelogregel toevoegen).
- Een toolaanroep die niet is uitgevoerd ("NOT RUN" of een vergelijkbare melding): opnieuw
  proberen of aan Paul melden. Nooit zonder resultaat de beurt beëindigen.

## Filterlaag (`Zerophone/Resources/filter.js`, `rules.json`)
- Na elke wijziging: `cd tests && npm ci && npm test`. Alle tests moeten slagen. De workflow
  "Filtertests" draait dezelfde test op GitHub.
- Nieuwe functionaliteit in `filter.js` krijgt tests in `tests/filter.test.js`.
- Verhoog `"version"` in `rules.json` bij elke wijziging van dat bestand.
- Nieuwe sleutels in `rules.json` moeten ook in de Codable-structs in `FilterRules.swift`
  (verplichte sleutels die ontbreken laten de app bij het starten crashen) en in de
  sleutelcontrole in de test.
- Selectors en knopteksten zijn pas zeker na controle op de echte site (Safari Web Inspector,
  `window.__SV_state()`, `window.__SV_classify(pad)`). Noem ongecontroleerde aannames als zodanig.

## Bouwen en uploaden
- `Build IPA` (compileertest) draait alleen bij wijzigingen in `Zerophone/**`, `project.yml`
  of `build.yml`. De TestFlight-build start je handmatig:
  `gh api -X POST repos/paulquist2003-pixel/zerophone/actions/workflows/testflight.yml/dispatches -f ref=main`
- Na een geslaagde TestFlight-run: start `status.yml` (Build-status) en controleer in het log
  (stap "Status opvragen") dat de nieuwe build `VALID` is.
- Foutmelding "The job was not acquired by Runner of type hosted" of een macOS-run die lang
  `queued` staat: geen codefout. Pas geen code aan. Kijk op githubstatus.com, meld het direct
  aan Paul, poll in korte stukken (hooguit een paar minuten per aanroep) en start opnieuw als de
  run na 15 minuten is opgegeven.
- Buildnummer = `github.run_number` van de TestFlight-workflow; mislukte runs tellen mee.

## App Store en externe TestFlight
- Gaat het over App Store-teksten, een externe testgroep (vrienden), de app-naam, het icoon,
  zoekwoorden, een privacybeleid of voorwaarden: lees eerst `docs/app-store.md`. Daar staan de
  concept-disclaimer (NL en EN), waar die moet komen, de merkregels (geen Instagram, Snapchat,
  Reels of logo's in naam, ondertitel, icoon of zoekwoorden) en de risico's.
- Houd de technische lijn uit dat document aan: alleen de officiële website laden, geen
  interne API, geen wachtwoorden opslaan, geen gegevens naar eigen servers, geen downloads.

## Niet doen
- Geen wachtwoorden, sleutels of tokens in code, documenten of formulieren.
- Niet inloggen bij App Store Connect; gebruik de API-workflows (`status.yml`, `tester.yml`).
- `isInspectable = true` staat in Release aan voor de testfase. Moet uit voordat de app naar de
  App Store gaat.
