#!/bin/bash
# Stap 3: zet het provisioningprofiel om naar tekst voor het GitHub-secret PROFILE_BASE64.
# Gebruik: bash 3-profiel-naar-tekst.sh ~/Downloads/Zerophone_App_Store.mobileprovision
set -euo pipefail

OUT="$HOME/Zerophone-signing"
PROFILE="${1:?Geef het pad naar het .mobileprovision-bestand}"
[ -f "$PROFILE" ] || { echo "Profiel niet gevonden: $PROFILE"; exit 1; }

mkdir -p "$OUT"
base64 -i "$PROFILE" > "$OUT/PROFILE_BASE64.txt"
chmod 600 "$OUT/PROFILE_BASE64.txt"
pbcopy < "$OUT/PROFILE_BASE64.txt"

echo "Op je klembord gezet. Plak dit in GitHub als secret PROFILE_BASE64."
