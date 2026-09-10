'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadPlayground(globals = {}) {
  const context = vm.createContext({ console: { log() {}, warn() {} }, ...globals });
  context.window = context;
  for (const file of ['apis.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../playground', file), 'utf8'), context);
  }
  return { ...vm.runInContext('({ APIS, RELEASE_INFO, getApi, getApiOptions, checkApi, dl })', context), context };
}

const report = { status() {}, progress() {} };

function defaults(api) {
  return Object.fromEntries(api.demo.fields.map(field => [field.id, field.value]));
}

test('release snapshot distinguishes stable from planned releases', () => {
  const { RELEASE_INFO, APIS } = loadPlayground();
  assert.equal(RELEASE_INFO.verifiedAt, '2026-09-10');
  assert.equal(RELEASE_INFO.stable, 153);
  assert.equal(RELEASE_INFO.beta, 154);
  assert.equal(RELEASE_INFO.nextStableDate, '2026-09-22');
  assert.equal(APIS.find(api => api.id === 'proofreader').status, 'dev-trial');
  assert.equal(APIS.find(api => api.id === 'webmcp').status, 'origin-trial');
  assert.equal(APIS.find(api => api.id === 'webmcp').versions.find(v => v.v === 'Chrome 153').state, 'now');
});

test('modern Prompt API takes precedence over legacy without creating a session', async () => {
  const modern = { availability: async () => 'available', create() { assert.fail('check must not create'); } };
  const { APIS, getApi, checkApi } = loadPlayground({
    LanguageModel: modern,
    ai: { languageModel: { capabilities() { assert.fail('legacy must not be queried'); } } },
  });
  assert.equal(getApi('LanguageModel'), modern);
  assert.equal(await checkApi(APIS[0]), 'available');
});

for (const [legacy, expected] of [['readily', 'available'], ['after-download', 'downloadable'], ['no', 'unavailable']]) {
  test(`legacy Prompt capabilities ${legacy} maps to ${expected}`, async () => {
    const { APIS, checkApi } = loadPlayground({ ai: { languageModel: {
      capabilities: async () => ({ available: legacy }),
      create() { assert.fail('check must not create'); },
    } } });
    assert.equal(await checkApi(APIS[0]), expected);
  });
}

test('checks handle absent APIs, unknown future states, and failures', async () => {
  const missing = loadPlayground();
  assert.equal(await missing.checkApi(missing.APIS[0]), 'no-api');
  const future = loadPlayground({ LanguageModel: { availability: async () => 'new-state' } });
  assert.equal(await future.checkApi(future.APIS[0]), 'unknown');
  const broken = loadPlayground({ LanguageModel: { availability: async () => { throw new Error('blocked'); } } });
  assert.equal(await broken.checkApi(broken.APIS[0]), 'error');
});

test('availability checks use the selected demo options', async () => {
  let options;
  const { APIS, checkApi, getApiOptions } = loadPlayground({ Translator: {
    availability: async value => { options = value; return 'downloadable'; },
  } });
  const api = APIS.find(api => api.id === 'translator');
  assert.equal(await checkApi(api, { source: 'ja', target: 'fr' }), 'downloadable');
  assert.equal(options.sourceLanguage, 'ja');
  assert.equal(options.targetLanguage, 'fr');
  assert.equal(getApiOptions(api).sourceLanguage, 'en');
  assert.equal(getApiOptions(api).targetLanguage, 'pl');
});

test('legacy Prompt demo uses the same detected namespace and releases its session', async () => {
  let destroyed = 0;
  const { APIS } = loadPlayground({ ai: { languageModel: { create: async () => ({
    prompt: async text => text,
    destroy() { destroyed++; },
  }) } } });
  assert.equal(await APIS[0].demo.run({ text: 'Hello' }, report), 'Hello');
  assert.equal(destroyed, 1);
});

