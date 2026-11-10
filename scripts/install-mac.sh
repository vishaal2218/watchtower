#!/usr/bin/env bash
# Install the extension for Premiere Pro / After Effects on macOS.
#
#   ./scripts/install-mac.sh            system-wide (/Library/...), asks for your password
#   ./scripts/install-mac.sh --user     this user only (~/Library/...), no password
#   add --debug to also install .debug (Chrome DevTools on localhost ports 8088-8095)
set -euo pipefail

BUNDLE_ID="watchtower.replica"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST_ROOT="/Library/Application Support/Adobe/CEP/extensions"
SUDO="sudo"
DEBUG=0

for arg in "$@"; do
  case "$arg" in
    --user) DEST_ROOT="$HOME/Library/Application Support/Adobe/CEP/extensions"; SUDO="" ;;
    --debug) DEBUG=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

DEST="$DEST_ROOT/$BUNDLE_ID"
$SUDO mkdir -p "$DEST_ROOT"
$SUDO rm -rf "$DEST"
$SUDO mkdir -p "$DEST"
for item in CSXS client host lib; do
  $SUDO cp -R "$SRC/$item" "$DEST/"
done
if [[ "$DEBUG" == "1" ]]; then
  $SUDO cp "$SRC/.debug" "$DEST/.debug"
fi

# The build is not signed, so CEP must be told to load unsigned extensions.
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

echo "Installed to: $DEST"
echo "Restart Premiere Pro / After Effects, then open Window > Extensions > Watchtower."
