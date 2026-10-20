# Firefox AI Playground

A small standalone Firefox add-on for trying Firefox's on-device WebExtensions
AI API, [`browser.trial.ml`](https://firefox-source-docs.mozilla.org/toolkit/components/ml/extensions.html),
one task at a time. It is a companion to the Chrome playground in
[`../playground/`](../playground/): Firefox exposes none of Chrome's built-in
AI web APIs, and `browser.trial.ml` only works inside extensions, so live demos
need an add-on rather than a web page.

Not part of Comment Vibe and not included in either store zip. Raw files, no
build step, no dependencies.

## Run it

1. Firefox 134+ (current release: 158). Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → pick `playground-firefox/manifest.json`. The playground opens in a new tab;
   later, click the toolbar icon.
3. Click **Przyznaj uprawnienie trialML** (grants the optional `trialML` permission).
4. Pick a task and click **▶ Uruchom**. The first run downloads the model (tens to hundreds of MB),
   with a progress bar; later runs use the cache. **Usuń pobrane modele** on the overview deletes them.

## Tasks

| Demo | `taskName` | Model |
| --- | --- | --- |
| Zero-shot classification | `zero-shot-classification` | `Xenova/distilbert-base-uncased-mnli` or Comment Vibe's `Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7` |
| Text classification | `text-classification` | `Xenova/distilbert-base-uncased-finetuned-sst-2-english` |
| Token classification (NER) | `token-classification` | `Xenova/bert-base-multilingual-cased-ner-hrl` |
| Question answering | `question-answering` | `Xenova/distilbert-base-cased-distilled-squad` |
| Fill mask | `fill-mask` | `Xenova/bert-base-uncased` |
| Summarization | `summarization` | `Xenova/distilbart-cnn-6-6` |
| Translation | `translation` | `Xenova/t5-small` |
| Text2text generation | `text2text-generation` | `Xenova/flan-t5-small` |
| Text generation | `text-generation` | `Xenova/distilgpt2` |
| Feature extraction | `feature-extraction` | `Xenova/all-MiniLM-L6-v2` |

Firefox only accepts models from Mozilla's model hub and the Mozilla and Xenova
organisations on Hugging Face. Image and audio tasks are not included yet.

## Limits of the trial API

- **One engine per extension run.** A second `createEngine` throws "Engine already created", and
  there is no call to close an engine. Switching task or model here therefore reloads the add-on
  (`browser.runtime.reload()`); `background.js` reopens the page on the chosen task. The active
  engine is tracked in `storage.session`, which Firefox clears on reload.
- No parallel runs and no streaming. Firefox may drop an idle engine to save memory; the next run
  recreates it.
- **Firefox 148+:** blocking AI in Settings → AI controls also sets `extensions.ml.enabled` to
  `false`, and every call fails with "Trial ML API is disabled".
  **Firefox 134–139:** set `browser.ml.enable` and `extensions.ml.enabled` to `true` in `about:config`.
- The API is experimental: feature-detect `browser.trial?.ml` instead of checking versions.

## Tests

```bash
node --test test/playground-firefox.test.js
```

The tests stub `browser.trial.ml`; `styles.css` must stay identical to `playground/styles.css`.
