# Chrome Web Store listing — Comment Vibe

## Store title (ASO)

The store shows the manifest `name`, so a title change ships with the next
upload (any version bump — Chrome update reviews are usually fast). Keep the
brand, append the searchable keywords people actually type:

> **Comment Vibe — AI Comment Tone Checker**

Why: "Comment Vibe" alone carries zero search keywords; "tone checker",
"comment" and "AI" are the discovery phrases. Do not fully rename — the
listing URL, reviews and existing links stay tied to the current identity.

## Summary (max 132 chars — this is the `description` field in manifest.json)

Option A (current, 128 chars):
> Check comment tone with Chrome's on-device AI. Get kinder rewrite suggestions before you post. Private — no data sent anywhere.

Option B (benefit-first, 130 chars):
> See how your comment sounds before you post. On-device AI tone check with kinder rewrites. 100% private — nothing leaves Chrome.

## Detailed description (paste into the CWS dashboard — plain text, no markdown)

Ever hit Post and instantly regretted the tone? Comment Vibe reads your comment as you type and shows you how it sounds — before the internet does.

Powered by Chrome's built-in AI (Gemini Nano), everything runs on your device: no servers, no account, no data collection.

HOW IT WORKS
1. Type a comment on LinkedIn, X (Twitter), YouTube, Reddit — any site with a text box.
2. A small badge appears next to the box showing the detected tone.
3. Click the badge to see why — and if your comment sounds harsh or toxic, get an instant kinder rewrite you can copy in one click.

FOUR CLEAR TONE LABELS
😊 Positive — constructive and friendly
😐 Neutral — balanced and factual
😕 Negative — may come across as harsh or critical
🚫 Toxic — contains aggressive or harmful language

SPEAKS YOUR LANGUAGE
Writing in Polish, Spanish, Japanese — anything other than English? Comment Vibe detects your comment's language automatically and shows the tone label, the explanation and the rewrite in that same language, ready to paste. No translating needed. (Powered by Chrome's on-device Language Detector and Translator APIs.)

WHY PEOPLE USE IT
• Catch negativity before you regret posting it
• Turn a heated draft into a point that actually lands
• Build better online communication habits over time
• Works in your own language, not just English
• Zero setup — install and start typing

100% PRIVATE, BY DESIGN
All analysis happens locally using Chrome's on-device Gemini Nano model. Your comments are never sent to any server. No account, no tracking, no analytics — and it keeps working offline once the model is downloaded.

REQUIREMENTS
• Chrome 138 or later, on desktop (Windows, macOS or Linux)
• Hardware eligible for Gemini Nano — Chrome downloads the on-device model (~2 GB) automatically the first time it's used
• On older builds (Chrome 127–137) only: enable "Prompt API for Gemini Nano" at chrome://flags, then update "Optimization Guide On Device Model" at chrome://components. No flags needed on 138+.

TIP: The very first analysis can take a moment while Chrome loads the model — after that it's instant.

## Assets in this folder

| File | Size | CWS slot |
|---|---|---|
| shot1-hero.png | 1280×800 | Screenshot 1 — hero (badge + tooltip) |
| shot2-labels.png | 1280×800 | Screenshot 2 — four tone labels |
| shot3-rewrite.png | 1280×800 | Screenshot 3 — kinder rewrite flow |
| shot4-languages.png | 1280×800 | Screenshot 4 — multilingual (Polish demo) |
| shot5-privacy.png | 1280×800 | Screenshot 5 — on-device privacy |
| tile-small.png | 440×280 | Small promo tile |
| tile-marquee.png | 1400×560 | Marquee promo tile |

Regenerate after editing `src/*.html`: `./render.sh` (uses headless Chrome).
