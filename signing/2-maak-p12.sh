#!/bin/bash
# Stap 2: combineert het certificaat van Apple met je sleutel tot een .p12-bestand
# en zet de waarden voor GitHub klaar.
# Gebruik: bash 2-maak-p12.sh ~/Downloads/distribution.cer
set -euo pipefail

OUT="$HOME/Zerophone-signing"
CER="${1:-$HOME/Downloads/distribution.cer}"

[ -f "$OUT/distribution.key" ] || { echo "Geen sleutel gevonden. Draai eerst 1-maak-aanvraag.sh."; exit 1; }
[ -f "$CER" ] || { echo "Certificaat niet gevonden: $CER"; exit 1; }

/usr/bin/openssl x509 -inform DER -in "$CER" -out "$OUT/distribution.pem"

# macOS-keychains lezen geen .p12 met de nieuwe OpenSSL 3-standaard; dan -legacy gebruiken.
LEGACY=""
if /usr/bin/openssl version | grep -q "^OpenSSL 3"; then LEGACY="-legacy"; fi

PASSWORD="$(/usr/bin/openssl rand -hex 16)"
/usr/bin/openssl pkcs12 -export $LEGACY \
  -inkey "$OUT/distribution.key" -in "$OUT/distribution.pem" \
  -out "$OUT/distribution.p12" -passout pass:"$PASSWORD"
chmod 600 "$OUT/distribution.p12"

base64 -i "$OUT/distribution.p12" > "$OUT/CERT_P12_BASE64.txt"
printf '%s' "$PASSWORD" > "$OUT/CERT_PASSWORD.txt"
chmod 600 "$OUT"/*.txt

echo
echo "Klaar. Plak in GitHub (Settings > Secrets and variables > Actions):"
echo "  CERT_P12_BASE64  = inhoud van $OUT/CERT_P12_BASE64.txt"
echo "  CERT_PASSWORD    = inhoud van $OUT/CERT_PASSWORD.txt"
echo
echo "Tip: 'pbcopy < $OUT/CERT_P12_BASE64.txt' zet de waarde op je klembord."
