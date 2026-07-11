# TODO — next session

Handoff notes for the next working session. Context: v1.1.0 is released
(tagged `v1.1.0`, pushed to `main`) and adds multilingual output via the
Language Detector + Translator APIs. See `CHANGELOG.md` for what shipped.

## Do first — testability refactor (de-risks everything else)
- [ ] Extract the pure functions from `content.js` (`parseResponse`, `normalize`,
      and the language-code handling) so they can be imported without a DOM.
- [ ] Add a `node:test` test file for them (built into Node — **no npm, no deps,
      respects the CLAUDE.md "no build tooling" constraint**; never shipped to Chrome).
      Cover: malformed/partial model JSON, the profanity fallback, alternative
      key names in `normalize()`, `und`/low-confidence language detection.
- **Why:** v1.1.0 could not be verified live (no connected Chrome, models are
  manual-only). The brittle logic is the parsing/normalising, not the AI calls.
  Tests turn "I hope it still parses" into something runnable.

## Then — shippable UX (no new Chrome API needed)
- [x] Streaming via `promptStreaming()` — badge colors in as soon as the
      sentiment field arrives; reason/rewrite fill the tooltip when done.
- [x] Session-growth fix: few-shots moved to `initialPrompts`, each analysis
      runs on a throwaway `clone()` so the shared session's context no longer
      grows (and slows down) with every analysis.
- [ ] Keyboard shortcut to trigger analysis on demand (bypass the 900 ms debounce).
- [ ] Better "AI unavailable" / empty state — currently the badge silently never
      appears; a one-time hint would help adoption.

## Park until the APIs go stable (don't build against trials)
- [ ] Rewriter API (developer trial) — swap in for the raw Prompt rewrite once stable.
- [ ] Proofreader API (origin trial) — grammar/spelling layer.
- [ ] Multimodal Prompt input (EPP) — analyse pasted screenshots.
- **Why:** building against pre-stable APIs means throwaway code + mandatory
  fallbacks. No value in polling Chrome releases for these.

## Housekeeping / Web Store
- [ ] Reconcile `minimum_chrome_version` (`manifest.json` says `127`) with the
      store listing, which now says Chrome 138. Decide: bump to 138 (drops the
      legacy `window.ai` flag-users) or keep 127 and keep the dual path.
- [ ] Prepare a justification for the `<all_urls>` content-script match — it's the
      most common Chrome Web Store review flag.
- [ ] Update the distribution `zip` command in `CLAUDE.md` to also exclude
      `.claude/*` and `icons/make-icons.html` (the committed command pulled local
      agent config into the package — fixed manually for the v1.1.0 zip).
- [ ] Optional: sync the one-line `manifest.json` description to mention multilingual,
      and save the Web Store listing copy as `store-listing.md` for versioning.

## Lower priority — perf
- [ ] Throttle `scanPage()`; it re-runs on every MutationObserver batch, which can
      get expensive on busy SPAs (X/Twitter, infinite feeds). Not yet a felt problem.
