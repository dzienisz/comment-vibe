'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
