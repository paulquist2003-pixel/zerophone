#!/bin/bash
# Stap 1: maakt een privésleutel en een certificaataanvraag (CSR) voor Apple.
# Draai dit op je eigen Mac. De sleutel blijft in ~/Zerophone-signing en verlaat je Mac niet.
set -euo pipefail

OUT="$HOME/Zerophone-signing"
mkdir -p "$OUT"
chmod 700 "$OUT"

if [ -f "$OUT/distribution.key" ]; then
  echo "Er bestaat al een sleutel in $OUT. Verwijder die eerst als je opnieuw wilt beginnen."
  exit 1
fi

/usr/bin/openssl genrsa -out "$OUT/distribution.key" 2048 2>/dev/null
chmod 600 "$OUT/distribution.key"
/usr/bin/openssl req -new -key "$OUT/distribution.key" \
  -out "$OUT/distribution.csr" -subj "/CN=Zerophone Distribution/C=NL"

echo
echo "Klaar. Upload dit bestand bij Apple (Certificates > + > Apple Distribution):"
echo "  $OUT/distribution.csr"
open "$OUT"
