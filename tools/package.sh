#!/bin/sh
# Builds the zip to upload to the Chrome Web Store and Edge Add-ons.
# Only the files the extension uses; manifest.json sits at the zip root.
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/voice-note-ducker-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"
zip -rq "$OUT" manifest.json background.js _locales content shared popup icons -x '*.DS_Store'
echo "Created $OUT"
