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

Zip for Chrome Web Store (package must contain only runtime files — manifest, content/popup scripts and styles, icon PNGs; the Firefox manifest and `background.js` stay out):

```
zip -r comment-vibe.zip . -x "*.DS_Store" -x "*.zip" -x "*.git*" -x ".claude/*" -x ".github/*" -x ".gitignore" -x "*.md" -x "store-assets/*" -x "playground/*" -x "test/*" -x "plans/*" -x "icons/make-icons.html" -x "manifest.firefox.json" -x "background.js"
```

Zip for Firefox (addons.mozilla.org) — same runtime files plus `background.js`, with `manifest.firefox.json` renamed to `manifest.json` (zip can't rename, so stage in a temp dir):

```
tmp=$(mktemp -d) && mkdir "$tmp/icons" \
  && cp content.js content.css popup.html popup.css popup.js background.js LICENSE "$tmp/" \
  && cp icons/icon16.png icons/icon48.png icons/icon128.png "$tmp/icons/" \
  && cp manifest.firefox.json "$tmp/manifest.json" \
  && (cd "$tmp" && zip -r - .) > comment-vibe-firefox.zip && rm -rf "$tmp"
```

Bump `version` in **both** `manifest.json` and `manifest.firefox.json` before packaging.

Store listing text and promo images live in `store-assets/` (regenerate PNGs with `store-assets/render.sh`). They must not ship inside the extension zip. Bump `version` in manifest.json before uploading a new package.
