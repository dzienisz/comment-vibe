#!/usr/bin/env bash
# Zips the standalone Firefox AI playground add-on (playground-firefox/) for
# addons.mozilla.org. Like scripts/package.sh this only zips raw files — no
# build step. Output: firefox-ai-playground-<version>.zip in the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/playground-firefox"
VERSION="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/manifest.json" | head -1)"
[ -n "$VERSION" ] || { echo "no version in playground-firefox/manifest.json" >&2; exit 1; }
ZIP="firefox-ai-playground-$VERSION.zip"

cd "$SRC"
rm -f "$ROOT/$ZIP"
zip -rq "$ROOT/$ZIP" . -x "*.DS_Store" -x "*.md"

list="$(unzip -l "$ROOT/$ZIP")"
for f in manifest.json background.js index.html app.js tasks.js styles.css firefox.css icon48.png icon128.png; do
  grep -q " $f\$" <<<"$list" || { echo "missing $f in $ZIP" >&2; exit 1; }
done
if grep -qE '\.md$' <<<"$list"; then echo "$ZIP must not contain markdown" >&2; exit 1; fi

ls -lh "$ROOT/$ZIP" | awk '{print $5, $9}'
echo "✓ $ZIP ready"
