# Comment Vibe

A Chrome extension that uses Chrome's built-in AI (Gemini Nano) to analyse the tone of your comments in real time — before you hit post.

![Chrome](https://img.shields.io/badge/Chrome-127%2B-blue) ![Manifest V3](https://img.shields.io/badge/Manifest-V3-green) ![On-device AI](https://img.shields.io/badge/AI-On--device-purple)

## What it does

Type a comment on LinkedIn, Twitter/X, YouTube, or any other site. A small badge appears near your text box showing the detected tone. Click it to see why — and if your comment sounds harsh or toxic, get an instant kinder rewrite suggestion you can copy in one click.

| Badge | Meaning |
|---|---|
| 😊 Positive | Constructive and friendly |
| 😐 Neutral | Balanced and factual |
| 😕 Negative | May come across as harsh or critical |
| 🚫 Toxic | Contains aggressive or harmful language |

## Privacy

All analysis runs locally using Chrome's on-device Gemini Nano model. Your comments are never sent to any server.

---

## Chrome AI availability — what you need to know

> **TL;DR — as of mid-2025 this extension requires manual setup. No-flag support is coming in Chrome 148+.**

### Current status (Chrome 127–147)

Chrome's built-in Prompt API (the API that powers this extension) is still in **origin trial / early access**. It is not enabled by default. To use the extension today you must:

1. Be on **Chrome 127 or later** (desktop only — Windows 10/11, macOS 13+, or Linux)
2. Enable two flags manually (see setup below)
3. Download the Gemini Nano model (~2 GB, one-time)

### When will it work without flags?

Google is rolling out the Prompt API progressively:

| Milestone | Chrome version | Status |
|---|---|---|
| First flag-gated release | Chrome 127 | ✅ Available now |
| Origin trial for web pages | Chrome 138 | ✅ Available now |
| Stable release (no flags needed) | Chrome 148+ | 🔜 Expected late 2025 |

Once Chrome 148 ships to stable, the extension will work out of the box for all eligible users with no setup required.

### Hardware requirements

Gemini Nano runs on your device. Chrome enforces these minimums:

| Requirement | Minimum |
|---|---|
| Operating system | Windows 10/11 · macOS 13 (Ventura)+ · Linux |
| Free disk space | 22 GB (model is removed if space drops below 10 GB) |
| GPU VRAM | More than 4 GB |
| RAM | 16 GB or more |
| CPU cores | 4 or more |
| Mobile | ❌ Not supported (Android / iOS) |

---

## Setup (required until Chrome 148)

### Step 1 — Enable the flags

1. Open `chrome://flags`
2. Search for **Prompt API for Gemini Nano** → set to **Enabled**
3. Search for **Summarization API for Gemini Nano** → set to **Enabled** (needed on some builds)
4. Click **Relaunch**

### Step 2 — Download the model

1. Open `chrome://components`
2. Find **Optimization Guide On Device Model**
3. Click **Check for update** and wait for the download to finish

The model is ~2 GB. Download time depends on your connection. Chrome downloads it silently in the background.

### Step 3 — Verify it worked

Click the Comment Vibe icon in the Chrome toolbar. The popup should show **Chrome AI ready ✓**. If it still shows "not available", restart Chrome fully (quit and reopen, not just close the tab) and try again.

---

## Development

### Load the extension locally

1. Clone or download this repo
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `comment-vibe` folder

### Generate icons

Open `icons/make-icons.html` in Chrome and click **Download all icons**. Move the three downloaded PNG files into the `icons/` folder.

### Project structure

```
comment-vibe/
├── manifest.json       # Extension manifest (MV3)
├── content.js          # Detects comment boxes, runs AI analysis, renders badge
├── content.css         # Badge and tooltip styles
├── popup.html          # Toolbar popup
├── popup.js            # Popup — checks Chrome AI availability
├── popup.css           # Popup styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    ├── icon128.png
    └── make-icons.html # Canvas-based icon generator
```

### Build for the Chrome Web Store

```bash
zip -r comment-vibe.zip comment-vibe \
  --exclude "comment-vibe/icons/make-icons.html" \
  --exclude "comment-vibe/README.md" \
  --exclude "*/.DS_Store"
```

## How it works

1. A `MutationObserver` watches for comment boxes matching site-specific selectors (LinkedIn's Quill editor, Twitter's tweet textarea, YouTube's comment field) plus generic `contenteditable` and `textarea` fallbacks across all other sites
2. Text changes are debounced (900 ms) to avoid calling the model on every keystroke
3. The text is sent to a `LanguageModel` session (Chrome's Prompt API) using few-shot examples + prefix prompting to force structured JSON output from Gemini Nano
4. The JSON response is parsed and normalised — the `normalize()` function maps any alternative key names the model invents back to the expected schema
5. A fixed-position badge appears at the bottom-right corner of the input, coloured by sentiment
6. Clicking the badge opens a dark tooltip with the reason and (for negative/toxic results) a rewrite suggestion with a one-click copy button

## License

MIT
