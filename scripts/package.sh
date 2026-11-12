#!/bin/sh
# Zips dist/ into the package uploaded to the Chrome Web Store.
set -eu

cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
out="lingtext-extension-${version}.zip"

rm -f "$out"
(cd dist && zip -qr -X "../$out" . -x ".vite/*")
echo "Created $out"
