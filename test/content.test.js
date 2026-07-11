'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  beginInputChange,
  invalidateRequest,
  isCleanupEligible,
  isCurrentRequest,
  normalize,
  normalizeDetectedLanguage,
  parseResponse,
  streamPrompt,
} = require('../content.js');

function sessionFor(chunks) {
  return {
    async * promptStreaming() {
      yield * chunks;
    },
  };
}

test('parseResponse parses valid JSON', () => {
  assert.deepEqual(parseResponse('{"sentiment":"positive","reason":"Helpful."}'), {
    sentiment: 'positive',
    reason: 'Helpful.',
  });
});

test('parseResponse extracts JSON surrounded by prose', () => {
  assert.deepEqual(parseResponse('Result: {"sentiment":"negative","reason":"Harsh."} Done.'), {
    sentiment: 'negative',
    reason: 'Harsh.',
  });
});

test('parseResponse falls back to toxic for malformed toxic output', () => {
  assert.deepEqual(parseResponse('The output is toxic {not-json'), { sentiment: 'toxic' });
});

test('parseResponse falls back to negative for negative keywords', () => {
  assert.deepEqual(parseResponse('This sounds harsh'), { sentiment: 'negative' });
});

test('parseResponse falls back to positive for positive keywords', () => {
  assert.deepEqual(parseResponse('This sounds kind'), { sentiment: 'positive' });
});

test('parseResponse falls back to neutral without recognized keywords', () => {
  assert.deepEqual(parseResponse('No classification available'), { sentiment: 'neutral' });
});

test('normalize accepts an alternative reason key', () => {
  assert.equal(normalize({ sentiment: 'negative', tone: 'Dismissive.' }).reason, 'Dismissive.');
});

test('normalize accepts an alternative rewrite key', () => {
  assert.equal(
    normalize({ sentiment: 'toxic', suggestion: 'Please reconsider this.' }).rewrite,
    'Please reconsider this.',
  );
});

test('normalize removes rewrites for positive and neutral results', () => {
  assert.equal(normalize({ sentiment: 'positive', rewrite: 'Unused.' }).rewrite, null);
  assert.equal(normalize({ sentiment: 'neutral', rewrite: 'Unused.' }).rewrite, null);
});

test('normalize converts an empty rewrite to null', () => {
  assert.equal(normalize({ sentiment: 'negative', rewrite: '   ' }).rewrite, null);
});

test('normalize safely defaults null and array inputs', () => {
  const fallback = {
    sentiment: 'neutral',
    emoji: '😐',
    label: 'Neutral',
    reason: '',
    rewrite: null,
  };

  assert.deepEqual(normalize(null), fallback);
  assert.deepEqual(normalize([]), fallback);
});

test('normalize rejects object-valued user-facing fields', () => {
  assert.deepEqual(normalize({
    sentiment: 'negative',
    label: { html: '<b>Hostile</b>' },
    reason: { text: 'Harsh.' },
    rewrite: { text: 'Please reconsider.' },
  }), {
    sentiment: 'negative',
    emoji: '😕',
    label: 'Negative',
    reason: '',
    rewrite: null,
  });
});

test('normalize trims and lowercases sentiment and localized labels', () => {
  assert.deepEqual(normalize({
    sentiment: '  TOXIC  ',
    label: '  Toksyczne  ',
    reason: 'Obraźliwy ton.',
    rewrite: '  Proszę wyrazić to uprzejmiej.  ',
  }), {
    sentiment: 'toxic',
    emoji: '🚫',
    label: 'Toksyczne',
    reason: 'Obraźliwy ton.',
    rewrite: 'Proszę wyrazić to uprzejmiej.',
  });
});

test('normalize replaces empty labels and malicious emoji with canonical values', () => {
  assert.deepEqual(normalize({
    sentiment: 'positive',
    emoji: '<img src=x onerror=alert(1)>',
    label: '   ',
    reason: 'Friendly.',
    rewrite: 'Must not survive.',
  }), {
    sentiment: 'positive',
    emoji: '😊',
    label: 'Positive',
    reason: 'Friendly.',
    rewrite: null,
  });
});

test('normalize preserves markup-like strings as literal display text', () => {
  assert.deepEqual(normalize({
    sentiment: 'toxic',
    emoji: '<img src=x onerror=alert(1)>',
    label: '<b>Toxic</b>',
    reason: 'Use x < 10 and keep <3 as text.',
    rewrite: 'Prefer <option A> over <option B>.',
  }), {
    sentiment: 'toxic',
    emoji: '🚫',
    label: '<b>Toxic</b>',
    reason: 'Use x < 10 and keep <3 as text.',
    rewrite: 'Prefer <option A> over <option B>.',
  });
});

