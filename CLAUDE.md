# CLAUDE.md

## Hard constraints

**No build tooling, no dependencies.** The extension ships raw files to Chrome. Do not introduce npm, a bundler, or any package manager. This is a deliberate design choice for privacy and simplicity.

**Maintain both Chrome AI API paths.** `content.js` and `popup.js` detect `LanguageModel` (standard global) and `window.ai.languageModel` (legacy namespace). Both paths must remain functional — different Chrome builds expose different namespaces depending on origin trial stage.

**Decisions API fast path.** Before the Prompt API, `content.js` asks Chrome's `DecisionModel` (developer trial, `chrome://flags/#decisions-api`) for the tone when it is present and its model is already `available` — never `create()` while `downloadable`, which needs a user gesture. Confident positive/neutral verdicts skip the Prompt API; everything else falls back to it. Feature-detect only; the API shape may change.

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
The popup's model-download states can be checked the same way with
`test/popup-harness.html` (serve the repo root): it loads the real
`popup.html` with a stubbed Prompt API. Modes: `?state=downloadable`,
`downloading`, `available`, `unavailable`; options `&start=0.4`,
`&duration=6000`, `&activation=required`, `&fail=1`, `&reattach=0.2`; `?browser=firefox`
(`&ffshape=bytes|unknown`, `&blocked=1` for AI controls blocking it, `&granted=1&blocked=1` for a popup reopened after that block) for the Firefox setup flow. Reload mid-download to
simulate reopening the popup.

CI runs `node --test` and a `scripts/package.sh` smoke test on every pull
request and push to `main` (`.github/workflows/test.yml`); the release
workflow runs the tests again before packaging.

Full manual testing on Chrome requires:
- Chrome 127+ (desktop only — no mobile support)
- Gemini Nano enabled via `chrome://flags/#optimization-guide-on-device-model` and `chrome://flags/#prompt-api-for-gemini-nano`
- Model downloaded: confirm at `chrome://components` → "Optimization Guide On Device Model"
- On Chrome 152+, _On-device AI_ on in `chrome://settings/ai` (146–151: `chrome://settings/system`). When it is off, `availability()` returns `unavailable`. Stable defaults it on; Beta/Dev/Canary 157+ default it off in a fresh profile

Full manual testing on Firefox requires:
- Firefox 134+ (on 134–139, set `browser.ml.enable` and `extensions.ml.enabled` to `true` in `about:config`; on by default since 140)
- AI features allowed in Settings → AI controls (Firefox 148+): blocking them sets `extensions.ml.enabled` to `false`, and `browser.trial.ml` then rejects with "Trial ML API is disabled"
- Package the Firefox zip (below) and load it via `about:debugging` → "Load Temporary Add-on"
- Click "Enable on-device AI" in the popup (grants `trialML`, downloads the classifier once)

Firefox AI playground: `playground-firefox/` is a separate, standalone
Firefox add-on (own gecko id, optional `trialML`) with one live demo per
`browser.trial.ml` task — not part of Comment Vibe and excluded from both store
zips. Firefox allows one trial.ml engine per extension run with no way to close
it, so switching task reloads the add-on (`browser.runtime.reload()`) and
`background.js` reopens the page on the chosen task. `styles.css` must stay a
byte-for-byte copy of `playground/styles.css` (`firefox.css` holds the
overrides); `test/playground-firefox.test.js` enforces it. Automating it in
real Firefox over WebDriver BiDi needs `--remote-allow-system-access` and
`user_pref("remote.prefs.recommended", false)`: the remote agent's recommended
prefs otherwise set `browser.ml.enable` to `false`, and the API reports
"Trial ML API is disabled".

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
   repo secrets are configured (Chrome: `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`,
   `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID` (Web Store API v2) — the old unprefixed names still
   work as a fallback; AMO: `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`;
   Edge: `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY` — setup links are
   in the workflow comments). Edge gets the Chrome zip unchanged via
   `scripts/publish-edge.js` (Edge Add-ons REST API, no deps). If Edge rejects the publish with `InProgressSubmission` (the previous version
   is still in certification), re-run only Edge later with the manual
   `.github/workflows/edge-publish.yml` (input: the tag). Without secrets those steps are
   skipped — upload the zips to the store dashboards manually. Store review
   still decides when users get it.

The standalone Firefox AI playground (`playground-firefox/`, own AMO id and version) is packaged
by `scripts/package-playground-firefox.sh` and signed by the manual workflow
`.github/workflows/playground-firefox.yml` (unlisted by default); its listing copy is in
`store-assets/playground-firefox/listing.md`.

Store listing text and promo images live in `store-assets/` — Chrome copy in
`store-assets/listing.md`, Firefox (AMO) copy in `store-assets/firefox/listing.md`,
Edge Add-ons copy + Partner Center answers in `store-assets/edge/listing.md`.

**Edge** runs the Chrome build. The Prompt API on Edge is a developer
preview, not on by default. Since Edge 158 (Stable included) the flag is
_Prompt API_ in `edge://flags` (`#edge-prompt-api`); the older
`edge-llm-prompt-api-for-*` flags are gone. Since 19 Nov 2026 the built-in
model is Aion Instruct (2.3B parameters), which replaced Phi-4-mini. With the
flag on, `LanguageModel` is exposed to extension pages and web pages —
checked on Edge Stable 158 on Linux (the globals appear in the popup and on a
page; no session was run there because that machine has no GPU). The last
real session, popup "Edge AI ready ✓" and a comment classified "Toxic", was on
Edge Dev 157 with the previous model. Hardware: Windows 10/11, macOS 13.3+ or
64-bit Linux with Vulkan drivers (Edge 159+), 3 GB VRAM, 20 GB disk (the
model is deleted under 5 GB), unmetered network, _Device performance class_
Medium+ in `edge://on-device-internals`. _On-device AI_ under Settings →
Copilot and AI must be on (off by default on Canary/Dev/Beta; enabling the
flag turns it on); orgs can disable the model
(`GenAILocalFoundationalModelSettings`, `ComponentUpdatesEnabled`). On a
Linux VM without a GPU ("GPU blocked" in on-device-internals) `availability()`
did not settle within 20 s — keep the timeouts.
Edge also has the Decisions API: `DecisionModel` behind the _Decisions API_
flag (`#edge-decisions-api`, present in Stable 158 although Microsoft
documents it for Canary), same shape as Chrome's, so the fast path needs no
Edge-specific code. Microsoft's Prompt API origin trial is documented for
HTTPS websites only, not for extensions. _Prerelease on-device language
model_ (`#edge-on-device-model-prerelease`) swaps in the prerelease model
component. Edge may also auto-disable unpacked "other
sources" extensions on restart — reload the unpacked extension before
testing. `popup.js` `isEdge()` swaps in the `#setup-edge` help; check it with
`test/popup-harness.html?browser=edge&state=none`.
Regenerate PNGs with `store-assets/render.sh` and `store-assets/firefox/render-firefox.sh`.
Store assets must never ship inside the extension zip (they aren't —
`scripts/package.sh` ships only an explicit allow-list).
