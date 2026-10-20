'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const dir = path.join(__dirname, '../playground-firefox');

function load(globals = {}) {
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, ...globals });
  for (const file of ['tasks.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), context);
  }
  return vm.runInContext(`({ TASKS, FIREFOX_INFO, engineOptions, engineKey, tensorRows, cosine, progressPercent,
    usageSnippet, isAlreadyCreated, isDisabled, apiState, ensureEngine, getActiveEngine })`, context);
}

function fakeBrowser({ granted = true, ml = true, createError = null } = {}) {
  const session = {};
  const calls = [];
  const browser = {
    permissions: { contains: async () => granted },
    storage: {
      session: {
        get: async key => (key in session ? { [key]: session[key] } : {}),
        set: async obj => Object.assign(session, obj),
      },
      local: { set: async () => {} },
    },
  };
  if (ml) {
    browser.trial = { ml: {
      onProgress: { addListener() {} },
      createEngine: async opts => { calls.push(opts); if (createError) throw new Error(createError); },
    } };
  }
  return { browser, calls, session };
}

const values = task => Object.fromEntries(task.fields.map(f => [f.id, f.value]));
const report = { status() {} };

function loadWebFirefox() {
  const context = vm.createContext({ console: { log() {}, warn() {} } });
  context.window = context;
  for (const file of ['apis.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../playground', file), 'utf8'), context);
  }
  return vm.runInContext('({ FIREFOX_STATUS, POSITION_META })', context);
}

test('manifest keeps trialML optional and is a standalone Firefox add-on', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.optional_permissions, ['trialML']);
  assert.ok(!manifest.permissions.includes('trialML'));
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '134.0');
  assert.notEqual(manifest.browser_specific_settings.gecko.id, 'comment-vibe@dzienko.dev');
  for (const file of [...manifest.background.scripts, ...Object.values(manifest.icons), 'index.html']) {
    assert.ok(fs.existsSync(path.join(dir, file)), `${file} exists`);
  }
});

