# CLAUDE.md

## Hard constraints

**No build tooling, no dependencies.** The extension ships raw files to Chrome. Do not introduce npm, a bundler, or any package manager. This is a deliberate design choice for privacy and simplicity.

**Maintain both Chrome AI API paths.** `content.js` and `popup.js` detect `LanguageModel` (standard global) and `window.ai.languageModel` (legacy namespace). Both paths must remain functional — different Chrome builds expose different namespaces depending on origin trial stage.

**Maintain the Firefox path.** When both Chrome globals are missing and `browser.runtime` exists, `content.js` delegates analysis to `background.js` over runtime messaging (`cv-status` / `cv-analyze` / `cv-warmup` / `cv-ml-ready`). `background.js` uses the Firefox WebExtensions AI API (`browser.trial.ml`, Firefox 134+, optional `trialML` permission) — it is background-only, runs a zero-shot classifier instead of a prompt LLM, and must never be referenced from the Chrome `manifest.json`. Chrome detection always wins over the Firefox path. `browser.trial.ml` is explicitly experimental: expect breaking renames across Firefox versions and guard with feature detection, not version checks.

**CSS `!important` is intentional.** All badge/tooltip rules use `!important` to survive conflicting site stylesheets. Do not remove them.

## Testing

Unit tests run with plain `node --test` from the repo root (no npm, no deps —
`test/content.test.js`, `test/background.test.js`). Badge/tooltip placement can
be checked without any AI model via `test/harness.html` (stubs the Prompt API
and the Firefox background service; open directly or serve the repo root).
Harness modes: `?api=modern` (default), `?api=legacy`, `?api=firefox` —
the firefox mode masks the real `LanguageModel` global that ships in current
Chrome, so it works on any browser.

Full manual testing on Chrome requires:
- Chrome 127+ (desktop only — no mobile support)
- Gemini Nano enabled via `chrome://flags/#optimization-guide-on-device-model` and `chrome://flags/#prompt-api-for-gemini-nano`
- Model downloaded: confirm at `chrome://components` → "Optimization Guide On Device Model"

Full manual testing on Firefox requires:
- Firefox 134+ (Nightly, or set `browser.ml.enable` and `extensions.ml.enabled` to `true` in `about:config`)
- Package the Firefox zip (below) and load it via `about:debugging` → "Load Temporary Add-on"
- Click "Enable on-device AI" in the popup (grants `trialML`, downloads the classifier once)

## Distribution

Packaging is scripted — do not hand-roll zip commands (they drift). These are
packaging scripts, not a build step: they only zip raw source files, so the
"no build tooling" constraint still holds.

- `scripts/package.sh` — builds **both** store zips from the current tree and
  verifies each contains the right files: `comment-vibe-<version>.zip` for the
  Chrome Web Store (Firefox manifest and `background.js` excluded) and
  `comment-vibe-firefox-<version>.zip` for addons.mozilla.org (`background.js`
  included, `manifest.firefox.json` staged in as `manifest.json`). Refuses to
  build if the two manifest versions disagree.
- `scripts/bump-version.sh X.Y.Z` — bumps `version` in **both** manifests together.

### Cutting a release

1. `scripts/bump-version.sh X.Y.Z`
2. Add a `## [X.Y.Z]` section to `CHANGELOG.md`.
3. Commit, then push a matching tag: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main --follow-tags`.
4. `.github/workflows/release.yml` fires on the `vX.Y.Z` tag, runs
   `scripts/package.sh`, extracts the changelog section for that version, and
   publishes a GitHub Release with both zips attached. (Manual fallback: run
   `scripts/package.sh` locally and upload the zips.)
5. The same workflow then submits each zip to its store for review, **if** the
   repo secrets are configured (Chrome: `CHROME_EXTENSION_ID`, `CLIENT_ID`,
   `CLIENT_SECRET`, `REFRESH_TOKEN`; AMO: `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` —
   setup links are in the workflow comments). Without secrets those steps are
   skipped — upload the zips to the store dashboards manually. Store review
   still decides when users get it.

Store listing text and promo images live in `store-assets/` — Chrome copy in
`store-assets/listing.md`, Firefox (AMO) copy in `store-assets/firefox/listing.md`.
Regenerate PNGs with `store-assets/render.sh` and `store-assets/firefox/render-firefox.sh`.
Store assets must never ship inside the extension zip (they aren't — see the
exclusions in `scripts/package.sh`).
