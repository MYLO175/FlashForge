#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIGURATION="${CONFIGURATION:-release}"
APP_NAME="FlashForge"
APP_BUNDLE="$PROJECT_DIR/dist/$APP_NAME.app"
CONTENTS="$APP_BUNDLE/Contents"
BUILD_DIR="$PROJECT_DIR/.build"
ICONSET="$BUILD_DIR/AppIcon.iconset"

cd "$PROJECT_DIR"
swift build -c "$CONFIGURATION"
BIN_DIR="$(swift build -c "$CONFIGURATION" --show-bin-path)"

rm -rf "$APP_BUNDLE" "$ICONSET"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources" "$ICONSET"

cp "$BIN_DIR/FlashForge" "$CONTENTS/MacOS/FlashForge"
cp "$PROJECT_DIR/Supporting/Info.plist" "$CONTENTS/Info.plist"

RESOURCE_BUNDLE="$BIN_DIR/FlashForge_FlashForgeApp.bundle"
if [[ ! -d "$RESOURCE_BUNDLE" ]]; then
    echo "Missing SwiftPM resource bundle: $RESOURCE_BUNDLE" >&2
    exit 1
fi
cp -R "$RESOURCE_BUNDLE" "$CONTENTS/Resources/"

for spec in \
    "16 icon_16x16.png" \
    "32 icon_16x16@2x.png" \
    "32 icon_32x32.png" \
    "64 icon_32x32@2x.png" \
    "128 icon_128x128.png" \
    "256 icon_128x128@2x.png" \
    "256 icon_256x256.png" \
    "512 icon_256x256@2x.png" \
    "512 icon_512x512.png" \
    "1024 icon_512x512@2x.png"; do
    size="${spec%% *}"
    filename="${spec#* }"
    sips -z "$size" "$size" "$PROJECT_DIR/Assets/AppIcon.png" --out "$ICONSET/$filename" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/AppIcon.icns"
xattr -cr "$APP_BUNDLE"
find "$APP_BUNDLE" -type d -exec xattr -d com.apple.FinderInfo {} \; 2>/dev/null || true
find "$APP_BUNDLE" -type d -exec xattr -d 'com.apple.fileprovider.fpfs#P' {} \; 2>/dev/null || true
xattr -d com.apple.FinderInfo "$APP_BUNDLE" 2>/dev/null || true
xattr -d 'com.apple.fileprovider.fpfs#P' "$APP_BUNDLE" 2>/dev/null || true
codesign --force --deep --sign - "$APP_BUNDLE"
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

echo "$APP_BUNDLE"
