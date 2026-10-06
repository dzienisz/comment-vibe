# Chrome Web Store listing — Comment Vibe

## Store title (ASO)

The store shows the manifest `name`, so a title change ships with the next
upload (any version bump — Chrome update reviews are usually fast). Keep the
brand, append the searchable keywords people actually type:

> **Comment Vibe — Private AI Tone Checker**

Why: "Comment Vibe" alone carries zero search keywords; "tone checker",
"comment", "AI" and "private" describe the benefit people are looking for.
Do not fully rename — the listing URL, reviews and existing links stay tied to
the current identity.

## Summary (max 132 chars — this is the `description` field in manifest.json)

Recommended (129 chars):
> Write with more clarity. Private, on-device AI shows how your comment may land and suggests a kinder rewrite before you post.

## Detailed description (paste into the CWS dashboard — plain text, no markdown)

Your words matter. Comment Vibe gives you a quiet second look before you share them.

As you write a comment, a small badge shows how it may land. If your draft sounds harsh, click it for a clear explanation and a kinder rewrite that keeps your point. Everything is powered by Chrome's built-in Gemini Nano model on your device — no account, no servers, and no data collection.

HOW IT WORKS
1. Type a comment on LinkedIn, X (Twitter), YouTube, Reddit — or anywhere with a comment box.
2. See a small, steady badge beside your draft. It updates quietly as you write.
3. Tap the badge for context. When your draft needs care, choose a kinder rewrite or copy it for later.

YOU'RE IN CONTROL
• Hide the guidance on one site directly from the tone card
• Turn Comment Vibe on or off globally, or set a site-specific preference
• Changes apply right away and sync with your signed-in Chrome profile

FOUR CLEAR TONE LABELS
😊 Positive — constructive and friendly
😐 Neutral — balanced and factual
😕 Negative — may come across as harsh or critical
🚫 Toxic — potentially aggressive or harmful language

SPEAKS YOUR LANGUAGE
Writing in Polish, Spanish, Japanese — or another language? Comment Vibe detects your language and returns the tone label, explanation, and rewrite in that same language. No translating needed. (Powered by Chrome's on-device Language Detector and Translator APIs.)

WHY PEOPLE USE IT
• Catch a heated tone before it creates friction
• Make your point without making things personal
• Build better communication habits over time
• Write in your own language
• Start without an account or a setup flow

PRIVATE BY DESIGN
By default all analysis happens locally using Chrome's on-device Gemini Nano model, and your comments never leave your device. There is no account, tracking, or analytics — and it continues working offline once the model is downloaded.

OPTIONAL FAST MODE (CLOUD, OFF BY DEFAULT)
If you have a TypeSafe API key, you can turn on "Fast tone check with Jev" in the popup. The tone badge then comes from TypeSafe's Jev model in well under a second, even on computers that can't run Gemini Nano. Only the text being checked is sent to TypeSafe, together with your own key, which stays in your browser and is never synced. Rewrites and writing actions still run on your device. Turn it off at any time.

REQUIREMENTS
• Chrome 138 or later, on desktop (Windows, macOS or Linux)
• Hardware eligible for Gemini Nano — Chrome downloads the on-device model (~2 GB) automatically the first time it's used
• On older builds (Chrome 127–137) only: enable "Prompt API for Gemini Nano" at chrome://flags, then update "Optimization Guide On Device Model" at chrome://components. No flags needed on 138+.

TIP: The very first analysis can take a moment while Chrome loads the model — after that it's instant.

## Privacy practices tab (CWS dashboard) — 1.5.0

**Single purpose:** unchanged (tone check and rewrite suggestions for text you type in comment boxes).

**Permission justification — host permission `https://api.typesafe.ai/*` (optional):**
> Requested only when the user turns on the optional "Fast tone check with Jev" setting in the popup. It lets the extension send the comment the user is checking to TypeSafe's Jev API to classify its tone (positive / neutral / negative / toxic). Off by default; never requested at install.

**Data usage:** tick **Website content** (the comment text the user types), with a note that it is sent only when the user enables Fast mode and only to classify tone. Certify all three statements: not sold to third parties, not used for unrelated purposes, not used for creditworthiness or lending.

**Privacy policy URL:** keep the raw README link (https://raw.githubusercontent.com/dzienisz/comment-vibe/main/README.md). Its Privacy section now describes Fast mode.

## Assets in this folder

| File | Size | CWS slot |
|---|---|---|
| shot1-hero.png | 1280×800 | Screenshot 1 — hero (tone card + rewrite) |
| shot2-labels.png | 1280×800 | Screenshot 2 — four tone labels |
| shot3-rewrite.png | 1280×800 | Screenshot 3 — kinder rewrite flow |
| shot4-languages.png | 1280×800 | Screenshot 4 — multilingual (Polish demo) |
| shot5-privacy.png | 1280×800 | Screenshot 5 — on-device privacy |
| shot6-controls.png | 1280×800 | Screenshot 6 — polished per-site & global controls |
| tile-small.png | 440×280 | Small promo tile |
| tile-marquee.png | 1400×560 | Marquee promo tile |

Regenerate after editing `src/*.html`: `./render.sh` (uses headless Chrome).
