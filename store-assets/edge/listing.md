# Microsoft Edge Add-ons listing — Comment Vibe

Edge takes the **Chrome zip unchanged** (`comment-vibe-<version>.zip` from
`scripts/package.sh`). The copy below must stay honest about what works on
Edge:

- **Regular Edge (Stable) has no on-device language model.** The Prompt API
  (`LanguageModel`, Phi-4-mini) is a developer preview in **Edge Canary and
  Dev 138+** on Windows 10/11 and macOS 13.3+, behind the *Prompt API for
  on-device language model* flag in `edge://flags`
  ([Microsoft docs](https://learn.microsoft.com/microsoft-edge/web-platform/prompt-api)).
  Hardware: 5.5 GB VRAM, 20 GB free disk, unmetered network.
- **Fast mode** (SubQ or TypeSafe key, opt-in cloud) works on every Edge
  channel. On Stable it is the only way to get a tone badge; rewrites and
  writing actions need the on-device model.
- The popup detects Edge and shows Edge setup help (`#setup-edge`) instead of
  the Chrome/Gemini Nano steps.

## Partner Center — first submission (manual, once)

The Publish API can only update a product that already exists, so the first
version is created by hand at
https://partner.microsoft.com/dashboard/microsoftedge/overview →
**Create new extension**:

1. **Packages:** upload `comment-vibe-<version>.zip` from the GitHub Release.
2. **Availability:** Public, all markets.
3. **Properties:**
   - Category: **Productivity**
   - Privacy policy: required — https://raw.githubusercontent.com/dzienisz/comment-vibe/main/README.md (Privacy section; same URL as the Chrome listing)
   - Website: https://dzienko.dev/comment-vibe/
   - Support contact: https://github.com/dzienisz/comment-vibe/issues
   - Mature content: No
4. **Privacy:** declare **Website content** (the comment text being
   checked) — sent only when the user turns on Fast mode, only to the chosen
   provider (api.subq.ai or api.typesafe.ai), only to classify tone. Not sold,
   not used for unrelated purposes, not used for creditworthiness.
5. **Store listings** (English; add others only with real translations):
   - Description: below
   - Extension Store logo: `icons/icon128.png` (Partner Center minimum is 128×128, 1:1)
   - Small promotional tile 440×280: `store-assets/tile-small.png`
   - Large promotional tile 1400×560: `store-assets/tile-marquee.png`
   - Screenshots 1280×800: `store-assets/shot1-hero.png`, `shot2-labels.png`,
     `shot6-controls.png`, `shot5-privacy.png` (skip `shot3-rewrite` and
     `shot4-languages` — rewrites need the on-device model, which regular Edge lacks)
   - Search terms (max 7): tone checker, comment, kind, rewrite, on-device AI, privacy, writing assistant
6. **Notes for certification:** paste the text below **plus a working SubQ
   test key** (Kamil pastes it in Partner Center; never commit it here).

### Short description

Write with more clarity. AI shows how your comment may land before you post — on-device on Edge Canary/Dev, or Fast mode with your key.

### Description

Your words matter. Comment Vibe gives you a quiet second look before you share them.

As you write a comment, a small badge shows how it may land: Positive, Neutral, Negative or Toxic. Click it for a short explanation of why.

HOW IT WORKS ON MICROSOFT EDGE
• Regular Edge: turn on "Fast tone check in the cloud" in the popup and paste your own SubQ (subq.ai) or TypeSafe (typesafe.ai) API key. Only the text being checked is sent to that provider, with your key, which stays in this browser and is never synced. Off by default.
• Edge Canary or Dev 138+ (Windows 10/11, macOS 13.3+): enable "Prompt API for on-device language model" in edge://flags and Comment Vibe runs entirely on your device with Edge's built-in model — including kinder rewrite suggestions and writing actions. No account, no servers.

YOU'RE IN CONTROL
• Hide the guidance on one site directly from the tone card
• Turn Comment Vibe on or off globally, or per site
• Turn off automatic checks and press Alt+Shift+C to check on demand

FOUR CLEAR TONE LABELS
😊 Positive — constructive and friendly
😐 Neutral — balanced and factual
😕 Negative — may come across as harsh or critical
🚫 Toxic — potentially aggressive or harmful language

PRIVATE BY DESIGN
No account, no tracking, no analytics. The on-device mode never sends your text anywhere; Fast mode sends only the text being checked, only after you turn it on.

Open source (MIT): https://github.com/dzienisz/comment-vibe

### Notes for certification

```
Comment Vibe checks the tone of text the user types in comment boxes.
Regular Edge has no on-device language model, so please test with Fast mode:

1. Open any page with a text box, e.g. https://dzienko.dev/comment-vibe/ or a
   YouTube video's comment field.
2. Click the Comment Vibe toolbar icon → turn on "Fast tone check in the cloud".
3. Provider: SubQ. Paste this test key: <TEST KEY — added in Partner Center only>
   Accept the permission prompt for api.subq.ai.
4. Type "This is the dumbest idea I've ever read." into a comment box — a red
   "Negative"/"Toxic" badge appears; click it for the explanation.

Without a key, the popup shows Edge setup help (Edge Canary/Dev 138+ with the
"Prompt API for on-device language model" flag runs everything on-device).
No remote code: all JavaScript ships in the package; the only network calls
are the optional Fast mode requests to api.subq.ai / api.typesafe.ai.
```

### Permission justifications

- `storage` — saves the user's on/off and per-site preferences and the optional Fast mode key (local only).
- `activeTab` — lets the popup read the current site to offer the per-site toggle.
- Content script on all URLs — comment boxes can be on any site; the script only reads the text field the user is typing in.
- Optional hosts `https://api.subq.ai/*`, `https://api.typesafe.ai/*` — requested only when the user turns on Fast mode.

## Automatic updates (after the first version is live in Partner Center)

1. Partner Center → Microsoft Edge → **Publish API** → enable it and create
   an API key (the key expires; note the date and renew it there).
2. GitHub → Settings → Secrets and variables → Actions:
   `EDGE_PRODUCT_ID` (Partner Center → extension → Product ID),
   `EDGE_CLIENT_ID`, `EDGE_API_KEY`.
3. From then on, every `vX.Y.Z` tag runs `scripts/publish-edge.js` in
   `.github/workflows/release.yml`: it uploads the Chrome zip, waits for
   validation and submits it for certification. Without the secrets the step
   is skipped.
