# TODO / Roadmap

Working notes for what's next. Shipped history lives in `CHANGELOG.md`; this
file is only the forward look. Current release: **v1.3.0** (Chrome + Firefox).

## State of play

- **Chrome** (Prompt API / Gemini Nano): tone badge, streaming, one-click
  rewrite insertion, multilingual output, per-site/global off via storage.sync.
  Stable path.
- **Firefox** (WebExtensions AI API / `browser.trial.ml`): tone badge +
  per-site/global off — zero-shot classifier via `background.js`, no
  rewrite/streaming/translation (the API exposes classification, not
  generation). Delegated from `content.js`.
- **Tests**: `node --test` (`test/content.test.js`, `test/background.test.js`,
  `test/playground.test.js`) plus `test/harness.html` (`?api=modern|legacy|firefox`).
- **Release**: `scripts/bump-version.sh` → edit `CHANGELOG.md` → commit → push a
  `vX.Y.Z` tag → `.github/workflows/release.yml` builds both zips (via
  `scripts/package.sh`) and publishes the GitHub Release.
- **v1.3.0 status:** live on all three channels (GitHub Release, AMO,
  Chrome Web Store — approved and public 2026-09-10). Note: the automated CWS
  publish step failed on the 1.3.0 tag ("mandatory privacy information" 400)
  and 1.3.0 was published from the dashboard by hand; privacy fields have
  since been filled in — the 1.3.1 tag is the test that the automation works.
- **v1.3.1:** UX refresh + ASO title. Tag `v1.3.1` after merging the release PR.
- [ ] **Upload refreshed CWS listing assets** — replace shot1/3/4, add
      `shot6-controls.png`, paste updated description from `store-assets/listing.md`.

## Shippable UX (no new API needed)

Planned next (decided 2026-09-10, in rough priority order):

### 1.4.0 — private writing helper (shipped)

- [x] Writing actions: grammar, professional, friendly, shorter and clearer.
- [x] One-click apply, copy and undo.
- [x] Manual mode and Alt+Shift+C on-demand analysis.
- [x] Honest in-page AI readiness notices.
- [x] Rate prompt after repeated successful rewrites.

### 1.5.0 — X coach (planned 2026-09-21, from the @dzienko account audit)

Site-specific mode for x.com / twitter.com, on top of the 1.4.0 rewrite chips.
Everything local (`chrome.storage`), no new permissions, no telemetry.

- [ ] **X-only rewrite chips**: Hookier (stronger first line), Fit 280 (trim to
      the limit, keep the point), Less snarky (keep the opinion, drop the
      insult), Add a question (end with something people can answer),
      To English (translate, keep tone). Chips replace the generic set only
      when the host is x.com; generic chips stay elsewhere.
- [ ] **Pre-post nudges** (rule-based, no model needed), shown as a one-line
      hint under the compose box: link in the main post → "put it in the first
      reply"; mixed PL/EN in one post; politics/insult keywords → suggest
      "Less snarky"; more than 3 originals today → "you already posted N
      times, save it for tomorrow".
- [ ] **Local posting log** (date, original vs reply, language, length, had
      link, chips used) → popup "This week on X" self-report: originals vs
      replies, link ratio, language mix, tone mix. No analytics scraping —
      X's CSV export stays the source for reach numbers.
- [ ] **Compose-box detection for x.com**: the tweet editor is a contenteditable
      Draft.js root, not a textarea; make sure badge/tooltip anchor to it and
      survive the modal composer.
- [ ] Ship first as an unpacked private branch for @dzienko, promote to the
      store once the chips prove useful for a month.

### Later candidates

- [ ] **Personal vibe stats** — candidate headline feature for 1.4.0. Popup
      dashboard with positive/neutral/negative breakdown over 7 and 30 days,
      stored locally via `chrome.storage` (permission already granted).
      Turns a sometimes-helper into a habit/metric users return to — and gives
      a fresh screenshot for the next release.
- [ ] **Context-aware analysis** — read the post being replied to and factor it
      into the tone judgement ("measured reply to an aggressive post" vs
      "unprovoked attack"). Biggest quality jump available; the hard part is
      per-site DOM parsing, not the AI.
