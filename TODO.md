# TODO / Roadmap

Working notes for what's next. Shipped history lives in `CHANGELOG.md`; this
file is only the forward look. Current release: **v1.2.1** (Chrome + Firefox).

## State of play

- **Chrome** (Prompt API / Gemini Nano): tone badge, streaming, kinder rewrites,
  multilingual output. Stable path.
- **Firefox** (WebExtensions AI API / `browser.trial.ml`): tone badge only —
  zero-shot classifier via `background.js`, no rewrite/streaming/translation
  (the API exposes classification, not generation). Delegated from `content.js`.
- **Tests**: `node --test` (`test/content.test.js`, `test/background.test.js`)
  plus `test/harness.html` (`?api=modern|legacy|firefox`).
- **Release**: `scripts/bump-version.sh` → edit `CHANGELOG.md` → commit → push a
  `vX.Y.Z` tag → `.github/workflows/release.yml` builds both zips (via
  `scripts/package.sh`) and publishes the GitHub Release.

## Shippable UX (no new API needed)

- [ ] **Keyboard shortcut** to trigger analysis on demand (bypass the 900 ms debounce).
- [ ] **Better "AI unavailable" content-script state.** The popup now explains
      setup on both browsers, but in-page the badge still silently never appears
      when the model is unavailable. A one-time, dismissible hint near a focused
      comment box would help adoption.
- [ ] **Firefox: honest first-run download feedback in-page.** The popup shows
      model-download progress, but the very first `cv-analyze` after enabling can
      be slow; consider a "Preparing…" badge state on the Firefox path too
      (Chrome already has one via `getModelStatus`).

## Store / distribution

- [ ] **`<all_urls>` justification** for both stores — it's the most common
      review flag. Draft a short rationale (passive support on any comment box)
      and keep it with the listing copy.
- [ ] **Firefox AMO listing** — once approved, add the install badge/link to
      `README.md` (mirrors the existing Chrome Web Store badge).
- [ ] Decide whether to keep `minimum_chrome_version: 127`. Keeping it preserves
      the legacy `window.ai` path (a CLAUDE.md hard constraint); the store copy
      already frames 138 as the flag-free line, so this is currently intentional,
      not a bug. Revisit only if the legacy path is ever dropped.

## Park until the APIs go stable (don't build against trials)

- [ ] **Rewriter API** (developer trial) — replace the raw Prompt rewrite once stable.
- [ ] **Proofreader API** (origin trial) — grammar/spelling layer.
- [ ] **Multimodal Prompt input** — analyse pasted screenshots.
- **Why:** building against pre-stable APIs means throwaway code plus mandatory
  fallbacks. No value in polling release channels for these.

## Lower priority — perf

- [ ] Throttle `scanPage()`; it re-runs on every MutationObserver batch, which can
      get expensive on busy SPAs (X/Twitter, infinite feeds). Not yet a felt problem.
