#!/usr/bin/env bash
# Build a signed, ready-to-share copy of the extension for macOS.
#
#   ./scripts/build-release.sh
#
# Output: dist/Watchtower.zip   (give this to the user)
#         dist/watchtower.replica.zxp  (same signed package, for ZXP installers)
#
# Needs signing/ZXPSignCmd, signing/watchtower-cert.p12 and
# signing/cert-password.txt. Keep the signing folder private: anyone with the
# certificate and password can sign files as you.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIGN="$ROOT/signing"
DIST="$ROOT/dist"
BUNDLE_ID="watchtower.replica"
TSA_URL="http://timestamp.digicert.com"

for f in ZXPSignCmd watchtower-cert.p12 cert-password.txt; do
  [[ -f "$SIGN/$f" ]] || { echo "Missing signing/$f" >&2; exit 1; }
done
PASSWORD="$(cat "$SIGN/cert-password.txt")"

rm -rf "$DIST"
mkdir -p "$DIST/stage/$BUNDLE_ID" "$DIST/package"

# 1. Only what the extension needs at runtime.
for item in CSXS client host lib; do
  cp -R "$ROOT/$item" "$DIST/stage/$BUNDLE_ID/"
done
# Finder metadata and symlinks break signature checks on the user's machine.
find "$DIST/stage" -name '.DS_Store' -delete
if [[ -n "$(find "$DIST/stage" -type l)" ]]; then
  echo "Symlinks found in the package; replace them with real files." >&2
  exit 1
fi

# 2. Sign (with a trusted timestamp when the timestamp server is reachable).
ZXP="$DIST/$BUNDLE_ID.zxp"
if ! "$SIGN/ZXPSignCmd" -sign "$DIST/stage/$BUNDLE_ID" "$ZXP" "$SIGN/watchtower-cert.p12" "$PASSWORD" -tsa "$TSA_URL"; then
  echo "Timestamp server unavailable; signing without a timestamp." >&2
  "$SIGN/ZXPSignCmd" -sign "$DIST/stage/$BUNDLE_ID" "$ZXP" "$SIGN/watchtower-cert.p12" "$PASSWORD"
fi
"$SIGN/ZXPSignCmd" -verify "$ZXP"

# 3. The signed folder (a .zxp is a zip) plus instructions, zipped for sharing.
unzip -q "$ZXP" -d "$DIST/package/$BUNDLE_ID"
"$SIGN/ZXPSignCmd" -verify "$DIST/package/$BUNDLE_ID"
cp "$ROOT/scripts/INSTALL.txt" "$DIST/package/How to install.txt"
(cd "$DIST/package" && zip -qrX "$DIST/Watchtower.zip" "$BUNDLE_ID" "How to install.txt")

rm -rf "$DIST/stage"
echo "Ready: $DIST/Watchtower.zip"
