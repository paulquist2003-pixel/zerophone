#!/bin/bash
# Stap 5: zet alle zeven secrets in één keer in GitHub, zodat je niets hoeft te kopiëren.
# Vereist de GitHub CLI (brew install gh). De eerste keer log je in via je browser.
set -euo pipefail

REPO="paulquist2003-pixel/zerophone"
OUT="$HOME/Zerophone-signing"

command -v gh >/dev/null || { echo "Installeer eerst de GitHub CLI: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https

for f in CERT_P12_BASE64.txt CERT_PASSWORD.txt PROFILE_BASE64.txt; do
  [ -f "$OUT/$f" ] || { echo "Ontbreekt: $OUT/$f. Doe eerst de stappen voor certificaat en profiel."; exit 1; }
done

read -r -p "Team ID (10 tekens): " TEAM
read -r -p "Key ID van de App Store Connect API-sleutel: " KEYID
read -r -p "Issuer ID: " ISSUER
DEFAULT_P8="$HOME/Downloads/AuthKey_${KEYID}.p8"
read -r -p "Pad naar het .p8-bestand [$DEFAULT_P8]: " P8
P8="${P8:-$DEFAULT_P8}"
P8="${P8/#\~/$HOME}"
[ -f "$P8" ] || { echo "Bestand niet gevonden: $P8"; exit 1; }

gh secret set APPLE_TEAM_ID   -R "$REPO" --body "$TEAM"
gh secret set ASC_KEY_ID      -R "$REPO" --body "$KEYID"
gh secret set ASC_ISSUER_ID   -R "$REPO" --body "$ISSUER"
gh secret set CERT_P12_BASE64 -R "$REPO" < "$OUT/CERT_P12_BASE64.txt"
gh secret set CERT_PASSWORD   -R "$REPO" < "$OUT/CERT_PASSWORD.txt"
gh secret set PROFILE_BASE64  -R "$REPO" < "$OUT/PROFILE_BASE64.txt"
gh secret set ASC_KEY_P8      -R "$REPO" < "$P8"

# De API-sleutel uit Downloads halen en bij de andere sleutels bewaren.
if [ "$(dirname "$P8")" != "$OUT" ]; then
  mv "$P8" "$OUT/"
  chmod 600 "$OUT/$(basename "$P8")"
fi

echo
echo "Alle zeven secrets staan in GitHub. Je sleutels staan in $OUT."
gh secret list -R "$REPO"
