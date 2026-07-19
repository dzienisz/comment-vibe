# Promo posts — ready to fire

Drafts for launching Comment Vibe's visibility push. Post them **spaced out**
(one channel per day or two, not all at once) and always as yourself — these
communities reward authentic dev stories and punish drive-by promo.

The unique angle everywhere: **one of the first extensions shipping on both
Chrome's Gemini Nano (Prompt API) and Firefox's brand-new WebExtensions AI API
(`browser.trial.ml`) — 100% on-device, no build tools, raw JS you can audit.**

Links to use:
- Website: https://dzienko.dev/comment-vibe/
- Chrome: https://chromewebstore.google.com/detail/comment-vibe/kibcnjcipaofjlbbnjdjaobbkoajiejp
- Firefox: https://addons.mozilla.org/firefox/addon/comment-vibe-on-device-check/
- GitHub: https://github.com/dzienisz/comment-vibe

---

## 1. Show HN (best single shot — post on a weekday morning US time)

**Title:**

> Show HN: Comment Vibe – on-device AI tone check for comments (Gemini Nano and Firefox's new AI API)

**First comment (post immediately under your own submission, link = website):**

> I built a small browser extension that reads the tone of a comment while you
> type it — positive / neutral / negative / toxic — and, when it sounds harsher
> than you meant, suggests a kinder rewrite. Everything runs on-device; there is
> no server and the comment text never leaves the browser.
>
> The technically interesting part is that it ships on two very different
> on-device AI stacks from one codebase:
>
> - **Chrome**: the Prompt API (Gemini Nano). Generative, so I can ask for
>   structured JSON with a reason and a rewrite, stream it, and even translate
>   the output into the comment's language with the Translator API.
> - **Firefox**: the new WebExtensions AI API (`browser.trial.ml`, Firefox
>   134+). It exposes Transformers.js *pipelines*, not a chat model — so the
>   Firefox build runs zero-shot classification (`distilbert-mnli`) over the
>   same four labels instead of generating text. Background-script-only, so the
>   content script delegates over runtime messaging.
>
> Other constraints I set myself: no build tooling at all (the store zips are
> raw source files — what you audit is what runs), no dependencies, tests with
> plain `node --test`.
>
> Happy to answer questions about either API — the Firefox one is genuinely
> experimental (Mozilla warns about breaking renames between versions) and
> there's very little written about shipping against it so far.

---

## 2. r/firefox (angle: the new AI API, not the product)

**Title:**

> I shipped one of the first extensions using Firefox's new on-device AI API (browser.trial.ml) — here's what it was like

**Body:**

> Firefox 134+ quietly ships a WebExtensions AI API: extensions can run
> on-device Transformers.js models via `browser.trial.ml` after the user grants
> an optional `trialML` permission. I used it to port my comment-tone-checker
> extension from Chrome, and a few things surprised me:
>
> - It's **background-script-only** — content scripts have to delegate over
>   runtime messaging.
> - It's **pipelines, not prompts** — you get tasks like text-classification
>   and summarization with models from Mozilla/Xenova's hubs, not a chat model.
>   I run zero-shot classification with four candidate tone labels.
> - **One engine at a time** — parallel runs are rejected, so you serialize.
> - The permission flow is genuinely nice: the user opts in from the popup, the
>   model (~65 MB) downloads once, and everything stays local.
>
> On non-Nightly you currently need `browser.ml.enable` and
> `extensions.ml.enabled` flipped in about:config, which is the biggest
> adoption hurdle right now.
>
> The extension is free/MIT if you want to see a real-world usage:
> [AMO link] · [GitHub link]
>
> Happy to answer questions about the API.

*(Also fits: r/mozilla. For Mozilla's own channels, post the same experience
report to the Mozilla Connect thread / discourse topic where they collect
`browser.trial.ml` feedback — the team explicitly asked for real-world usage
reports, and being one of their examples is durable visibility.)*

---

## 3. r/SideProject / r/InternetIsBeautiful (angle: the product)

**Title:**

> I made a free extension that tells you how your comment sounds — before you post it (100% on-device AI, no account)

**Body:**

> Type a comment on LinkedIn / X / YouTube / Reddit and a little badge shows
> whether it reads as positive, neutral, negative or toxic — and if it's
> harsher than you meant, one click gives you a kinder rewrite that keeps your
> point.
>
> The twist: there's no server. It uses the AI model built into your browser
> (Chrome's Gemini Nano, or Firefox's new on-device AI), so your drafts never
> leave your machine. No account, no tracking, free, open source (MIT).
>
> [website link]
>
> Would love feedback — especially false positives ("that's not toxic!").

---

## 4. Dev.to / personal blog post (long-form; repost link to HN/lobste.rs/r/webdev)

**Working title:**

> One extension, two on-device AI stacks: shipping on Chrome's Gemini Nano and Firefox's browser.trial.ml

**Outline:**

1. The product in one paragraph (tone badge, kinder rewrite, on-device).
2. Chrome path: Prompt API session lifecycle — `initialPrompts` few-shots,
   `clone()` per analysis to stop context growth, streaming with a prefilled
   `{"sentiment":` assistant turn for early badge color.
3. Firefox path: what `browser.trial.ml` actually is (Transformers.js
   pipelines), background-only architecture, zero-shot classification instead
   of generation, the `trialML` opt-in UX, engine serialization.
4. The same product on both: honest feature matrix (rewrites/streaming/
   translation are Chrome-only) and why that's an API property, not a choice.
5. Constraints as features: no build step → the shipped zip IS the source;
   plain `node --test`; a stub harness for UI testing without any model.
6. What broke: AMO validation (`data_collection_permissions` needs Firefox
   140+), review-queue realities, packaging two store zips from one tree.
7. Closing: links + "the Firefox API needs more real-world usage reports."

---

## 5. Short social (X / Bluesky / LinkedIn)

**EN:**

> Ever hit Post and instantly regretted the tone?
>
> I built Comment Vibe: a free browser extension that reads your comment as you
> type and flags it — 😊 😐 😕 🚫 — with a kinder rewrite when you need one.
>
> 100% on-device AI (Gemini Nano / Firefox AI runtime). No cloud. No account.
>
> [website link]

**PL (LinkedIn):**

> Znasz to uczucie, gdy klikasz "Opublikuj" i od razu żałujesz tonu?
>
> Zbudowałem Comment Vibe — darmowe rozszerzenie, które czyta ton komentarza
> podczas pisania (😊 😐 😕 🚫) i podpowiada łagodniejszą wersję, zanim
> opublikujesz. AI działa w 100% na Twoim urządzeniu (Gemini Nano w Chrome,
> nowe AI API w Firefoksie) — nic nie wychodzi z przeglądarki.
>
> Po polsku też działa — wynik dostajesz w języku, w którym piszesz.
>
> [website link]

---

## 6. GitHub issue #1 follow-up (notifies niutech, who requested Firefox support)

Comment to post on https://github.com/dzienisz/comment-vibe/issues/1:

> Update: the Firefox version is now live on AMO 🎉
> https://addons.mozilla.org/firefox/addon/comment-vibe-on-device-check/
>
> It runs a zero-shot tone classifier through `browser.trial.ml` in the
> background script (classification only — no generative rewrites until Firefox
> exposes a generative pipeline). Thanks again for the nudge — this ended up
> being one of the first extensions shipping on the WebExtensions AI API.

---

## Channel notes

- **Don't cross-post the same text** — each community gets its own angle
  (HN: engineering, r/firefox: the API, r/SideProject: the product).
- **Product Hunt**: possible later; needs gallery images (reuse store-assets)
  and a launch day you can actively answer comments. Don't burn it early —
  launch there after the store title ASO change lands so the listing converts.
- **Timing**: HN and Reddit reward Tue–Thu mornings (US). One channel at a
  time; if HN flops, it can be reposted once after a week or two.
