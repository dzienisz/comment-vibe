'use strict';

(function (root) {
  const RATE_PROMPT_MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000;
  const RATE_PROMPT_MAX_SHOWS = 3;

  function shouldShowRatePrompt(state, now = Date.now()) {
    return (
      Number.isFinite(state?.cvInstalledAt) &&
      Number.isFinite(now) &&
      now - state.cvInstalledAt >= RATE_PROMPT_MIN_AGE_MS &&
      state.cvPopupOpens >= 3 &&
      state.cvRatePrompt !== 'done' &&
      (state.cvRatePromptShown || 0) < RATE_PROMPT_MAX_SHOWS
    );
  }

  const api = {
    RATE_PROMPT_MIN_AGE_MS,
    RATE_PROMPT_MAX_SHOWS,
    shouldShowRatePrompt,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CommentVibeRatePrompt = api;
  }
})(globalThis);
