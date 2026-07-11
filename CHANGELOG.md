# Changelog

All notable changes to **Comment Vibe** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.2] - 2026-07-11

### Fixed
- Badge placement: the tone badge no longer covers typed text. It now sits above
  the input's top-right corner, flips below when there is no room at the top of
  the viewport, follows scrolling inside nested containers, and repositions as
  the input grows while typing.
- Analysis no longer slows down over time. Few-shots are kept in `initialPrompts`
  and each analysis runs on a fresh `clone()` of the session, preventing context
  growth and quota overflow.
- Analysis now streams via `promptStreaming()`: the badge renders as soon as the
  sentiment is available, while the reason and rewrite fill the tooltip when
  generation finishes.

## [1.1.1] - 2026-07-08

### Changed
- Store listing refresh: benefit-first manifest description ("See how your
  comment sounds before you post…"), new detailed description, and a full set
  of promo images (5 screenshots + small/marquee tiles) generated from HTML
  sources in `store-assets/` via `store-assets/render.sh`.
- The Web Store zip is now minimal: docs, `playground/`, `store-assets/`, and
  `icons/make-icons.html` are excluded from the package. No functional changes.

## [1.1.0] - 2026-06-14

### Added
- **Multilingual output.** Comments are now language-detected with the
  **Language Detector API**, and when the comment isn't in English the badge
  label, the reason, and the rewrite suggestion are translated into the
  comment's language with the **Translator API**. The rewrite therefore comes
  back ready to paste in the language you're writing in. Both APIs are stable
  in Chrome 138+. Detection and translation are best-effort: if the APIs, a
  model download, or a specific language pair are unavailable, the original
  English result is shown unchanged.

### Changed
- README rewritten to reflect that the Prompt API is **stable for Chrome
  Extensions since Chrome 138**. The `chrome://flags` setup is now documented
  only as a fallback for older builds (Chrome 127–137) rather than the default
  path, and a status table covers all built-in AI APIs.

## [1.0.0] - 2026-05-14

### Added
- Initial release. On-device tone analysis (positive / neutral / negative /
  toxic) of comments via Chrome's built-in Prompt API (Gemini Nano), with a
  kinder one-click rewrite suggestion for negative and toxic comments. Works on
  LinkedIn, X/Twitter, and YouTube, plus generic `contenteditable` and
  `textarea` comment fields across other sites. All analysis runs locally — no
  data leaves the device.
