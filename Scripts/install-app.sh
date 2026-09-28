#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_APP="$PROJECT_DIR/dist/FlashForge.app"
DESTINATION_APP="/Applications/FlashForge.app"
STAGING_APP="/Applications/.FlashForge.staging.$$.app"
BACKUP_APP="/Applications/.FlashForge.previous.$$.app"

cleanup() {
    if [[ -e "$BACKUP_APP" && ! -e "$DESTINATION_APP" ]]; then
        mv "$BACKUP_APP" "$DESTINATION_APP"
    fi
    rm -rf "$STAGING_APP"
}
trap cleanup EXIT

if [[ ! -d "$SOURCE_APP" ]]; then
    "$PROJECT_DIR/Scripts/build-app.sh"
fi

ditto --norsrc --noextattr "$SOURCE_APP" "$STAGING_APP"
xattr -cr "$STAGING_APP"
find "$STAGING_APP" -type d -exec xattr -d com.apple.FinderInfo {} \; 2>/dev/null || true
find "$STAGING_APP" -type d -exec xattr -d 'com.apple.fileprovider.fpfs#P' {} \; 2>/dev/null || true
xattr -d com.apple.FinderInfo "$STAGING_APP" 2>/dev/null || true
xattr -d 'com.apple.fileprovider.fpfs#P' "$STAGING_APP" 2>/dev/null || true
codesign --verify --deep --strict --verbose=2 "$STAGING_APP"

if [[ -e "$DESTINATION_APP" ]]; then
    mv "$DESTINATION_APP" "$BACKUP_APP"
fi

if ! mv "$STAGING_APP" "$DESTINATION_APP"; then
    if [[ -e "$BACKUP_APP" ]]; then
        mv "$BACKUP_APP" "$DESTINATION_APP"
    fi
    exit 1
fi

rm -rf "$BACKUP_APP"
trap - EXIT
codesign --verify --deep --strict --verbose=2 "$DESTINATION_APP"
echo "$DESTINATION_APP"
