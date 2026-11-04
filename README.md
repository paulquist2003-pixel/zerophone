# Zerophone (fase 1: Instagram en Snapchat zonder Reels en Spotlight)

Zerophone laadt Instagram en Snapchat via hun websites in een eigen browser en
filtert de korte-videofeeds eruit. DM's, je feed van mensen die je volgt, Stories,
zoeken en profielen blijven werken.

## Wat de app nu doet

| | Instagram | Snapchat |
|---|---|---|
| Geblokkeerd | Reels-feed, Verkennen-grid, hashtag- en locatiefeeds, voorgestelde posts | Spotlight-feed, Discover |
| Toegestaan | Feed, Stories, DM's, zoeken, profielen | Chat (Snapchat for Web) |
| Gedeelde video van een vriend | Bekijken mag, doorswipen niet | Bekijken mag, doorswipen niet |
| Overig | Video's spelen niet automatisch af; externe links openen in Safari; `instagram://`-links worden tegengehouden zodat je niet in de echte app belandt | Zelfde |

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

Debuggen: start de app vanuit Xcode, open op je Mac **Safari > Ontwikkel > [je iPhone]
> instagram.com**. In de console kun je `__SV_classify('/reels/')` testen en met de
elementinspector nieuwe selectors zoeken.

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
.github/workflows/
  testflight.yml         ondertekende build + upload naar TestFlight
  build.yml              snelle ongesigneerde build (compileertest)
signing/                 scripts voor certificaat en profiel (stap 3 en 4)
Zerophone/
  Assets.xcassets        app-icoon
  ZerophoneApp.swift     app-start, haalt regels op
  ContentView.swift      tabs per platform, melding bovenin
  Platform.swift         URL's, user agents, teksten per platform
  WebViewStore.swift     de browser + alle blokkeerlogica
  FilterRules.swift      regelmodel en laden (meegeleverd of van server)
  Resources/
    filter.js            in elke pagina: CSS, tekstregels, routes, klikken
    rules.json           selectors en paden per platform
```
