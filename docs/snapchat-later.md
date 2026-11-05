# Snapchat: later oppakken

Stand 5 november 2026: de app toont alleen Instagram. De Snapchat-code (`Platform.snapchat`,
de regels in `rules.json`) staat er nog, maar wordt niet geladen. Dit zijn de fixes uit het
nachtonderzoek, bedoeld voor wanneer Instagram af is. Ze zijn nog niet gebouwd en niet op een
iPhone getest.

## Lekken in de huidige regels (op afstand vastgesteld)
1. Losse Spotlight-video's hebben nu het adres `/@gebruiker/spotlight/<id>`. De patronen kennen
   alleen `/spotlight/<id>`, dus videobewaking en doorswipe-blokkade grijpen niet in.
2. Openbare profielen `/@gebruiker` tonen een raster met Spotlight-video's.
3. `/topic/...` en `/entertainment/...` staan open.
4. Snapchat for Web (`/web`) heeft een eigen Spotlight-paneel. Of de URL dan wijzigt, is onbekend.

## Voorgestelde fixes (rules.json version 3)
- `singleViewPathPattern`: `^/(@[A-Za-z0-9._-]+/)?spotlight/[A-Za-z0-9_-]+/?$`
- `videoGuard.pagePatterns`: `^/(@[a-z0-9._-]+/)?spotlight/[a-z0-9_-]+/$`
- Blokkeer `/topic/` en `/entertainment/`.
- Nieuwe optionele sleutel `blockedPathPatterns` (regex) voor `/@gebruiker/`-profielen: Swift
  (`FilterRules.swift`), `filter.js` en tests.
- Robuustere `hideSelectors` (ook absolute links, niet alleen relatieve).
- Controle op `loadstart` van de geopende video.
- Spotlight-paneel in `/web`: pas na een Web Inspector-sessie (selector of feeddetector). Niet de
  overlaymodus op heel `/web`, want snaps van vrienden lopen vanzelf door.

## Eerst uitzoeken
- Laadt Snapchat for Web op een iPhone in Zerophone (desktopsite, ca. 980 px breed), kun je
  inloggen en is het leesbaar? Snapchat ondersteunt officieel alleen desktopbrowsers.
- Wat doet de Spotlight-knop in `/web` (URL, paneel, `window.__SV_state()`)?
- Laadt de volgende Spotlight in dezelfde `<video>`-tag?

## Weer aanzetten
In `ContentView.swift` een tweede `WebViewStore(platform: .snapchat)` en een tab toevoegen, en in
`WebViewStore.installScripts` de instellingen alleen voor Instagram laten gelden (staat al zo).