test('every task uses a Firefox-supported taskName and an allowed model organisation', () => {
  const { TASKS } = load();
  const { FIREFOX_STATUS } = loadWebFirefox();
  assert.equal(new Set(TASKS.map(t => t.id)).size, TASKS.length);
  for (const task of TASKS) {
    assert.ok(FIREFOX_STATUS.tasks.includes(task.taskName), task.taskName);
    for (const [modelId] of task.models) assert.match(modelId, /^(Mozilla|Xenova)\//, modelId);
  }
  const zeroShot = TASKS.find(t => t.taskName === 'zero-shot-classification');
  assert.ok(zeroShot.models.some(([id]) => id === 'Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7'));
});

test('default inputs build serialisable runEngine requests and readable snippets', () => {
  const { TASKS, usageSnippet } = load();
  for (const task of TASKS) {
    const args = task.args(values(task));
    assert.ok(Array.isArray(args) && args.length > 0, task.id);
    assert.doesNotThrow(() => JSON.stringify({ args, options: task.options(values(task)) }));
    const snippet = usageSnippet(task, values(task), task.models[0][0]);
    assert.match(snippet, new RegExp(`"taskName": "${task.taskName}"`));
    assert.match(snippet, /optional_permissions/);
  }
  const zeroShot = TASKS.find(t => t.id === 'zero-shot');
  assert.equal(zeroShot.args(values(zeroShot))[1].length, 4);
});

test('formatters turn pipeline output into text', () => {
  const { TASKS } = load();
  const fmt = (id, out) => TASKS.find(t => t.id === id).format(out);
  assert.equal(fmt('zero-shot', { labels: ['a', 'b'], scores: [0.9, 0.1] }), ' 90%  a\n 10%  b');
  assert.equal(fmt('sentiment', [{ label: 'POSITIVE', score: 0.99 }]), ' 99%  POSITIVE');
  assert.equal(fmt('qa', { answer: 'on your device', score: 0.5 }), 'on your device  ( 50%)');
  assert.equal(fmt('summarization', [{ summary_text: 'Short.' }]), 'Short.');
  assert.equal(fmt('translation', [{ translation_text: 'Hallo' }]), 'Hallo');
  assert.equal(fmt('ner', [{ entity: 'B-PER', word: 'Kamil', score: 1 }]), 'B-PER  Kamil  100%');
  assert.match(fmt('embeddings', { dims: [2, 2], data: { 0: 1, 1: 0, 2: 1, 3: 0, length: 4 } }), /1,000 · wymiar wektora: 2/);
});

test('tensorRows reads dims/data tensors and nested arrays', () => {
  const pg = load();
  const { cosine } = pg;
  const tensorRows = x => JSON.parse(JSON.stringify(pg.tensorRows(x)));
  assert.deepEqual(tensorRows({ dims: [2, 3], data: [1, 2, 3, 4, 5, 6] }), [[1, 2, 3], [4, 5, 6]]);
  assert.deepEqual(tensorRows([[1, 0], [0, 1]]), [[1, 0], [0, 1]]);
  assert.deepEqual(tensorRows(null), []);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

test('progressPercent handles fraction, percent and byte shapes', () => {
  const { progressPercent } = load();
  assert.equal(progressPercent({ progress: 0.42 }), 42);
  assert.equal(progressPercent({ progress: 42 }), 42);
  assert.equal(progressPercent({ totalLoaded: 5, total: 20 }), 25);
  assert.equal(progressPercent({ total: 0, totalLoaded: 0 }), null);
  assert.equal(progressPercent({}), null);
});

test('apiState reports extension, permission and API presence', async () => {
  assert.equal(await load().apiState(), 'no-extension');
  assert.equal(await load(fakeBrowser({ granted: false })).apiState(), 'no-permission');
  assert.equal(await load(fakeBrowser({ ml: false })).apiState(), 'no-api');
  assert.equal(await load(fakeBrowser()).apiState(), 'ready');
});

test('ensureEngine creates one engine per run and asks to reload for another task', async () => {
  const fake = fakeBrowser();
  const pg = load(fake);
  const [sentiment, ner] = [pg.TASKS.find(t => t.id === 'sentiment'), pg.TASKS.find(t => t.id === 'ner')];
  assert.equal(await pg.ensureEngine(pg.engineOptions(sentiment), report), 'ready');
  assert.equal(await pg.ensureEngine(pg.engineOptions(sentiment), report), 'ready');
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].taskName, 'text-classification');
  assert.equal(fake.calls[0].modelHub, 'huggingface');
  assert.equal(await pg.getActiveEngine(), pg.engineKey(pg.engineOptions(sentiment)));
  assert.equal(await pg.ensureEngine(pg.engineOptions(ner), report), 'switch');
  assert.equal(fake.calls.length, 1);
});

test('ensureEngine maps Firefox errors', async () => {
  const already = load(fakeBrowser({ createError: 'Engine already created' }));
  assert.equal(await already.ensureEngine(already.engineOptions(already.TASKS[0]), report), 'switch');
  const disabled = 'Trial ML API is disabled. This API is only available when "extensions.ml.enabled" and browser.ml.enable" preferences are set to true.';
  const blocked = load(fakeBrowser({ createError: disabled }));
  await assert.rejects(blocked.ensureEngine(blocked.engineOptions(blocked.TASKS[0]), report), err => blocked.isDisabled(err));
  assert.equal(await blocked.getActiveEngine(), null);
  assert.ok(!blocked.isAlreadyCreated(new Error(disabled)));
});

test('styles.css stays a copy of the Chrome playground stylesheet', () => {
  assert.equal(fs.readFileSync(path.join(dir, 'styles.css'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../playground/styles.css'), 'utf8'));
});

test('website Firefox status lists web APIs as unavailable with Mozilla positions', () => {
  const { FIREFOX_STATUS, POSITION_META } = loadWebFirefox();
  const { FIREFOX_INFO } = load();
  assert.equal(FIREFOX_STATUS.verifiedAt, FIREFOX_INFO.verifiedAt);
  assert.equal(FIREFOX_STATUS.release, FIREFOX_INFO.release);
  assert.deepEqual([...FIREFOX_STATUS.webApis.map(r => r.issue)], [1213, 1015, 1067, 1219, 1215]);
  for (const row of FIREFOX_STATUS.webApis) assert.ok(POSITION_META[row.position], row.api);
  assert.equal(FIREFOX_STATUS.tasks.length, 22);
  assert.match(FIREFOX_STATUS.playgroundUrl, /playground-firefox$/);
});
