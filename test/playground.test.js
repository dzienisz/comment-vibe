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
  assert.equal(RELEASE_INFO.verifiedAt, '2026-10-20');
  assert.equal(RELEASE_INFO.stable, 156);
  assert.equal(RELEASE_INFO.beta, 157);
  assert.equal(RELEASE_INFO.nextStableDate, '2026-11-03');
  assert.equal(APIS.find(api => api.id === 'proofreader').status, 'dev-trial');
  assert.equal(APIS.find(api => api.id === 'writer').status, 'deprecating');
  assert.equal(APIS.find(api => api.id === 'rewriter').status, 'deprecating');
  assert.equal(APIS.find(api => api.id === 'webmcp').status, 'origin-trial');
  assert.equal(APIS.find(api => api.id === 'webmcp').versions.find(v => v.v === 'Chrome 156').state, 'now');
  assert.equal(APIS.find(api => api.id === 'decisions').status, 'dev-trial');
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
  const out = await APIS[0].demo.run({ text: 'Hello' }, report);
  assert.match(out, /^Hello\n\n── Pomiar ──/);
  assert.match(out, /samplingMode: nie dotyczy/);
  assert.equal(destroyed, 1);
});

test('modern Prompt demo asks for greedy sampling (MTP) unless default sampling is picked', () => {
  const { APIS, getApiOptions } = loadPlayground({ LanguageModel: {} });
  const api = APIS.find(api => api.id === 'prompt');
  assert.equal(getApiOptions(api).samplingMode, 'most-predictable');
  assert.equal('samplingMode' in getApiOptions(api, { sampling: 'default' }), false);
  assert.match(api.description, /on-device-model-speculative-decoding/);
  assert.match(api.description, /gemma4-for-built-in-ai/);
  assert.match(api.description, /enable-experimental-web-platform-features/);
  assert.match(api.usage, /samplingMode: 'most-predictable'/);
});

test('Prompt demo reports whether the browser read samplingMode', async () => {
  for (const reads of [true, false]) {
    const { APIS } = loadPlayground({ LanguageModel: { create: async options => {
      if (reads) assert.equal(options.samplingMode, 'most-predictable');
      return { prompt: async () => 'Hi there', destroy() {} };
    } } });
    const out = await APIS[0].demo.run({ text: 'Hello', runs: '1' }, report);
    assert.match(out, reads ? /przeglądarka przyjęła opcję/ : /przeglądarka ZIGNOROWAŁA opcję/);
  }
});

