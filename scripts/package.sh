#!/usr/bin/env bash
# Builds the Chrome Web Store and Firefox (AMO) distribution packages and
# verifies each one contains exactly the right per-store file set.
#
# This is NOT a build step — the extension ships raw source files (see the
# "no build tooling" constraint in CLAUDE.md). This script only zips and
# stages the correct files, so releases are reproducible. It is run both
# locally and by .github/workflows/release.yml on a version tag.
#
# Usage:   scripts/package.sh
# Outputs: comment-vibe-<version>.zip          (Chrome Web Store, also Edge)
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

# ── What ships ────────────────────────────────────────────────────────────────
# Allow-list: ONLY the files named here go into a store package. Anything else
# in the working tree (docs, tests, the landing page, editor or agent folders,
# screenshots) can never leak in. A new runtime file must be added here; the
# verification below fails the build when a manifest or popup.html references
# a file that is not in the package.
RUNTIME_FILES=(content.js content.css popup.html popup.css popup.js rate-prompt.js jev.js LICENSE)
ICON_FILES=(icons/icon16.png icons/icon48.png icons/icon128.png)
# background.js is Firefox-only and must never ship to Chrome.
FIREFOX_ONLY_FILES=(background.js)

# build_zip <zip name> <manifest source> [extra root-level files...]
# Stages the allow-listed files in a temp dir, with the given manifest renamed
# to manifest.json (zip can't rename), and zips that dir.
build_zip() {
  local zip_name="$1" manifest="$2"
  shift 2
  local tmp
  tmp="$(mktemp -d)"
  mkdir "$tmp/icons"
  cp "${RUNTIME_FILES[@]}" "$@" "$tmp/"
  cp "${ICON_FILES[@]}" "$tmp/icons/"
  cp "$manifest" "$tmp/manifest.json"
  ( cd "$tmp" && zip -rq - . ) > "$ROOT/$zip_name"
  rm -rf "$tmp"
}

build_zip "$CHROME_ZIP" manifest.json
build_zip "$FF_ZIP" manifest.firefox.json "${FIREFOX_ONLY_FILES[@]}"

# ── Verify ────────────────────────────────────────────────────────────────────
# Each zip must contain exactly its expected file set — nothing missing and
# nothing extra — and the right manifest variant.
fail=0
ok()  { echo "  ✓ $1"; }
bad() { echo "  ✗ $1" >&2; fail=1; }

# One path per line, sorted, directories dropped.
zip_files()      { unzip -Z1 "$1" | grep -v '/$' | LC_ALL=C sort; }
expected_files() { printf '%s\n' "${RUNTIME_FILES[@]}" "${ICON_FILES[@]}" manifest.json "$@" | LC_ALL=C sort; }

check_file_set() {
  local zip_name="$1"
  shift
  local actual expected
  actual="$(zip_files "$zip_name")"
  expected="$(expected_files "$@")"
  if [ "$actual" = "$expected" ]; then
    ok "exact file set ($(wc -l <<<"$actual" | tr -d ' ') files)"
  else
    bad "unexpected file set in $zip_name (< expected, > actual):"
    diff <(echo "$expected") <(echo "$actual") >&2 || true
  fi
}

# Every local file the packaged manifest.json or popup.html points at must be
# in the zip — catches a runtime file that was never added to the allow-list.
check_references() {
  local zip_name="$1" actual refs ref missing=0
  actual="$(zip_files "$zip_name")"
  refs="$( { unzip -p "$zip_name" manifest.json | grep -oE '"[^":]+\.(js|css|html|png)"' | tr -d '"'
             unzip -p "$zip_name" popup.html | grep -oE '(src|href)="[^":]+\.(js|css|png)"' | cut -d'"' -f2
           } | LC_ALL=C sort -u )"
  for ref in $refs; do
    grep -qxF "$ref" <<<"$actual" || { bad "$zip_name: referenced file missing: $ref"; missing=1; }
  done
  [ "$missing" -eq 0 ] && ok "all referenced files present"
  return 0
}

chrome_manifest="$(unzip -p "$CHROME_ZIP" manifest.json)"
ff_manifest="$(unzip -p "$FF_ZIP" manifest.json)"

echo "Verifying $CHROME_ZIP:"
check_file_set "$CHROME_ZIP"
check_references "$CHROME_ZIP"
grep -q minimum_chrome_version <<<"$chrome_manifest" \
  && ok "Chrome manifest variant" || bad "Chrome manifest is not the Chrome variant"

echo "Verifying $FF_ZIP:"
check_file_set "$FF_ZIP" "${FIREFOX_ONLY_FILES[@]}"
check_references "$FF_ZIP"
grep -q '"gecko"' <<<"$ff_manifest" \
  && ok "Firefox gecko variant" || bad "Firefox manifest missing gecko settings"
grep -q data_collection_permissions <<<"$ff_manifest" \
  && bad "data_collection_permissions present (AMO warns below Firefox 140)" \
  || ok "no unsupported data_collection_permissions key"

if [ "$fail" -ne 0 ]; then echo "✗ package verification failed" >&2; exit 1; fi

echo
ls -lh "$CHROME_ZIP" "$FF_ZIP"
echo "✓ packages ready"
