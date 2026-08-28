#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_APP="$PROJECT_DIR/dist/FlashForge.app"
DESTINATION_APP="/Applications/FlashForge.app"

if [[ ! -d "$SOURCE_APP" ]]; then
    "$PROJECT_DIR/Scripts/build-app.sh"
fi

ditto --norsrc --noextattr "$SOURCE_APP" "$DESTINATION_APP"
xattr -cr "$DESTINATION_APP"
find "$DESTINATION_APP" -type d -exec xattr -d com.apple.FinderInfo {} \; 2>/dev/null || true
find "$DESTINATION_APP" -type d -exec xattr -d 'com.apple.fileprovider.fpfs#P' {} \; 2>/dev/null || true
xattr -d com.apple.FinderInfo "$DESTINATION_APP" 2>/dev/null || true
xattr -d 'com.apple.fileprovider.fpfs#P' "$DESTINATION_APP" 2>/dev/null || true
codesign --verify --deep --strict --verbose=2 "$DESTINATION_APP"
echo "$DESTINATION_APP"
