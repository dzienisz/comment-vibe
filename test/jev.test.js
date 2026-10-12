'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildJevRequest,
  handleJevMessage,
  jevAnalyze,
  jevErrorMessage,
  parseJevResponse,
  resolveJevProvider,
  JEV_ENDPOINT,
  JEV_ORIGIN,
  JEV_PROVIDERS,
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

function stubChrome({ enabled = true, apiKey = 'tsk_test', granted = true, store = {}, origins = null } = {}) {
  const asked = [];
  const storage = { cvJevEnabled: enabled, cvJevKey: apiKey, ...store };
  const isGranted = query => origins ? query.origins.some(o => origins.includes(o)) : granted;
  global.chrome = {
    runtime: { id: 'test-extension' },
    storage: { local: { get: async defaults => ({ ...defaults, ...storage }) } },
    permissions: { contains: async query => { asked.push(query); return isGranted(query); } },
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

test('buildJevRequest picks the provider model', () => {
  assert.equal(buildJevRequest('hi', 'subq').model, 'subq-snap-preview');
  assert.equal(buildJevRequest('hi').model, 'jev-latest');
  assert.equal(buildJevRequest('hi', 'typesafe').model, 'jev-latest');
});

test('jevAnalyze with provider subq posts to SubQ and labels the result', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okResponse(answer('toxic', { toxic: 0.9 })));
  const result = await jevAnalyze('you are the worst', 'sq_abc', fetchImpl, 'subq');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.subq.ai/v1/systemone');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sq_abc');
  assert.equal(result.provider, 'subq');
  assert.match(result.reason, /^SubQ reads this as/);
});

test('jevErrorMessage names the provider vendor', () => {
  assert.equal(jevErrorMessage(402, 'subq'), 'SubQ account is out of credits');
  assert.equal(jevErrorMessage(401, 'typesafe'), 'TypeSafe rejected the API key');
  assert.equal(jevErrorMessage(401, 'subq'), 'SubQ rejected the API key');
});

test('resolveJevProvider defaults to SubQ for new users, TypeSafe for existing keys', () => {
  assert.equal(resolveJevProvider('subq', 'k'), 'subq');
  assert.equal(resolveJevProvider(undefined, 'k'), 'typesafe');
  assert.equal(resolveJevProvider(undefined, ''), 'subq');
  assert.equal(resolveJevProvider('bogus', ''), 'subq');
});

test('cv-jev-analyze with subq settings calls SubQ with the SubQ key', async () => {
  stubChrome({
    store: { cvJevProvider: 'subq', cvSubqKey: 's1', cvJevKey: 't1' },
    origins: [JEV_PROVIDERS.subq.origin],
  });
  const { calls, fetchImpl } = fakeFetch(() => okResponse(answer('neutral', { neutral: 0.8 })));
  const response = await handleJevMessage({ type: 'cv-jev-analyze', text: 'hi' }, fetchImpl);
  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.subq.ai/v1/systemone');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer s1');
});

test('cv-jev-analyze refuses without the subq host permission', async () => {
  stubChrome({
    store: { cvJevProvider: 'subq', cvSubqKey: 's1', cvJevKey: 't1' },
    origins: [JEV_PROVIDERS.typesafe.origin],
  });
  const { calls, fetchImpl } = fakeFetch(() => okResponse(answer('neutral', {})));
  const response = await handleJevMessage({ type: 'cv-jev-analyze', text: 'hi' }, fetchImpl);
  assert.equal(response.ok, false);
  assert.match(response.error, /api\.subq\.ai/);
  assert.equal(calls.length, 0);
});

test('cv-jev-analyze for an existing TypeSafe user hits TypeSafe', async () => {
  stubChrome({ origins: [JEV_PROVIDERS.typesafe.origin], apiKey: 't1' });
  const { calls, fetchImpl } = fakeFetch(() => okResponse(answer('positive', { positive: 0.9 })));
  const response = await handleJevMessage({ type: 'cv-jev-analyze', text: 'hi' }, fetchImpl);
  assert.equal(response.ok, true);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t1');
});

test('cv-jev-test with provider subq uses the stored SubQ key', async () => {
  stubChrome({
    store: { cvJevProvider: 'subq', cvSubqKey: 's1', cvJevKey: 't1' },
    origins: [JEV_PROVIDERS.subq.origin, JEV_PROVIDERS.typesafe.origin],
  });
  const { calls, fetchImpl } = fakeFetch(() => okResponse(answer('positive', { positive: 0.9 })));
  const response = await handleJevMessage({ type: 'cv-jev-test', provider: 'subq' }, fetchImpl);
  assert.equal(response.ok, true);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer s1');
  assert.equal(calls[0].url, 'https://api.subq.ai/v1/systemone');
});
