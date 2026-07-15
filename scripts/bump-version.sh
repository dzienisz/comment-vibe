#!/usr/bin/env bash
# Bumps the extension version in BOTH manifests together, so they never drift
# (scripts/package.sh and the release workflow refuse to build a mismatch).
# Does not touch CHANGELOG.md — write the release notes there by hand.
#
# Usage: scripts/bump-version.sh 1.3.0
set -euo pipefail

new="${1:-}"
if ! printf '%s' "$new" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "usage: scripts/bump-version.sh <major.minor.patch>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Portable in-place edit (BSD + GNU): rewrite via awk into a temp file. Only the
# first "version" line is touched, so nested keys are never affected.
for f in manifest.json manifest.firefox.json; do
  tmp="$(mktemp)"
  awk -v v="$new" '
    !done && /"version"[[:space:]]*:/ {
      sub(/"version"[[:space:]]*:[[:space:]]*"[^"]*"/, "\"version\": \"" v "\"")
      done = 1
    }
    { print }
  ' "$f" > "$tmp" && mv "$tmp" "$f"
  echo "  $f → $new"
done

cat <<EOF
✓ bumped to $new

Next steps for a release:
  1. Add a "## [$new]" section to CHANGELOG.md
  2. git commit -am "chore(release): $new"
  3. git tag -a v$new -m "v$new" && git push origin main --follow-tags
     → .github/workflows/release.yml builds both zips and publishes the release
EOF
