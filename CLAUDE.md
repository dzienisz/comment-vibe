# CLAUDE.md

## Hard constraints

**No build tooling, no dependencies.** The extension ships raw files to Chrome. Do not introduce npm, a bundler, or any package manager. This is a deliberate design choice for privacy and simplicity.

**Maintain both Chrome AI API paths.** `content.js` and `popup.js` detect `LanguageModel` (standard global) and `window.ai.languageModel` (legacy namespace). Both paths must remain functional — different Chrome builds expose different namespaces depending on origin trial stage.

**CSS `!important` is intentional.** All badge/tooltip rules use `!important` to survive conflicting site stylesheets. Do not remove them.

## Testing

There is no automated test suite. Badge/tooltip placement can be checked without
Gemini Nano via `test/harness.html` (stubs the Prompt API; open directly or serve
the repo root). Full manual testing requires:
- Chrome 127+ (desktop only — no mobile support)
- Gemini Nano enabled via `chrome://flags/#optimization-guide-on-device-model` and `chrome://flags/#prompt-api-for-gemini-nano`
- Model downloaded: confirm at `chrome://components` → "Optimization Guide On Device Model"

## Distribution

Zip for Chrome Web Store (package must contain only runtime files — manifest, content/popup scripts and styles, icon PNGs):

```
zip -r comment-vibe.zip . -x "*.DS_Store" -x "*.zip" -x "*.git*" -x ".claude/*" -x ".github/*" -x ".gitignore" -x "*.md" -x "store-assets/*" -x "playground/*" -x "test/*" -x "icons/make-icons.html"
```

Store listing text and promo images live in `store-assets/` (regenerate PNGs with `store-assets/render.sh`). They must not ship inside the extension zip. Bump `version` in manifest.json before uploading a new package.
