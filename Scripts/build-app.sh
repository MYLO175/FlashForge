#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIGURATION="${CONFIGURATION:-release}"
APP_NAME="FlashForge"
APP_BUNDLE="$PROJECT_DIR/dist/$APP_NAME.app"
CONTENTS="$APP_BUNDLE/Contents"

cd "$PROJECT_DIR"
swift build -c "$CONFIGURATION"
BIN_DIR="$(swift build -c "$CONFIGURATION" --show-bin-path)"

rm -rf "$APP_BUNDLE"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

cp "$BIN_DIR/FlashForge" "$CONTENTS/MacOS/FlashForge"
cp "$PROJECT_DIR/Supporting/Info.plist" "$CONTENTS/Info.plist"
cp "$PROJECT_DIR/Assets/AppIcon.icns" "$CONTENTS/Resources/AppIcon.icns"

RESOURCE_BUNDLE="$BIN_DIR/FlashForge_FlashForgeApp.bundle"
if [[ ! -d "$RESOURCE_BUNDLE" ]]; then
    echo "Missing SwiftPM resource bundle: $RESOURCE_BUNDLE" >&2
    exit 1
fi
# Keep the package resources in the app's signed resource directory. The app
# locates this bundle explicitly to avoid toolchain-specific Bundle.module paths.
cp -R "$RESOURCE_BUNDLE" "$CONTENTS/Resources/"

xattr -cr "$APP_BUNDLE"
find "$APP_BUNDLE" -type d -exec xattr -d com.apple.FinderInfo {} \; 2>/dev/null || true
find "$APP_BUNDLE" -type d -exec xattr -d 'com.apple.fileprovider.fpfs#P' {} \; 2>/dev/null || true
xattr -d com.apple.FinderInfo "$APP_BUNDLE" 2>/dev/null || true
xattr -d 'com.apple.fileprovider.fpfs#P' "$APP_BUNDLE" 2>/dev/null || true
codesign --force --deep --sign - "$APP_BUNDLE"
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

echo "$APP_BUNDLE"
