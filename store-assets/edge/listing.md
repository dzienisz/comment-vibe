# Microsoft Edge Add-ons listing — Comment Vibe

Edge takes the **Chrome zip unchanged** (`comment-vibe-<version>.zip` from
`scripts/package.sh`). The copy below must stay honest about what works on
Edge:

- **The Prompt API is a developer preview on Edge — not on by default.**
  Microsoft officially supports it on Canary/Dev since 138
  ([docs](https://learn.microsoft.com/microsoft-edge/web-platform/prompt-api));
  the flag also exists on Stable (`edge://flags` → *Prompt API for on-device
  language model*). With the flag on, `LanguageModel` works in extension
  pages, content scripts and web pages — verified end-to-end on Edge Dev 157
  (Phi-4-mini / Aion models). Supported devices: Windows 10/11 or macOS 13.3+,
  5.5 GB VRAM, 20 GB free disk, unmetered network, *Device performance class*
  High or above in `edge://on-device-internals`
  ([hardware requirements](https://learn.microsoft.com/microsoft-edge/web-platform/prompt-api#hardware-requirements)).
  Admins can turn it off (`GenAILocalFoundationalModelSettings` policy), and it
  is not available in China. Known issue: the GPU model session can crash the
  model process on some machines (observed on macOS arm64); the prerelease CPU
  model (*Enable prerelease on-device language model* flag, Dev/Canary 150+)
  bypasses it.
- **Fast mode** (SubQ or TypeSafe key, opt-in cloud) works on every Edge
  device. Where the on-device model is unavailable it is the only way to get a
  tone badge; rewrites and writing actions need the on-device model.
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
     `shot6-controls.png`, `shot5-privacy.png` (`shot3-rewrite` and
     `shot4-languages` are optional — rewrites only work where the on-device
     model is available, and reviewers will likely test with Fast mode)
   - Search terms (max 7): tone checker, comment, kind, rewrite, on-device AI, privacy, writing assistant
6. **Notes for certification:** paste the text below **plus a working SubQ
   test key** (Kamil pastes it in Partner Center; never commit it here).

### Short description

Write with more clarity. AI shows how your comment may land before you post — on-device with Edge's built-in AI, or Fast mode with your key.

### Description

Your words matter. Comment Vibe gives you a quiet second look before you share them.

As you write a comment, a small badge shows how it may land: Positive, Neutral, Negative or Toxic. Click it for a short explanation of why.

HOW IT WORKS ON MICROSOFT EDGE
• On-device (preview): enable "Prompt API for on-device language model" in edge://flags and restart — Comment Vibe then runs entirely on your device with Edge's built-in model, including kinder rewrite suggestions and writing actions. No account, no servers. Needs Windows 10/11 or macOS 13.3+, 5.5 GB of GPU memory, 20 GB free disk; the model downloads once (a few GB).
• Fast mode: on any other device, turn on "Fast tone check in the cloud" in the popup and paste your own SubQ (subq.ai) or TypeSafe (typesafe.ai) API key. Only the text being checked is sent to that provider, with your key, which stays in this browser and is never synced. Off by default.

YOU'RE IN CONTROL
• Hide the guidance on one site directly from the tone card
• Turn Comment Vibe on or off globally, or per site
• Turn off automatic checks and press Alt+Shift+C to check on demand

WRITING TOOLS
Open the tone card to polish any draft, not only the harsh ones: Fix grammar, More professional, Friendlier, Shorter or Clearer. Preview the result, then use it or copy it. A rewrite you apply is marked "✓ Rewritten" and isn't judged again until you edit the text.

FOUR CLEAR TONE LABELS
😊 Positive — constructive and friendly
😐 Neutral — factual, or criticism said calmly and politely
😕 Negative — harsh, sarcastic, dismissive or blaming
🚫 Toxic — potentially aggressive or harmful language

PRIVATE BY DESIGN
No account, no tracking, no analytics. The on-device mode never sends your text anywhere; Fast mode sends only the text being checked, only after you turn it on.

UNINSTALL SURVEY
After uninstalling, your browser opens an optional Google Form. The extension sends no data with it, and the link has no identifiers. Answers are anonymous and covered by Google's Privacy Policy (https://policies.google.com/privacy). This is separate from on-device processing and optional Fast mode.

Open source (MIT): https://github.com/dzienisz/comment-vibe

### Notes for certification

```
Comment Vibe checks the tone of text the user types in comment boxes.
Edge's on-device model only runs on supported hardware (5.5 GB VRAM), so
please test with Fast mode:

1. Open any page with a text box, e.g. https://dzienko.dev/comment-vibe/ or a
   YouTube video's comment field.
2. Click the Comment Vibe toolbar icon → turn on "Fast tone check in the cloud".
3. Provider: SubQ. Paste this test key: <TEST KEY — added in Partner Center only>
   Accept the permission prompt for api.subq.ai.
4. Type "This is the dumbest idea I've ever read." into a comment box — a red
   "Negative"/"Toxic" badge appears; click it for the explanation.

Without a key, or where the on-device preview is unavailable, the popup shows
Edge setup help. With the edge://flags preview enabled on a supported device,
everything runs on-device with no key.
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
3. Optional: add `EDGE_CERTIFICATION_NOTES` with the certification notes
   above, test key included. Every automatic submission then sends them to
   reviewers ahead of the release link; without it reviewers only get the link.
4. From then on, every `vX.Y.Z` tag runs `scripts/publish-edge.js` in
   `.github/workflows/release.yml`: it uploads the Chrome zip, waits for
   validation and submits it for certification. Without the secrets the step
   is skipped.
