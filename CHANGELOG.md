# Changelog

All notable changes to **Comment Vibe** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.5] - 2026-07-19

### Changed

- **Firefox: tone analysis now works in ~100 languages, not just English.**
  The zero-shot classifier was swapped from the English-only
  `Xenova/distilbert-base-uncased-mnli` to the multilingual
  `Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7` (q8), and the
  candidate labels/hypothesis were re-tuned for the new model. On a mixed
  English+Polish sample set accuracy improved from 7/16 to 11/16, and
  non-English positive comments no longer collapse to "negative". Trade-off:
  the one-time model download grows from ~65 MB to ~340 MB and inference is
  slightly slower (still well under a second). Verified live on Firefox 152
  with Polish input.
- Firefox: the background now pre-downloads the model right after an
  install/update (when the `trialML` permission is already granted), so a
  model swap doesn't stall the first in-page analysis behind a full download.

## [1.2.4] - 2026-07-19

### Changed

- Release engineering only — the shipped extension is identical to 1.2.3.
  The release workflow now also submits the packaged zips to the Chrome Web
  Store and addons.mozilla.org for review automatically on every `vX.Y.Z`
  tag (skipped when the store API secrets are absent). This version is the
  first store submission carrying the 1.2.3 Firefox event-page fix.

## [1.2.3] - 2026-07-19

### Fixed

- **Firefox: analysis no longer breaks permanently after the background event
  page is suspended.** Firefox keeps the `browser.trial.ml` engine in the
  parent process, where it outlives the MV3 background event page. After the
  event page idled out (~30s) and was rewoken by the next analysis request,
  its fresh `createEngine` call rejected with "Engine already created", every
  subsequent analysis failed, and the badge showed "Analyzing…" then vanished
  until Firefox was restarted. That rejection is now treated as an existing,
  ready engine (`runEngine` transparently revives one closed for inactivity).
  Verified end-to-end on Firefox 152 with the real on-device model.

## [1.2.2] - 2026-07-16

### Changed

- Release engineering only — no changes to the shipped extension (the packaged
  Chrome and Firefox zips are byte-for-byte equivalent to 1.2.1). Packaging is
  now scripted and reproducible: `scripts/package.sh` builds and verifies both
  store zips, `scripts/bump-version.sh` keeps the two manifest versions in sync,
  and a GitHub Actions workflow publishes a release with both zips on every
  `vX.Y.Z` tag. Completed planning scaffolding was removed and the roadmap notes
  refreshed.

## [1.2.1] - 2026-07-15

### Changed

- Removed the `data_collection_permissions` manifest key from the Firefox
  package. It requires Firefox 140+, but the add-on's `strict_min_version` is
  134, so AMO flagged it as unsupported for the declared range. The "no data
  collection" declaration is made through the addons.mozilla.org listing
  instead, which applies to every supported Firefox version.
- Added an MIT `LICENSE` file, matching the project's open-source description.

## [1.2.0] - 2026-07-15

### Added

- **Firefox support** via the WebExtensions AI API (`browser.trial.ml`,
  Firefox 134+). Firefox has no Prompt API, so a new `background.js` runs a
  zero-shot classifier (`Xenova/distilbert-base-uncased-mnli`, Transformers.js)
  over the same four tone categories, and the content script delegates to it
  over runtime messaging when the Chrome AI globals are missing. Differences
  from the Chrome path: no streaming (the badge fills in when classification
  finishes), no generated rewrite suggestions, and no output translation.
- Popup onboarding for Firefox: an "Enable on-device AI" button requests the
  optional `trialML` permission, warms the model with download progress, and
  wakes content scripts in already-open tabs (`cv-ml-ready`).
- `manifest.firefox.json` — the Firefox package manifest (gecko id, event-page
  background script, `trialML` optional permission). The Chrome manifest and
  package are unchanged; `background.js` and the Firefox manifest are excluded
  from the Chrome zip.
- Test coverage: `test/background.test.js`, Firefox-path cases in
  `test/content.test.js`, and a `?api=firefox` mode in `test/harness.html`.

## [1.1.4] - 2026-07-15

### Fixed

- Analysis no longer hangs indefinitely if a model call stalls: a bounded
  give-up timer now clears the badge (30s once the model is ready, 5 minutes
  while it's still downloading, since a real first-run download can
  legitimately take that long).
- The badge now shows an honest "Preparing AI model…" state while the
  on-device model is still downloading, instead of a misleading "Analyzing…"
  spinner that looked stuck.

## [1.1.3] - 2026-07-11

### Fixed

- Editing, shortening, clearing, or removing a comment now cancels pending work
  and prevents stale analysis results from reappearing.
- Model output is normalized before rendering so malformed fields and unsafe
  emoji values cannot inject markup or break the badge and tooltip.
- Dynamic comment-box discovery now scans only added DOM subtrees, cleans up
  removed editors and listeners, and keeps editors working when SPAs move them.
- Tooltip dismissal now uses one document listener instead of leaking one
  listener per tracked editor.
- Modern Prompt API analyses reuse one bounded base session and destroy a fresh
  clone per request. Legacy and no-clone builds now use a fresh, destroyed
  session per analysis, including concurrent requests and failure paths.

## [1.1.2] - 2026-07-11

### Fixed

- Badge placement: the tone badge no longer covers typed text. It now sits above
  the input's top-right corner, flips below when there is no room at the top of
  the viewport, follows scrolling inside nested containers, and repositions as
  the input grows while typing.
- Analysis no longer slows down over time. Few-shots are kept in `initialPrompts`
  and each analysis runs on a fresh `clone()` of the session, preventing context
  growth and quota overflow.
- Analysis now streams via `promptStreaming()`: the badge renders as soon as the
  sentiment is available, while the reason and rewrite fill the tooltip when
  generation finishes.

## [1.1.1] - 2026-07-08

### Changed

- Store listing refresh: benefit-first manifest description ("See how your
  comment sounds before you post…"), new detailed description, and a full set
  of promo images (5 screenshots + small/marquee tiles) generated from HTML
  sources in `store-assets/` via `store-assets/render.sh`.
- The Web Store zip is now minimal: docs, `playground/`, `store-assets/`, and
  `icons/make-icons.html` are excluded from the package. No functional changes.

## [1.1.0] - 2026-06-14

### Added

- **Multilingual output.** Comments are now language-detected with the
  **Language Detector API**, and when the comment isn't in English the badge
  label, the reason, and the rewrite suggestion are translated into the
  comment's language with the **Translator API**. The rewrite therefore comes
  back ready to paste in the language you're writing in. Both APIs are stable
  in Chrome 138+. Detection and translation are best-effort: if the APIs, a
  model download, or a specific language pair are unavailable, the original
  English result is shown unchanged.

### Changed

- README rewritten to reflect that the Prompt API is **stable for Chrome
  Extensions since Chrome 138**. The `chrome://flags` setup is now documented
  only as a fallback for older builds (Chrome 127–137) rather than the default
  path, and a status table covers all built-in AI APIs.

## [1.0.0] - 2026-05-14

### Added

- Initial release. On-device tone analysis (positive / neutral / negative /
  toxic) of comments via Chrome's built-in Prompt API (Gemini Nano), with a
  kinder one-click rewrite suggestion for negative and toxic comments. Works on
  LinkedIn, X/Twitter, and YouTube, plus generic `contenteditable` and
  `textarea` comment fields across other sites. All analysis runs locally — no
  data leaves the device.
