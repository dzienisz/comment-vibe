# Firefox Add-ons (AMO) listing — Comment Vibe

The Firefox build differs from the Chrome build, and this copy must stay honest
about it. Firefox has no Prompt API, so tone is classified by an on-device
zero-shot model via the WebExtensions AI API (`browser.trial.ml`). That means
**no kinder rewrite, no streaming, and no output translation** on Firefox — only
the four-way tone badge with a confidence-based explanation. Do not copy the
Chrome listing's rewrite/multilingual claims here.

## Name

Live listing (approved 2026-07-19):
https://addons.mozilla.org/firefox/addon/comment-vibe-on-device-check/

Current display name: **Comment Vibe: on-device check**. AMO allows editing the
display name from the developer hub ("Edit Product Page") without uploading a
new version, so the keyword-carrying title below can be applied any time:

> **Comment Vibe — AI Comment Tone Checker**

## Summary (AMO "Summary", max 250 chars)

> See how your comment sounds before you post. Comment Vibe uses Firefox's on-device AI to flag the tone of what you're typing — positive, neutral, negative or toxic — right next to the box. 100% private: nothing ever leaves your browser.

(233 chars)

## Description (AMO "About this extension" — plain text, blank lines between paragraphs)

Ever hit Post and instantly regretted the tone? Comment Vibe reads your comment as you type and shows you how it sounds — before the internet does.

It runs entirely on your device using Firefox's built-in AI runtime (the experimental WebExtensions AI API, Firefox 134+). No servers, no account, no data collection.

HOW IT WORKS
1. Type a comment on LinkedIn, X (Twitter), YouTube, Reddit — any site with a text box.
2. A small badge appears next to the box showing the detected tone.
3. Click the badge to see why: the on-device classifier explains which tone it read, and how confident it is.

FOUR CLEAR TONE LABELS
😊 Positive — constructive and friendly
😐 Neutral — balanced and factual
😕 Negative — may come across as harsh or critical
🚫 Toxic — contains aggressive or harmful language

100% PRIVATE, BY DESIGN
All analysis happens locally with an on-device multilingual model (about 340 MB, downloaded once from Mozilla/Xenova's model hub — works in English, Polish, and ~100 other languages). Your comments are never sent to any server. No account, no tracking, no analytics — and it keeps working offline once the model is downloaded.

ONE-TIME SETUP
Because on-device AI in Firefox is still experimental, you turn it on yourself:
• Open the Comment Vibe popup and click "Enable on-device AI" (this grants the optional trialML permission and downloads the model once).
• On Firefox 134–139 you may also need to set browser.ml.enable and extensions.ml.enabled to true in about:config (on by default since Firefox 140).

REQUIREMENTS
• Firefox 134 or later, on desktop.
• Enough free disk/memory for the on-device model.

GOOD TO KNOW
This Firefox build focuses on the tone badge and explanation. The kinder-rewrite suggestions and automatic translation available in the Chrome version rely on a generative on-device model that Firefox's AI API does not yet expose — so they are not part of the Firefox build. The tone check itself works the same way.

Comment Vibe is open source. The WebExtensions AI API it depends on is explicitly experimental, so behaviour may change between Firefox versions.

## Privacy / data-collection note (AMO privacy fields)

Comment Vibe does not collect, transmit, or store any user data. All text analysis runs locally in the browser via the on-device AI runtime. No comment text or personal data leaves the device. The optional "trialML" permission is used only to run the local model.

## Assets in this folder

| File | Size | AMO slot |
|---|---|---|
| ff-shot1-hero.png | 1280×800 | Screenshot 1 — tone badge + explanation |
| ff-shot2-labels.png | 1280×800 | Screenshot 2 — four tone labels |
| ff-shot3-setup.png | 1280×800 | Screenshot 3 — one-time "Enable on-device AI" |
| ff-shot4-privacy.png | 1280×800 | Screenshot 4 — on-device privacy |

AMO has no marquee/small promo-tile slots (unlike the Chrome Web Store), so this
set is screenshots only. Regenerate after editing `src/*.html`:
`./render-firefox.sh` (uses headless Chrome; renders to this folder).
