'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyze,
  handleMessage,
  mapZeroShot,
  mlAvailable,
  resetEngineState,
  warmup,
} = require('../background.js');

const LABELS = ['friendly and positive', 'neutral and factual', 'harsh or critical', 'toxic or insulting'];

function stubBrowser({ runOutput, granted = true } = {}) {
  const calls = { create: 0, run: 0, args: null, options: null, notified: [] };
  global.browser = {
    permissions: { contains: async () => granted },
    trial: {
      ml: {
        createEngine: async () => { calls.create++; },
        runEngine: async ({ args, options }) => {
          calls.run++;
          calls.args = args;
          calls.options = options;
          return runOutput;
        },
        onProgress: { addListener() {} },
      },
    },
    tabs: {
      query: async () => [{ id: 1 }, { id: 7 }],
      sendMessage: async id => { calls.notified.push(id); },
    },
    runtime: { sendMessage: async () => {} },
  };
  return calls;
}

test.afterEach(() => {
  resetEngineState();
  delete global.browser;
});

test('mapZeroShot maps the top label to a sentiment with confidence', () => {
  const result = mapZeroShot({ labels: ['toxic or insulting', 'neutral and factual'], scores: [0.91, 0.05] });
  assert.equal(result.sentiment, 'toxic');
  assert.match(result.reason, /toxic or insulting \(91% confidence\)/);
  assert.equal(result.rewrite, null);
});

test('mapZeroShot accepts array-wrapped output and missing scores', () => {
  const result = mapZeroShot([{ labels: ['friendly and positive'] }]);
  assert.equal(result.sentiment, 'positive');
  assert.doesNotMatch(result.reason, /confidence/);
});

test('mapZeroShot rejects junk output', () => {
  assert.equal(mapZeroShot(null), null);
  assert.equal(mapZeroShot({ labels: [] }), null);
  assert.equal(mapZeroShot({ labels: ['something else'], scores: [1] }), null);
});

test('mlAvailable is false without browser.trial.ml or permission', async () => {
  assert.equal(await mlAvailable(), false);
  stubBrowser({ granted: false });
  assert.equal(await mlAvailable(), false);
  resetEngineState();
  stubBrowser({ granted: true });
  assert.equal(await mlAvailable(), true);
});

test('analyze runs the zero-shot pipeline with the four tone labels', async () => {
  const calls = stubBrowser({
    runOutput: { labels: ['harsh or critical', 'toxic or insulting'], scores: [0.72, 0.2] },
  });

  const result = await analyze('this is bad and you should feel bad');

  assert.equal(result.sentiment, 'negative');
  assert.equal(calls.create, 1);
  assert.equal(calls.run, 1);
  assert.deepEqual(calls.args, ['this is bad and you should feel bad', LABELS]);
  assert.equal(calls.options.hypothesis_template, 'The tone of this comment is {}.');
});

test('analyze reuses one engine across sequential runs', async () => {
  const calls = stubBrowser({ runOutput: { labels: LABELS, scores: [0.9, 0.05, 0.03, 0.02] } });
  await analyze('first comment');
  await analyze('second comment');
  assert.equal(calls.create, 1);
  assert.equal(calls.run, 2);
});

test('a failed engine creation is retried on the next analysis', async () => {
  const calls = stubBrowser({ runOutput: { labels: LABELS, scores: [0.9, 0.05, 0.03, 0.02] } });
  const workingCreate = global.browser.trial.ml.createEngine;
  global.browser.trial.ml.createEngine = async () => { throw new Error('download interrupted'); };

  await assert.rejects(analyze('first attempt'), /download interrupted/);
  global.browser.trial.ml.createEngine = workingCreate;
  const result = await analyze('second attempt');

  assert.equal(result.sentiment, 'positive');
  assert.equal(calls.run, 1);
});

// Firefox's parent-side engine outlives the MV3 background event page: after
// the event page is suspended and rewoken, createEngine rejects with
// "Engine already created" even though the engine is ready to run.
test('an "Engine already created" rejection is treated as an existing engine', async () => {
  const calls = stubBrowser({ runOutput: { labels: LABELS, scores: [0.9, 0.05, 0.03, 0.02] } });
  global.browser.trial.ml.createEngine = async () => {
    calls.create++;
    throw new Error('Engine already created');
  };

  const first = await analyze('typed after the event page restarted');
  const second = await analyze('and again');

  assert.equal(first.sentiment, 'positive');
  assert.equal(second.sentiment, 'positive');
  assert.equal(calls.create, 1);
  assert.equal(calls.run, 2);
});

test('handleMessage answers cv-status, cv-analyze, and cv-warmup', async () => {
  const calls = stubBrowser({ runOutput: { labels: ['neutral and factual'], scores: [0.8] } });

  assert.deepEqual(await handleMessage({ type: 'cv-status' }), { available: true });

  const analyzed = await handleMessage({ type: 'cv-analyze', text: 'plain facts here' });
  assert.equal(analyzed.ok, true);
  assert.equal(analyzed.result.sentiment, 'neutral');

  const warmed = await handleMessage({ type: 'cv-warmup' });
  assert.deepEqual(warmed, { ok: true });
  assert.deepEqual(calls.notified, [1, 7]);

  assert.equal(handleMessage({ type: 'unrelated' }), undefined);
  assert.equal(handleMessage(null), undefined);
});

test('handleMessage reports errors instead of throwing', async () => {
  const response = await handleMessage({ type: 'cv-analyze', text: 'anything' });
  assert.equal(response.ok, false);
  assert.match(response.error, /not enabled/);

  const warmed = await handleMessage({ type: 'cv-warmup' });
  assert.equal(warmed.ok, false);
});

test('warmup requires the trialML permission', async () => {
  stubBrowser({ granted: false });
  await assert.rejects(warmup(), /not enabled/);
});