for (const [id, globalName, method, result] of [
  ['prompt', 'LanguageModel', 'prompt', 'Hello'],
  ['summarizer', 'Summarizer', 'summarize', 'Summary'],
  ['translator', 'Translator', 'translate', 'Translation'],
  ['detector', 'LanguageDetector', 'detect', [{ detectedLanguage: 'en', confidence: 0.99 }]],
  ['writer', 'Writer', 'write', 'Draft'],
  ['rewriter', 'Rewriter', 'rewrite', 'Revision'],
  ['proofreader', 'Proofreader', 'proofread', { correctedInput: 'Corrected', corrections: [] }],
]) {
  for (const fail of [false, true]) {
    test(`${id} releases the session after ${fail ? 'failure' : 'success'}`, async () => {
      let destroyed = 0;
      let createdOptions;
      const { APIS, getApiOptions } = loadPlayground({ [globalName]: { create: async options => {
        createdOptions = options;
        return {
          [method]: async () => { if (fail) throw new Error('inference failed'); return result; },
          destroy() { destroyed++; },
        };
      } } });
      const api = APIS.find(api => api.id === id);
      const values = defaults(api);
      const run = api.demo.run(values, report);
      if (fail) await assert.rejects(run, /inference failed/);
      else assert.equal(typeof await run, 'string');
      assert.equal(destroyed, 1);
      assert.equal(typeof createdOptions.monitor, 'function');
      for (const [key, value] of Object.entries(getApiOptions(api, values))) {
        assert.deepEqual(createdOptions[key], value);
      }
    });
  }
}

test('download progress supports normalized and byte-based events', () => {
  const { dl } = loadPlayground();
  const values = [];
  let listener;
  dl({ progress: value => values.push(value) })({ addEventListener(name, fn) {
    assert.equal(name, 'downloadprogress');
    listener = fn;
  } });
  for (const event of [{ loaded: 0.5 }, { loaded: 25, total: 100 }, { loaded: 2 }, { loaded: -1 }, {}]) listener(event);
  assert.deepEqual(values, [0.5, 0.25, 1, 0]);
});

test('WebMCP checks the registration method, preferring document over navigator', async () => {
  const { APIS, checkApi } = loadPlayground();
  const api = APIS.find(api => api.id === 'webmcp');
  assert.equal(await checkApi(api), 'no-api');
  const legacy = loadPlayground({ navigator: { modelContext: { registerTool() {} } } });
  assert.equal(await legacy.checkApi(legacy.APIS.find(api => api.id === 'webmcp')), 'detected');
  const incomplete = loadPlayground({ navigator: { modelContext: {} } });
  assert.equal(await incomplete.checkApi(incomplete.APIS.find(api => api.id === 'webmcp')), 'no-api');
  const modern = { registerTool() {} };
  legacy.context.document = { modelContext: modern };
  assert.equal(legacy.getApi('document.modelContext'), modern);
  assert.equal(await legacy.checkApi(legacy.APIS.find(api => api.id === 'webmcp')), 'detected');
});

test('modern Prompt declares English input/output without imposing new options on legacy', () => {
  const modern = loadPlayground({ LanguageModel: {} });
  const options = modern.getApiOptions(modern.APIS[0]);
  assert.equal(options.expectedInputs[0].languages[0], 'en');
  assert.equal(options.expectedOutputs[0].languages[0], 'en');
  const legacy = loadPlayground({ ai: { languageModel: {} } });
  assert.deepEqual(Object.keys(legacy.getApiOptions(legacy.APIS[0])), []);
});

test('demo calls create synchronously to preserve user activation and retries creation errors', async () => {
  let attempts = 0;
  const { APIS } = loadPlayground({ LanguageModel: { create: async () => {
    attempts++;
    if (attempts === 1) throw new Error('download interrupted');
    return { prompt: async () => 'Recovered', destroy() {} };
  } } });
  const first = APIS[0].demo.run({ text: 'Hello' }, report);
  assert.equal(attempts, 1);
  await assert.rejects(first, /download interrupted/);
  assert.equal(await APIS[0].demo.run({ text: 'Hello' }, report), 'Recovered');
  assert.equal(attempts, 2);
});
