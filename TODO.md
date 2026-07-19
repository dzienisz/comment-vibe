# TODO / Roadmap

Working notes for what's next. Shipped history lives in `CHANGELOG.md`; this
file is only the forward look. Current release: **v1.2.3** (Chrome + Firefox).

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

## Visibility / marketing (started 2026-07-19)

- [x] **Landing page** — `site/` deploys to https://dzienko.dev/comment-vibe/
      (playground moved to `/playground/`). Interactive simulated demo, both
      store CTAs, SEO/OG tags.
- [ ] **Store title ASO** — apply "Comment Vibe — AI Comment Tone Checker":
      AMO via dashboard (no re-upload needed), Chrome with the next version
      upload (title comes from the manifest `name`). Proposals recorded in both
      `store-assets/*listing.md` files.
- [ ] **Fire the posts** — drafts ready in `promo/posts.md`: Show HN,
      r/firefox (API experience report), r/SideProject, dev.to long-form,
      social (EN/PL), and a follow-up comment for issue #1. One channel at a
      time, Tue–Thu mornings US.
- [ ] **Mozilla feedback loop** — post the `browser.trial.ml` experience report
      where Mozilla collects API feedback; being their real-world example is
      durable visibility.
- [ ] **Product Hunt** — hold until the ASO title change lands, then launch
      with store-assets gallery.

## Store / distribution

- [ ] **`<all_urls>` justification** for both stores — it's the most common
      review flag. Draft a short rationale (passive support on any comment box)
      and keep it with the listing copy.
- [x] **Firefox AMO listing** — approved and linked from `README.md`:
      https://addons.mozilla.org/firefox/addon/comment-vibe-on-device-check/
- [ ] **Upload the 1.2.3 zips to both stores.** AMO is serving 1.2.0, which has
      the event-page suspension bug fixed in 1.2.3 (analysis broke permanently
      ~30s after enabling); this upload is the real fix for Firefox users, not
      just a catch-up.
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
