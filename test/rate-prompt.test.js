'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RATE_PROMPT_MIN_AGE_MS,
  RATE_PROMPT_MAX_SHOWS,
  shouldShowRatePrompt,
} = require('../rate-prompt.js');

const now = Date.UTC(2026, 0, 15);
const eligibleState = {
  cvInstalledAt: now - RATE_PROMPT_MIN_AGE_MS,
  cvPopupOpens: 3,
  cvRatePrompt: '',
  cvRatePromptShown: 0,
};

test('requires a finite installation time and three days since install', () => {
  assert.equal(shouldShowRatePrompt({ ...eligibleState, cvInstalledAt: NaN }, now), false);
  assert.equal(
    shouldShowRatePrompt({
      ...eligibleState,
      cvInstalledAt: now - RATE_PROMPT_MIN_AGE_MS + 1,
    }, now),
    false,
  );
  assert.equal(shouldShowRatePrompt(eligibleState, now), true);
});

test('requires three popup opens', () => {
  assert.equal(shouldShowRatePrompt({ ...eligibleState, cvPopupOpens: 2 }, now), false);
  assert.equal(shouldShowRatePrompt(eligibleState, now), true);
});

test('stops after dismissal or the maximum number of displays', () => {
  assert.equal(
    shouldShowRatePrompt({ ...eligibleState, cvRatePrompt: 'done' }, now),
    false,
  );
  assert.equal(
    shouldShowRatePrompt({
      ...eligibleState,
      cvRatePromptShown: RATE_PROMPT_MAX_SHOWS,
    }, now),
    false,
  );
});
