'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildJevRequest,
  handleJevMessage,
  jevAnalyze,
  jevErrorMessage,
  parseJevResponse,
  JEV_ENDPOINT,
  JEV_ORIGIN,
} = require('../jev.js');

function answer(choice, probabilities) {
  return { answers: { tone: { choice, probabilities } } };
}

function fakeFetch(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, fetchImpl };
}

const okResponse = body => ({ ok: true, status: 200, json: async () => body });

function stubChrome({ enabled = true, apiKey = 'tsk_test', granted = true } = {}) {
  const asked = [];
  global.chrome = {
    runtime: { id: 'test-extension' },
    storage: { local: { get: async defaults => ({ ...defaults, cvJevEnabled: enabled, cvJevKey: apiKey }) } },
    permissions: { contains: async query => { asked.push(query); return granted; } },
  };
  return asked;
}

test.afterEach(() => {
  delete global.chrome;
  delete global.browser;
});

test('buildJevRequest asks one four-way tone choice and truncates long text', () => {
  const request = buildJevRequest('x'.repeat(5000));
  assert.equal(request.model, 'jev-latest');
  assert.equal(request.state.length, 4000);
  assert.equal(request.questions.tone.type, 'choice');
  assert.deepEqual(Object.keys(request.questions.tone.criteria), ['positive', 'neutral', 'negative', 'toxic']);
});

test('parseJevResponse maps the choice and its probability', () => {
  const result = parseJevResponse(answer('toxic', { toxic: 0.82, negative: 0.18 }));
  assert.equal(result.sentiment, 'toxic');
  assert.equal(result.confidence, 0.82);
  assert.equal(result.rewrite, null);
  assert.match(result.reason, /82% sure/);
});

test('parseJevResponse tolerates casing and a missing probability map', () => {
  const result = parseJevResponse(answer(' Positive ', undefined));
  assert.equal(result.sentiment, 'positive');
  assert.equal(result.confidence, null);
  assert.doesNotMatch(result.reason, /sure/);
});

test('parseJevResponse rejects unknown or malformed answers', () => {
  assert.equal(parseJevResponse(answer('angry', {})), null);
  assert.equal(parseJevResponse({}), null);
  assert.equal(parseJevResponse(null), null);
  assert.equal(parseJevResponse({ answers: { tone: { choice: 3 } } }), null);
});

test('jevAnalyze posts to TypeSafe with a bearer key', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okResponse(answer('neutral', { neutral: 0.9 })));
  const result = await jevAnalyze('What time is the meetup?', 'tsk_abc', fetchImpl);
  assert.equal(result.sentiment, 'neutral');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, JEV_ENDPOINT);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tsk_abc');
  assert.equal(JSON.parse(calls[0].init.body).state, 'What time is the meetup?');
});

test('jevAnalyze refuses to call without a key', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okResponse({}));
  await assert.rejects(jevAnalyze('hi', '', fetchImpl), /No TypeSafe API key/);
  assert.equal(calls.length, 0);
});

test('jevAnalyze turns HTTP errors into readable messages', async () => {
  for (const [status, pattern] of [[401, /rejected the API key/], [429, /rate limit/], [503, /temporarily unavailable/], [400, /HTTP 400/]]) {
    const { fetchImpl } = fakeFetch(() => ({ ok: false, status, json: async () => ({}) }));
    await assert.rejects(jevAnalyze('hi', 'k', fetchImpl), pattern);
  }
  assert.match(jevErrorMessage(529), /temporarily unavailable/);
});

test('jevAnalyze reports unexpected bodies and timeouts', async () => {
  await assert.rejects(jevAnalyze('hi', 'k', fakeFetch(() => okResponse({ answers: {} })).fetchImpl), /Unexpected Jev response/);
  const aborting = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  await assert.rejects(jevAnalyze('hi', 'k', aborting), /did not answer in time/);
});

test('handleJevMessage ignores unrelated messages', () => {
  assert.equal(handleJevMessage({ type: 'cv-analyze' }), undefined);
  assert.equal(handleJevMessage(null), undefined);
});

test('cv-jev-analyze uses the stored key once Fast mode is on and permitted', async () => {
  const asked = stubChrome();
  const { calls, fetchImpl } = fakeFetch(() => okResponse(answer('negative', { negative: 0.7 })));
  const response = await handleJevMessage({ type: 'cv-jev-analyze', text: 'This is pointless.' }, fetchImpl);
  assert.equal(response.ok, true);
  assert.equal(response.result.sentiment, 'negative');
  assert.equal(typeof response.ms, 'number');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tsk_test');
  assert.deepEqual(asked, [{ origins: [JEV_ORIGIN] }]);
});

test('cv-jev-analyze never sends text while Fast mode is off or not permitted', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okResponse(answer('neutral', {})));
  stubChrome({ enabled: false });
  assert.deepEqual(await handleJevMessage({ type: 'cv-jev-analyze', text: 'hi' }, fetchImpl), { ok: false, error: 'Fast mode is off' });
  stubChrome({ apiKey: '' });
  assert.equal((await handleJevMessage({ type: 'cv-jev-analyze', text: 'hi' }, fetchImpl)).ok, false);
  stubChrome({ granted: false });
  assert.match((await handleJevMessage({ type: 'cv-jev-analyze', text: 'hi' }, fetchImpl)).error, /api\.typesafe\.ai/);
  assert.equal(calls.length, 0);
});

test('cv-jev-test prefers a freshly pasted key over the stored one', async () => {
  stubChrome({ enabled: false, apiKey: 'tsk_old' });
  const { calls, fetchImpl } = fakeFetch(() => okResponse(answer('positive', { positive: 0.95 })));
  const response = await handleJevMessage({ type: 'cv-jev-test', apiKey: '  tsk_new  ' }, fetchImpl);
  assert.equal(response.ok, true);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tsk_new');
  await handleJevMessage({ type: 'cv-jev-test', apiKey: '' }, fetchImpl);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer tsk_old');
});

test('cv-jev-test surfaces a rejected key', async () => {
  stubChrome();
  const { fetchImpl } = fakeFetch(() => ({ ok: false, status: 401, json: async () => ({}) }));
  assert.deepEqual(await handleJevMessage({ type: 'cv-jev-test', apiKey: 'bad' }, fetchImpl), { ok: false, error: 'TypeSafe rejected the API key' });
});
