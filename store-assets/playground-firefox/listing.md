# AMO listing — On-device AI Playground for Firefox

Standalone developer add-on from `playground-firefox/` (id
`firefox-ai-playground@dzienko.dev`). Separate from Comment Vibe: its own AMO
entry, its own version (`playground-firefox/manifest.json`), never inside the
Comment Vibe zips.

**Name rule:** AMO rejects names containing "Firefox" or "Mozilla" unless they
read "… for Firefox". Keep the manifest name in that form.

**UI language:** the playground UI is Polish (`lang="pl"`), the same as the
Chrome playground. Say so in the listing; translate the UI before a wide
public launch.

## Distribution

- **Unlisted (self-distributed):** Actions → *Firefox AI playground (AMO)* →
  channel `unlisted`. AMO signs automatically; the signed `.xpi` is in the run's
  artifacts. Users install it by opening the file in Firefox. No public page.
- **Listed (public page):** first submission by hand in the AMO Developer Hub
  (Submit a New Add-on → On this site) with `scripts/package-playground-firefox.sh`'s
  zip and the copy below; later versions can use the workflow with channel `listed`.

## Name

> On-device AI Playground for Firefox

## Summary (max 250 chars)

> Try every task of Firefox's experimental on-device AI API for extensions (browser.trial.ml) in one page: classification, NER, Q&A, summarization, translation, text generation, embeddings. Models run locally; nothing is sent to a server.

## Description

A developer playground for Firefox's WebExtensions AI API (browser.trial.ml). Pick a task, edit the input, and run it — the add-on shows the model download progress, the result and the raw output, plus the code to call it from your own extension.

TASKS
• Zero-shot classification (incl. the multilingual mDeBERTa model Comment Vibe uses)
• Text classification (sentiment)
• Token classification (named entities)
• Question answering
• Fill mask
• Summarization
• Translation
• Text-to-text generation (Flan-T5)
• Text generation (distilGPT-2)
• Feature extraction (embeddings, with cosine similarity)

HOW IT WORKS
Everything runs on your device through Firefox's own AI runtime. Each model is downloaded once from Mozilla's model hub or the Mozilla/Xenova organisations on Hugging Face (tens to hundreds of MB) and cached; the "Delete downloaded models" button removes them. Your input text never leaves the browser. No account, no analytics.

GOOD TO KNOW
• Firefox 134+ on desktop. The AI API is experimental; it is on by default since Firefox 140.
• If you blocked AI features in Settings → AI controls (Firefox 148+), allow them again: that also switches off the AI API for add-ons.
• Firefox allows one AI engine per add-on run, so switching tasks reloads the add-on and reopens the page on the new task.
• The interface is in Polish.

Source code: https://github.com/dzienisz/comment-vibe/tree/main/playground-firefox

## Categories

Developer Tools (Firefox). Tags: developer, AI, machine learning.

## Support / homepage

- Homepage: https://dzienko.dev/comment-vibe/playground/#firefox
- Support: https://github.com/dzienisz/comment-vibe/issues

## License

Same as the repository (see `LICENSE`).

## Privacy and data collection

`data_collection_permissions: required ["none"]` in the manifest. No privacy
policy is required because nothing is collected or transmitted; model files
are downloaded from Mozilla / Hugging Face by Firefox itself.

## Notes to reviewer

- No build step, no minified or generated code: the zip is the raw contents of
  `playground-firefox/` (`scripts/package-playground-firefox.sh`).
- `trialML` is an optional permission, requested from a button click on the
  overview page ("Przyznaj uprawnienie trialML").
- To test: grant the permission, open "Text classification", click "▶ Uruchom".
  The first run downloads the ~70 MB model from model-hub.mozilla.org.
- `browser.runtime.reload()` is used on purpose: the trial API allows one engine
  per extension run and has no call to close it.
