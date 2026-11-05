# Zerophone (fase 1: Instagram zonder Reels)

> Tijdelijk toont de app alleen Instagram, om dat eerst goed te krijgen. De Snapchat-regels
> staan nog in de code; zie `docs/snapchat-later.md`.

Zerophone laadt Instagram en Snapchat via hun websites in een eigen browser en
filtert de korte-videofeeds eruit. DM's, je feed van mensen die je volgt, Stories,
zoeken en profielen blijven werken.

## Wat de app nu doet

| | Instagram | Snapchat |
|---|---|---|
| Geblokkeerd | Reels-feed, Verkennen-grid, hashtag- en locatiefeeds, voorgestelde posts | Spotlight-feed, Discover |
| Toegestaan | Feed, Stories, DM's, zoeken, profielen | Chat (Snapchat for Web) |
| Gedeelde video van een vriend | Bekijken mag, doorswipen niet (ook niet in DM's) | Bekijken mag, doorswipen niet |
| Profielen en posts | Alleen content van accounts die je volgt (volgpoort) | |
| Overig | Video's spelen niet automatisch af; externe links openen in Safari; `instagram://`-links worden tegengehouden zodat je niet in de echte app belandt | Zelfde |

## Instellingen, pincode en tegengehouden-teller

De tab Zerophone toont hoe vaak de app iets tegenhield (vandaag, 7 dagen, totaal) en een
geschatte bespaarde tijd (aanname: 1 minuut per keer, geen meting). Alles blijft op het toestel.
Onder Instellingen (optioneel achter een pincode van 4 cijfers) staan schakelaars voor Reels,
Verkennen, voorgestelde posts, Stories en "Alleen berichten". De schakelaars passen de regels uit
`rules.json` in Swift aan (`PlatformRules.applying`); de pincode staat als gezouten hash in
UserDefaults, dus de app opnieuw installeren zet hem terug. Bij de eerste start toont de app een
uitleg in vier pagina's.

## Installeren via TestFlight (zonder Xcode)

GitHub bouwt de app op een Mac in de cloud, ondertekent hem en zet hem in TestFlight.
Eenmalige voorbereiding, ongeveer een half uur. Alles gaat via de browser en
Terminal op je Mac.

### A. Apple Developer (developer.apple.com/account)

1. **Controleer je lidmaatschap.** Onder Membership details moet "Apple Developer
   Program" staan met een vervaldatum. Noteer je **Team ID** (10 tekens).
2. **Bundle ID registreren.** Certificates, IDs & Profiles > Identifiers > + > App IDs >
   App. Beschrijving `Zerophone`, Bundle ID *Explicit*: `nl.paulquist.zerophone`.
   Geen extra capabilities nodig.
3. **Certificaat.** Open Terminal in de map `signing` en draai
   `bash 1-maak-aanvraag.sh`. Ga naar Certificates > + > **Apple Distribution**, upload
   `~/Zerophone-signing/distribution.csr` en download het certificaat
   (`distribution.cer`). Draai dan `bash 2-maak-p12.sh ~/Downloads/distribution.cer`.
4. **Profiel.** Profiles > + > **App Store Connect** > kies App ID
   `nl.paulquist.zerophone` > kies je Apple Distribution-certificaat > naam
   `Zerophone App Store` > download. Draai
   `bash 3-profiel-naar-tekst.sh ~/Downloads/Zerophone_App_Store.mobileprovision`.

### B. App Store Connect (appstoreconnect.apple.com)

5. **App aanmaken.** Apps > + > Nieuwe app. Platform iOS, naam `Zerophone` (is die
   bezet, kies een variant; de naam in TestFlight mag afwijken van de app-naam op je
   beginscherm), taal Nederlands, Bundle ID `nl.paulquist.zerophone`, SKU `zerophone`.
6. **API-sleutel.** Gebruikers en toegang > Integraties > App Store Connect API >
   Team-sleutels > +. Naam `GitHub`, toegang **App Manager**. Noteer **Issuer ID** en
   **Key ID** en download het `.p8`-bestand (kan maar één keer).

### C. GitHub (repository > Settings > Secrets and variables > Actions)

7. Voeg deze secrets toe:

| Secret | Waarde |
|---|---|
| `APPLE_TEAM_ID` | Team ID uit stap 1 |
| `CERT_P12_BASE64` | inhoud van `~/Zerophone-signing/CERT_P12_BASE64.txt` |
| `CERT_PASSWORD` | inhoud van `~/Zerophone-signing/CERT_PASSWORD.txt` |
| `PROFILE_BASE64` | staat na stap 4 op je klembord |
| `ASC_KEY_ID` | Key ID uit stap 6 |
| `ASC_ISSUER_ID` | Issuer ID uit stap 6 |
| `ASC_KEY_P8` | volledige inhoud van het `.p8`-bestand, inclusief de BEGIN- en END-regel |

### D. Bouwen en installeren

8. Actions > **TestFlight** > Run workflow. Na ongeveer 10 minuten staat de build in
   App Store Connect; Apple verwerkt hem daarna nog 5 tot 30 minuten.
9. App Store Connect > je app > TestFlight > Interne tests > + groep > voeg jezelf
   toe. Installeer de app **TestFlight** op je iPhone en open de uitnodiging.

**Vrienden toevoegen:** TestFlight > Externe tests > nieuwe groep > publieke link.
De eerste build voor externe testers gaat langs een korte beoordeling door Apple.
Builds verlopen na 90 dagen; dan draai je de workflow opnieuw.

**Bewaar `~/Zerophone-signing` goed** (bijv. in je wachtwoordmanager of een versleutelde
schijf) en zet die map nooit in iCloud of GitHub. Kwijt is niet erg: dan maak je een
nieuw certificaat en profiel aan.

De workflow **Build IPA** bouwt alleen een ongesigneerde versie. Die is handig om snel
te zien of de code compileert, zonder secrets.

## De officiële apps afschermen (handmatig, voor nu)

Zonder deze stap tik je uit gewoonte toch weer op het Instagram-icoon.
Instellingen > Schermtijd > Applimieten > voeg Instagram en Snapchat toe met een
limiet van 1 minuut, en stel een Schermtijd-toegangscode in die iemand anders kiest.
In fase 2 bouwen we dit in de app zelf (FamilyControls).

## Als een filter niet meer werkt

Meta en Snap passen hun websites regelmatig aan. Alle regels staan in
`Zerophone/Resources/rules.json`; de code hoeft daarvoor niet te veranderen.
Na een wijziging aan `rules.json` of `filter.js` draait de workflow **Filtertests**
automatisch (lokaal: `cd tests && npm ci && npm test`).

### Debuggen met Safari Web Inspector (werkt met de TestFlight-build)

De webviews staan in de testfase op inspecteerbaar, dus je hebt geen Xcode nodig.

1. **iPhone:** Instellingen > Apps > Safari > Geavanceerd > zet **Webinspecteur** aan.
2. **Mac:** Safari > Instellingen > Geavanceerd > zet **Functies voor webontwikkelaars
   tonen** aan.
3. Sluit de iPhone met een kabel aan op de Mac en open Zerophone op de iPhone, op de
   tab die je wilt inspecteren.
4. Mac Safari: **Ontwikkel > [je iPhone] > Zerophone > instagram.com** (of
   snapchat.com). Er opent een inspector met elementen, console en netwerk.

In de console van die pagina:

- `window.__SV_classify('/reels/')` geeft terug wat de padregels met een pad doen
  (`allow`, `block` of `redirect`).
- `window.__SV_state()` toont het huidige pad, of de volgpoort dicht staat
  (`gateLocked`), wat de volgstatus is (`relation`: `stranger`, `followed`, `self` of
  `unknown`), welke videobewaking actief is (`guardMode`: `page`, `overlay` of `null`),
  of er al een eerste video is vastgelegd (`hasAnchor`), of er een scrollcontainer op
  slot staat (`scrollLocked`) en hoeveel elementen gemaskeerd zijn (`masked`).
- Gemaskeerde elementen hebben het attribuut `data-sv-masked`. Het element dat op slot
  staat, heeft in zijn inline stijl `overflow-y: hidden !important`.

Met de elementinspector zoek je nieuwe selectors; zet ze in `rules.json`.

**Voor de App Store:** `isInspectable` staat in `WebViewStore.swift` ook in Release aan.
Zet dat uit voordat de app naar de App Store gaat.

Later kun je `rules.json` online zetten (bijv. op GitHub) en de URL invullen in
`RulesStore.remoteURL`; verhoog dan `version` bij elke wijziging. De app haalt de
nieuwe regels op bij het starten.

## Bekende beperkingen

- Geen pushmeldingen voor DM's (een in-app browser kan geen web push ontvangen).
- Wat de websites niet kunnen, kan Zerophone ook niet. Snapchat for Web is vooral
  chat; snaps maken en Stories bekijken werkt beperkt.
- De Snapchat-regels zijn een beginpunt en moeten op een echte iPhone getest worden.

## Opbouw

```
project.yml              XcodeGen-projectdefinitie
CLAUDE.md                werkregels voor Claude-sessies in deze repo
.github/workflows/
  testflight.yml         ondertekende build + upload naar TestFlight
  build.yml              snelle ongesigneerde build (compileertest)
  filtertest.yml         jsdom-tests van filter.js en rules.json (Linux)
  status.yml             build-status in App Store Connect opvragen
  tester.yml             TestFlight-tester toevoegen
tests/                   jsdom-tests: cd tests && npm ci && npm test
docs/
  app-store.md           disclaimer, merkregels en risico's voor App Store en externe TestFlight
signing/                 scripts voor certificaat en profiel (stap 3 en 4)
Zerophone/
  Assets.xcassets        app-icoon
  ZerophoneApp.swift     app-start, haalt regels op
  ContentView.swift      tabs per platform, melding bovenin
  Platform.swift         URL's, user agents, teksten per platform
  WebViewStore.swift     de browser + alle blokkeerlogica
  FilterRules.swift      regelmodel en laden (meegeleverd of van server)
  Resources/
    filter.js            in elke pagina: CSS, tekstregels, volgpoort, videobewaking
                         (scrollslot, maskeren, terugscrollen), zoomslot, routes, klikken
    rules.json           selectors en paden per platform
```