test('Prompt demo measures TTFT and warm decode tok/s on fresh clones', async () => {
  let clock = 0;
  let clones = 0;
  let destroyed = 0;
  const clone = () => ({
    async *promptStreaming() { clock += 200; yield 'Hello'; clock += 500; yield ' world'; },
    measureContextUsage: async () => 11,
    destroy() { destroyed++; },
  });
  const { APIS } = loadPlayground({
    performance: { now: () => clock },
    LanguageModel: { create: async options => { void options.samplingMode; clock += 1000; return {
      clone: async () => { clones++; return clone(); },
      destroy() { destroyed++; },
    }; } },
  });
  const out = await APIS[0].demo.run({ text: 'Hello', runs: '3' }, report);
  assert.equal(clones, 3);
  assert.equal(destroyed, 4);
  assert.match(out, /^Hello world\n/);
  assert.match(out, /Tworzenie sesji: 1,0 s/);
  assert.match(out, /#2: 11 tok · TTFT 200 ms · dekodowanie 20,0 tok\/s · całość 700 ms/);
  assert.match(out, /Ciepłe dekodowanie \(mediana, przebiegi 2–3\): 20,0 tok\/s/);
  assert.match(out, /Opóźnienie odpowiedzi \(mediana, przebiegi 2–3\): 700 ms/);
  assert.match(out, /tokenizerem sesji/);
});

for (const [id, globalName, method, result] of [
  ['prompt', 'LanguageModel', 'prompt', 'Hello'],
  ['summarizer', 'Summarizer', 'summarize', 'Summary'],
  ['translator', 'Translator', 'translate', 'Translation'],
  ['detector', 'LanguageDetector', 'detect', [{ detectedLanguage: 'en', confidence: 0.99 }]],
  ['writer', 'Writer', 'write', 'Draft'],
  ['rewriter', 'Rewriter', 'rewrite', 'Revision'],
  ['proofreader', 'Proofreader', 'proofread', { correctedInput: 'Corrected', corrections: [] }],
  ['embedder', 'SemanticEmbedder', 'embed', { embeddings: [{ values: [1, 0] }, { values: [1, 0] }, { values: [0, 1] }, { values: [1, 1] }] }],
  ['decisions', 'DecisionModel', 'decide', { tone: { label: 'negative', confidence: 0.76, probabilities: { negative: 0.76 } }, contains_pii: { label: 'false', confidence: 0.97 } }],
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
  assert.match(await APIS[0].demo.run({ text: 'Hello' }, report), /^Recovered\n/);
  assert.equal(attempts, 2);
});

test('resources list only https links with labels and notes', () => {
  const { context } = loadPlayground();
  const resources = vm.runInContext('RESOURCES', context);
  const items = resources.flatMap(group => group.items);
  assert.ok(items.some(item => item.url.startsWith('https://web-ai.studio/')));
  for (const item of items) {
    assert.match(item.url, /^https:\/\//);
    assert.ok(item.label && item.note);
  }
});

test('every API has at least three tips', () => {
  const { APIS } = loadPlayground();
  for (const api of APIS) {
    assert.ok(api.tips.length >= 3, `${api.id} needs tips`);
    for (const tip of api.tips) assert.equal(typeof tip, 'string');
  }
});

test('Decisions API passes the tone schema to availability and formats the decision', async () => {
  let schema;
  const { APIS, checkApi } = loadPlayground({ DecisionModel: {
    availability: async options => { schema = options; return 'downloadable'; },
  } });
  const api = APIS.find(api => api.id === 'decisions');
  assert.equal(api.status, 'dev-trial');
  assert.equal(await checkApi(api), 'downloadable');
  assert.equal(JSON.stringify(schema.questions.map(q => q.id)), '["tone","contains_pii"]');
  assert.equal(schema.questions[0].options.map(o => o.label).join(), 'positive,neutral,negative,toxic');

  const { APIS: withModel } = loadPlayground({ DecisionModel: { create: async () => ({
    decide: async () => ({
      tone: { label: 'toxic', confidence: 0.68, probabilities: { positive: 0.02, neutral: 0.1, negative: 0.2, toxic: 0.68 } },
      contains_pii: { label: 'true', confidence: 0.91 },
    }),
    destroy() {},
  }) } });
  const out = await withModel.find(api => api.id === 'decisions').demo.run({ text: 'x' }, report);
  assert.match(out, /Ton: toxic \(pewność 68%\)/);
  assert.match(out, /toxic 68%/);
  assert.match(out, /Dane wrażliwe: tak \(pewność 91%\)/);
});

test('Decisions API reports no-api when DecisionModel is missing', async () => {
  const { APIS, checkApi } = loadPlayground();
  assert.equal(await checkApi(APIS.find(api => api.id === 'decisions')), 'no-api');
});

test('Decisions API formats array-shaped probabilities from the WebAI polyfill', async () => {
  const { APIS } = loadPlayground({ DecisionModel: { create: async () => ({
    decide: async () => ({
      tone: { label: 'neutral', confidence: 0.38, probabilities: [{ label: 'neutral', probability: 0.38 }, { label: 'negative', probability: 0.3 }] },
      contains_pii: { label: 'false', confidence: 0.67 },
    }),
    destroy() {},
  }) } });
  const out = await APIS.find(api => api.id === 'decisions').demo.run({ text: 'x' }, report);
  assert.match(out, /neutral 38% · negative 30%/);
  assert.match(out, /Dane wrażliwe: nie/);
});

test('Semantic Embedder demo embeds one batch and ranks sentences by cosine similarity', async () => {
  let input;
  const { APIS } = loadPlayground({ SemanticEmbedder: { create: async () => ({
    embed: async texts => {
      input = texts;
      return { embeddings: [{ values: [1, 0] }, { values: [0, 1] }, { values: [1, 0.1] }] };
    },
    destroy() {},
  }) } });
  const api = APIS.find(api => api.id === 'embedder');
  const out = await api.demo.run({ base: 'fox', others: 'tax\n\nhound' }, report);
  assert.equal(JSON.stringify(input), '["fox","tax","hound"]');
  assert.match(out, /Wektor: 2 wymiarów/);
  assert.ok(out.indexOf('hound') < out.indexOf('tax'));
  assert.match(out, /1\.00  hound/);
  assert.match(out, /0\.00  tax/);
});

test('Semantic Embedder reports no-api without the flag', async () => {
  const { APIS, checkApi } = loadPlayground();
  assert.equal(await checkApi(APIS.find(api => api.id === 'embedder')), 'no-api');
});

test('demo timer formats elapsed time in Polish', () => {
  const { context } = loadPlayground();
  const formatElapsed = vm.runInContext('formatElapsed', context);
  assert.equal(formatElapsed(840.4), '840 ms');
  assert.equal(formatElapsed(12345), '12,3 s');
});

test('form validation errors are marked as input errors and create no session', async () => {
  const SemanticEmbedder = { create() { assert.fail('validation must run before create()'); } };
  const Translator = { create() { assert.fail('validation must run before create()'); } };
  const { APIS } = loadPlayground({ SemanticEmbedder, Translator });
  const embedder = APIS.find(api => api.id === 'embedder');
  await assert.rejects(embedder.demo.run({ base: '  ', others: 'x' }, report), { name: 'InputError' });
  await assert.rejects(embedder.demo.run({ base: 'x', others: '\n \n' }, report), { name: 'InputError' });
  const translator = APIS.find(api => api.id === 'translator');
  await assert.rejects(translator.demo.run({ source: 'en', target: 'en', text: 'hi' }, report), { name: 'InputError' });
});

test('Edge tab covers every API with a known state and sits after a separator', () => {
  const ctx = loadPlayground().context;
  const { EDGE_STATUS, EDGE_STATE_META, APIS } = vm.runInContext('({ EDGE_STATUS, EDGE_STATE_META, APIS })', ctx);
  assert.deepEqual([...EDGE_STATUS.apis.map(r => r.id)], [...APIS.map(a => a.id)]);
  for (const row of EDGE_STATUS.apis) {
    assert.ok(EDGE_STATE_META[row.state], row.id);
    assert.ok(row.note.length > 10, row.id);
  }
  const byId = Object.fromEntries(EDGE_STATUS.apis.map(r => [r.id, r.state]));
  assert.equal(byId.translator, 'default');
  assert.equal(byId.detector, 'default');
  assert.equal(byId.prompt, 'preview');
  const src = fs.readFileSync(path.join(__dirname, '../playground/app.js'), 'utf8');
  const sep = src.indexOf("class: 'nav-sep'");
  assert.ok(sep > src.indexOf('for (const api of APIS)'), 'separator after the API list');
  assert.ok(src.indexOf("navItem('edge'") > sep && src.indexOf("navItem('firefox'") > sep);
});

test('isEdge detects Edge by brand or UA token, not Chrome', () => {
  const edge = loadPlayground({ navigator: { userAgent: 'Mozilla/5.0 Chrome/155.0 Safari/537.36 Edg/155.0' } }).context;
  assert.equal(vm.runInContext('isEdge()', edge), true);
  const chrome = loadPlayground({ navigator: { userAgent: 'Mozilla/5.0 Chrome/155.0 Safari/537.36' } }).context;
  assert.equal(vm.runInContext('isEdge()', chrome), false);
});
