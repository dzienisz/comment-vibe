#!/usr/bin/env bash
# Builds the Chrome Web Store and Firefox (AMO) distribution packages and
# verifies each one contains the right per-store file set.
#
# This is NOT a build step — the extension ships raw source files (see the
# "no build tooling" constraint in CLAUDE.md). This script only zips and
# stages the correct files, so releases are reproducible. It is run both
# locally and by .github/workflows/release.yml on a version tag.
#
# Usage:   scripts/package.sh
# Outputs: comment-vibe-<version>.zip          (Chrome Web Store)
#          comment-vibe-firefox-<version>.zip  (addons.mozilla.org)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Portable version read (works with BSD and GNU userland): strip spaces, quotes
# and commas from the first "version" line, then take the value after the colon.
read_version() { grep '"version"' "$1" | head -1 | tr -d ' ",' | cut -d: -f2; }

VERSION="$(read_version manifest.json)"
FF_VERSION="$(read_version manifest.firefox.json)"

if [ "$VERSION" != "$FF_VERSION" ]; then
  echo "✗ version mismatch: manifest.json=$VERSION manifest.firefox.json=$FF_VERSION" >&2
  echo "  bump both together with scripts/bump-version.sh" >&2
  exit 1
fi
echo "Packaging Comment Vibe $VERSION"

CHROME_ZIP="comment-vibe-$VERSION.zip"
FF_ZIP="comment-vibe-firefox-$VERSION.zip"
rm -f "$CHROME_ZIP" "$FF_ZIP"

# ── Chrome Web Store ──────────────────────────────────────────────────────────
# Everything except docs, dev/test tooling, store assets, and the Firefox-only
# files (background.js and the Firefox manifest must never ship to Chrome).
zip -rq "$CHROME_ZIP" . \
  -x "*.DS_Store" -x "*.zip" -x "*.git*" -x ".claude/*" -x ".github/*" \
     -x ".gitignore" -x "*.md" -x "store-assets/*" -x "playground/*" \
     -x "test/*" -x "plans/*" -x "scripts/*" -x "icons/make-icons.html" \
     -x "manifest.firefox.json" -x "background.js"

# ── Firefox (addons.mozilla.org) ──────────────────────────────────────────────
# Same runtime files plus background.js, with the Firefox manifest renamed to
# manifest.json (zip can't rename, so stage in a temp dir).
tmp="$(mktemp -d)"
mkdir "$tmp/icons"
cp content.js content.css popup.html popup.css popup.js background.js LICENSE "$tmp/"
cp icons/icon16.png icons/icon48.png icons/icon128.png "$tmp/icons/"
cp manifest.firefox.json "$tmp/manifest.json"
( cd "$tmp" && zip -rq - . ) > "$ROOT/$FF_ZIP"
rm -rf "$tmp"

# ── Verify ────────────────────────────────────────────────────────────────────
# Match against captured output with here-strings, never `cmd | grep -q`: under
# `set -o pipefail` an early grep match closes the pipe and the producer takes a
# SIGPIPE, which would be reported as a (false) verification failure.
fail=0
ok()  { echo "  ✓ $1"; }
bad() { echo "  ✗ $1" >&2; fail=1; }
listing_has() { grep -qE "[[:space:]]$2\$" <<<"$1"; }

chrome_list="$(unzip -l "$CHROME_ZIP")"
chrome_manifest="$(unzip -p "$CHROME_ZIP" manifest.json)"
ff_list="$(unzip -l "$FF_ZIP")"
ff_manifest="$(unzip -p "$FF_ZIP" manifest.json)"

echo "Verifying $CHROME_ZIP:"
listing_has "$chrome_list" "manifest.json"         && ok "manifest.json"           || bad "missing manifest.json"
listing_has "$chrome_list" "content.js"            && ok "content.js"              || bad "missing content.js"
listing_has "$chrome_list" "LICENSE"               && ok "LICENSE"                 || bad "missing LICENSE"
listing_has "$chrome_list" "background.js"         && bad "background.js must be Firefox-only" || ok "no background.js"
listing_has "$chrome_list" "manifest.firefox.json" && bad "manifest.firefox.json leaked in"    || ok "no manifest.firefox.json"
grep -q minimum_chrome_version <<<"$chrome_manifest" \
  && ok "Chrome manifest variant" || bad "Chrome manifest is not the Chrome variant"

echo "Verifying $FF_ZIP:"
listing_has "$ff_list" "manifest.json" && ok "manifest.json"  || bad "missing manifest.json"
listing_has "$ff_list" "background.js" && ok "background.js"  || bad "missing background.js"
listing_has "$ff_list" "LICENSE"       && ok "LICENSE"        || bad "missing LICENSE"
grep -q '"gecko"' <<<"$ff_manifest" \
  && ok "Firefox gecko variant" || bad "Firefox manifest missing gecko settings"
grep -q data_collection_permissions <<<"$ff_manifest" \
  && bad "data_collection_permissions present (AMO warns below Firefox 140)" \
  || ok "no unsupported data_collection_permissions key"

if [ "$fail" -ne 0 ]; then echo "✗ package verification failed" >&2; exit 1; fi

echo
ls -lh "$CHROME_ZIP" "$FF_ZIP"
echo "✓ packages ready"