- [ ] **Platform tone calibration** — stricter system prompt on LinkedIn, more
      relaxed on Reddit; a domain→prompt map is a few lines.
- [ ] **Summarizer API for long threads** (✅ stable since Chrome 138) —
      summarise the thread before the user replies; natural extension of
      context-aware analysis.
- [x] **Keyboard shortcut** to trigger analysis on demand (bypass the 900 ms debounce).
- [x] **"Rate Comment Vibe" link in the popup** — shown after repeated
      successful rewrites (1.4.0). No telemetry (privacy is the selling point),
      so store ratings are the only feedback loop we get.
- [x] **Better "AI unavailable" content-script state.** The popup now explains
      setup on both browsers, but in-page the badge still silently never appears
      when the model is unavailable. A one-time, dismissible hint near a focused
      comment box would help adoption.
- [x] **Firefox: honest first-run download feedback in-page.** The popup shows
      model-download progress, but the very first `cv-analyze` after enabling can
      be slow; consider a "Preparing…" badge state on the Firefox path too
      (Chrome already has one via `getModelStatus`).
      → shipped: after `FIREFOX_SLOW_MS` the badge swaps to "Preparing AI model…".

## Visibility / marketing (started 2026-07-19)

- [x] **Landing page** — `site/` deploys to https://dzienko.dev/comment-vibe/
      (playground moved to `/playground/`). Interactive simulated demo, both
      store CTAs, SEO/OG tags.
- [x] **Store title ASO** — "Comment Vibe — Private AI Tone Checker" is the
      manifest `name` in both builds as of 1.3.1. AMO: also set it in the
      dashboard so the listing updates before the new version is approved.
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

- [x] **`<all_urls>` justification** — drafted and entered in the CWS Privacy
      practices tab (2026-09-10, together with `activeTab`/`storage`
      justifications for 1.3.0). Keep the text with the listing copy for AMO.
      Remember: permission changes need Privacy practices updated *before*
      tagging, or the release workflow stalls at the publish step.
- [x] **Firefox AMO listing** — approved and linked from `README.md`:
      https://addons.mozilla.org/firefox/addon/comment-vibe-on-device-check/
- [x] **Store submissions are automated** since v1.2.4: the release workflow
      uploads to the Chrome Web Store and AMO on every `vX.Y.Z` tag (secrets in
      repo settings). v1.2.4 — carrying the 1.2.3 Firefox event-page fix —
      was approved and is live on AMO (2026-07-19, same day); Chrome Web Store
      review still pending.
- [ ] Decide whether to keep `minimum_chrome_version: 127`. Keeping it preserves
      the legacy `window.ai` path (a CLAUDE.md hard constraint); the store copy
      already frames 138 as the flag-free line, so this is currently intentional,
      not a bug. Revisit only if the legacy path is ever dropped.

## Park until the APIs go stable (don't build against trials)

- [ ] **Firefox: opt-in generative "enhanced mode" via wllama** (issue #1,
      requested by @niutech as Phi-3 Mini). Firefox 142 enabled the wllama
      (llama.cpp/GGUF) backend for extensions (bug 1976704) — the realistic way
      to run a small instruct LLM for rewrites/reasons on Firefox. Must stay
      opt-in: multi-GB download and CPU inference are too heavy to be the
      default for a while-you-type badge; the zero-shot classifier remains the
      instant path. Wait for the backend to prove stable in `browser.trial.ml`
      before building.
- [ ] **Rewriter API** (developer trial) — replace the raw Prompt rewrite once stable.
- [ ] **Proofreader API** (origin trial) — grammar/spelling layer.
- [ ] **Multimodal Prompt input** — analyse pasted screenshots.
- **Why:** building against pre-stable APIs means throwaway code plus mandatory
  fallbacks. No value in polling release channels for these.

## Lower priority — perf

- [ ] Throttle `scanPage()`; it re-runs on every MutationObserver batch, which can
      get expensive on busy SPAs (X/Twitter, infinite feeds). Not yet a felt problem.