test('normalizeDetectedLanguage returns the primary language subtag', () => {
  assert.equal(normalizeDetectedLanguage({ detectedLanguage: 'pl-PL', confidence: 0.9 }), 'pl');
});

test('normalizeDetectedLanguage rejects undetermined language', () => {
  assert.equal(normalizeDetectedLanguage({ detectedLanguage: 'und', confidence: 0.9 }), null);
});

test('normalizeDetectedLanguage rejects confidence below 0.5', () => {
  assert.equal(normalizeDetectedLanguage({ detectedLanguage: 'pl-PL', confidence: 0.49 }), null);
});

test('normalizeDetectedLanguage rejects absent detection', () => {
  assert.equal(normalizeDetectedLanguage(undefined), null);
});

test('streamPrompt accumulates delta chunks', async () => {
  const raw = await streamPrompt(
    sessionFor(['"negative"', ',"reason":"Harsh."}']),
    [{ role: 'user', content: 'message' }],
  );

  assert.equal(raw, '"negative","reason":"Harsh."}');
});

test('streamPrompt accepts cumulative chunks', async () => {
  const raw = await streamPrompt(
    sessionFor(['"positive"', '"positive","reason":"Kind."}']),
    [{ role: 'user', content: 'message' }],
  );

  assert.equal(raw, '"positive","reason":"Kind."}');
});

test('streamPrompt fires the early sentiment callback exactly once', async () => {
  const sentiments = [];
  const raw = await streamPrompt(
    sessionFor(['"toxic"', ',"reason":"Hostile."', ',"rewrite":"Be respectful."}']),
    [{ role: 'user', content: 'message' }],
    sentiment => sentiments.push(sentiment),
  );

  assert.equal(raw, '"toxic","reason":"Hostile.","rewrite":"Be respectful."}');
  assert.deepEqual(sentiments, ['toxic']);
});

test('invalidateRequest clears pending work and increments the request ID once', () => {
  let abortCalls = 0;
  const state = {
    debounceTimer: setTimeout(() => assert.fail('timer should have been cancelled'), 60_000),
    abortController: { abort: () => { abortCalls++; } },
    requestId: 7,
  };

  const requestId = invalidateRequest(state);

  assert.equal(requestId, 8);
  assert.equal(state.requestId, 8);
  assert.equal(state.debounceTimer, null);
  assert.equal(state.abortController, null);
  assert.equal(abortCalls, 1);
});

test('beginInputChange leaves an unchanged input request active', () => {
  let abortCalls = 0;
  const timer = setTimeout(() => {}, 60_000);
  const state = {
    debounceTimer: timer,
    abortController: { abort: () => { abortCalls++; } },
    lastText: 'same comment text',
    requestId: 3,
  };

  const requestId = beginInputChange(state, 'same comment text');

  assert.equal(requestId, null);
  assert.equal(state.requestId, 3);
  assert.equal(state.debounceTimer, timer);
  assert.equal(abortCalls, 0);
  clearTimeout(timer);
});

test('cleanup eligibility rejects connected elements', () => {
  assert.equal(isCleanupEligible({ isConnected: true }), false);
});

test('cleanup eligibility accepts disconnected elements', () => {
  assert.equal(isCleanupEligible({ isConnected: false }), true);
});

test('an aborted stream cannot produce a current final result', async () => {
  const controller = new AbortController();
  const state = {
    debounceTimer: null,
    abortController: controller,
    requestId: 1,
  };
  const requestId = state.requestId;
  let finalRendered = false;
  const session = {
    async * promptStreaming(messages, options) {
      assert.deepEqual(messages, [{ role: 'user', content: 'message' }]);
      assert.equal(options.signal, controller.signal);
      yield '"negative"';
      if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      yield ',"reason":"Harsh."}';
    },
  };

  await assert.rejects(
    streamPrompt(
      session,
      [{ role: 'user', content: 'message' }],
      () => invalidateRequest(state),
      controller.signal,
    ).then(() => {
      if (isCurrentRequest(state, requestId)) finalRendered = true;
    }),
    { name: 'AbortError' },
  );

  assert.equal(controller.signal.aborted, true);
  assert.equal(state.requestId, 2);
  assert.equal(finalRendered, false);
});
