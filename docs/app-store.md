# App Store en externe TestFlight: disclaimer, merken en risico's

Werkdocument voor het moment dat we teksten schrijven voor de App Store of voor externe
TestFlight-testers (vrienden). Nog **niet** toegepast in de app of in App Store Connect.
Opgesteld op 5 november 2026 na onderzoek naar SocialLite en vergelijkbare apps.

Geen juridisch advies. Paul beoordeelt de teksten zelf voordat ze live gaan.

---

## 1. Disclaimer (concept)

### Nederlands
> Zerophone is niet gelieerd aan, goedgekeurd door of gesponsord door Instagram, Meta Platforms,
> Snapchat of Snap Inc. Instagram en Snapchat zijn merken van hun respectieve eigenaren.
> Zerophone toont de openbare websites van deze diensten in een eigen browser. Je logt in op hun
> eigen inlogpagina; Zerophone slaat geen wachtwoorden op en stuurt geen gegevens naar eigen
> servers. Je gebruik van deze diensten blijft vallen onder hun eigen voorwaarden.

### English
> Zerophone is not affiliated with, endorsed by, or sponsored by Instagram, Meta Platforms,
> Snapchat, or Snap Inc. Instagram and Snapchat are trademarks of their respective owners.
> Zerophone displays the public websites of these services in its own browser. You sign in on
> their own login page; Zerophone does not store passwords or send data to its own servers.
> Your use of these services remains subject to their own terms.

### Waar plaatsen
| Plek | Wanneer | Opmerking |
|---|---|---|
| App Store-beschrijving (onderaan) | Bij indienen voor de App Store | Friendly Social Browser doet dit ook, met merkvermelding. |
| Beta App Description (externe TestFlight) | Bij de eerste externe testgroep | Korte versie volstaat. |
| Info- of instellingenscherm in de app | Vóór externe distributie | Bestaat nog niet; vereist een kleine Swift-wijziging en een nieuwe build. |
| Voorwaarden (Terms) op een website | Bij de App Store | Zie clausules hieronder. Een website/URL bestaat nog niet. |

### Clausules voor de voorwaarden (concept, naar voorbeeld van SocialLite)
- Zerophone is niet gelieerd aan de genoemde platforms (zie disclaimer).
- Je gebruik van een platform via Zerophone valt onder de voorwaarden van dat platform; je
  stemt ermee in die voorwaarden niet te schenden.
- Zerophone is niet verantwoordelijk voor schorsing of blokkering van je account door een
  platform.
- De app wordt geleverd "zoals hij is", zonder garanties; aansprakelijkheid beperkt voor zover de
  wet toestaat. (Formulering laten toetsen; Nederlands/EU-consumentenrecht wijkt af van de
  Amerikaanse voorbeelden.)

---

## 2. Naam, icoon en metadata

- **App-naam, ondertitel en icoon:** geen "Instagram", "Snapchat", "Reels", "Spotlight", "Meta"
  en geen logo's of herkenbare huisstijl. Regel 4.1(c) van de App Store Review Guidelines
  verbiedt het merk of de productnaam van een ander in je icoon of naam zonder toestemming.
- **Zoekwoorden (keywords):** geen merknamen van anderen. Volgens mij staat dit in regel 2.3.7
  (geen "trademarked terms, popular app names" in metadata); **nog controleren** in de actuele
  richtlijnen.
- **Beschrijving:** de diensten mogen beschrijvend genoemd worden ("werkt met de websites van
  Instagram en Snapchat"), samen met de disclaimer.
- **Waarom dit ertoe doet:** Meta handhaaft zijn merken actief. In 2024 liet Meta de app "Reely"
  uit Google Play halen met een beroep op het merk "Reels" (de ontwikkelaar procedeert daartegen).
  SocialLite gebruikt "Block Reels&Shorts" in de titel en "No Reel For Instagram" het woord
  Instagram; dat is meer risico dan nodig.
- **In de app zelf** staan nu de tablabels "Instagram" en "Snapchat" en de meldingen "Reels en
  Verkennen staan uit" / "Spotlight en Discover staan uit" (`Platform.swift`). Dat is beschrijvend
  gebruik binnen de app; vergelijkbaar met wat Friendly en SocialLite doen. Geen logo's toevoegen.

---

## 3. Technische keuzes die het risico laag houden (zo houden)

Deze lijn scheidt de apps die nog in de App Store staan van de app die werd verwijderd:

- Alleen de **officiële website** laden in een WKWebView; **geen** nagemaakte of interne API.
  Tegenvoorbeeld: The OG App (2022) bootste de Android-API van Instagram na, toonde Instagram
  zonder advertenties en Reels, en werd na klachten van Meta binnen een week uit de App Store
  gehaald; Meta blokkeerde de accounts van het team.
- Inloggen gebeurt op de **inlogpagina van het platform**; geen wachtwoorden opslaan.
- **Geen gegevens** naar eigen servers; alle filtering lokaal.
- **Geen downloaden** of opslaan van video's of foto's van de platforms (regel 5.2.3).
- Geen merknamen of logo's in naam, icoon en metadata (zie 2).

---

## 4. Risico's die blijven

- **Geen toestemming van Meta of Snap.** Regel 5.2.2: als een app content van een andere dienst
  toont, moet dat volgens de voorwaarden van die dienst zijn toegestaan; "Authorization must be
  provided upon request." Geen van de onderzochte apps heeft voor zover gevonden toestemming; ze
  worden gedoogd. Friendly Social Browser staat er al sinds ongeveer 2010.
- **Voorwaarden van Instagram en Snap.** Uit kennis, niet opnieuw gecontroleerd: Instagram
  verbiedt toegang "in unauthorized ways" en het maken van afgeleide werken. Of een browser die de
  site anders weergeeft daaronder valt, is een grijze zone. De voorwaarden zelf nalezen vóór
  indienen (https://help.instagram.com/581066165581870 en https://snap.com/en-US/terms).
- **Meta kan de website slechter laten werken in ingebouwde browsers.** Chimbori (2021): Facebook
  en Instagram werden traag en kapot in de Hermit-browser, met meldingen dat inloggen "from an
  embedded browser" was uitgeschakeld.
- **Persoonlijk account van de maker.** Facebook bande in 2021 de maker van "Unfollow Everything"
  permanent; een rechtszaak om zo'n tool vooraf veilig te laten verklaren werd in november 2024
  afgewezen (mag opnieuw worden ingediend). Het risico groeit met de zichtbaarheid van de app.
- **Regel 4.2 (meer dan een verpakte website)** en **4.3(b) (niet te onderscheiden van wat al
  breed beschikbaar is)**: vooral relevant bij de App Store. Onderscheid met SocialLite is nog een
  open vraag; fase 2 (Schermtijd voor de officiële apps) kan dat zijn, al doet snowscroll iets
  vergelijkbaars.
- **Privacybeleid:** nodig voor de App Store; of het voor externe TestFlight verplicht is, is nog
  niet gecontroleerd. Er bestaat nog geen privacybeleid of website.

---

## 5. Vergelijkbare apps (stand 5 november 2026)

| App | Aanpak | Disclaimer / juridische aanpak | Bijzonderheden |
|---|---|---|---|
| SocialLite (Sociallite LLC) | Websites in eigen browser (Instagram, YouTube) | In de voorwaarden: "not affiliated with, endorsed by, or sponsored by"; gebruik valt onder platformvoorwaarden; niet aansprakelijk voor bans. Niet in de App Store-tekst. | ~17K beoordelingen (4,7); abonnement; "Block Reels&Shorts" in de titel |
| Friendly Social Browser (Friendly Inc. / Sensor Tower) | Webcontainer per dienst (Facebook, Instagram, Snap, X e.a.) | In de App Store-tekst: niet gelieerd aan Facebook, merken van Facebook | Sinds ca. 2010; ~84K beoordelingen; heeft ook een adblocker |
| snowscroll | Website in eigen browser + Schermtijd-shield dat tikken op het Instagram-icoon omleidt | Geen juridische uitspraken op de productpagina; "We have not seen accounts locked" | $49,99 per jaar; lijkt op Zerophone fase 2 |
| Sociano | Website in eigen browser + optioneel Schermtijd | Niets op de productpagina; noemt de aanpak "App Store-safe" | |
| Awhile (ARCKONE SRL, België) | Website in eigen browser | Niets op de productpagina; inloggen op Instagram's eigen pagina | |
| No Reel For Instagram (G. Claverie) | Safari-extensie op instagram.com | Geen disclaimer; "Instagram" in de naam | Eenmalig $3,39 |
| SocialGuard | Zie ZEROPHONE_CONTEXT.md | Niet onderzocht (pagina niet geopend) | |

Disclaimer-teksten op de productpagina's van Sociano, Awhile en snowscroll ontbraken; hun
voorwaarden zijn niet gelezen.

---

## 6. Bronnen
- App Store Review Guidelines (4.1, 4.2, 4.3, 5.2.2, 5.2.3, 2.2): https://developer.apple.com/app-store/review/guidelines/
- TestFlight overview (Apple): https://www.developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview
- SocialLite App Store: https://apps.apple.com/us/app/socialliteapp/id6757661674
- SocialLite site en voorwaarden: https://sociallite.app/instagram-without-reels/ , https://sociallite.app/terms
- Friendly Social Browser: https://apps.apple.com/app/apple-store/id400169658
- snowscroll: https://snowscroll.com/block-instagram-reels
- Sociano: https://sociano.app/instagram-without-reels/
- Awhile: https://awhile.app/instagram-without-reels/
- No Reel For Instagram: https://apps.apple.com/us/app/no-reel-for-instagram/id6752605548
- The OG App verwijderd: https://www.neowin.net/news/apple-removes-ad-free-instagram-client-from-app-store-following-complaints-from-meta/
- Reely vs. Meta/Google (merk Reels): https://news.bloomberglaw.com/ip-law/developer-sues-google-meta-over-enforcement-of-reels-trademarks
- Chimbori over ingebouwde browsers: https://chimbori.com/updates/facebook-deteriorated-experience
- Unfollow Everything / Zuckerman v. Meta: https://www.engadget.com/social-media/researchers-unfollow-everything-lawsuit-against-meta-gets-dismissed-133051131.html
- Snapchat over onofficiële apps: https://www.phonearena.com/news/Snapchat-threatens-to-lock-user-accounts-if-they-use-3rd-party-apps_id62878
