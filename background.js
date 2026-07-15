'use strict';

// Firefox-only — never referenced from the Chrome manifest.
//
// Firefox exposes on-device inference to extensions through the WebExtensions
// AI API (browser.trial.ml, Firefox 134+). Unlike Chrome's Prompt API it is
// not a prompt LLM but a set of Transformers.js pipelines, and it is only
// reachable from extension pages — content scripts delegate here via runtime
// messages. Tone analysis runs a zero-shot classifier over the same four
// categories the Chrome path uses; there is no generated rewrite on this path.

const ENGINE_OPTIONS = {
  taskName: 'zero-shot-classification',
  modelHub: 'huggingface',
  // Xenova is one of the two organisations Firefox allows model downloads from
  modelId: 'Xenova/distilbert-base-uncased-mnli',
};

const CANDIDATES = [
  { label: 'friendly and positive', sentiment: 'positive' },
  { label: 'neutral and factual',   sentiment: 'neutral'  },
  { label: 'harsh or critical',     sentiment: 'negative' },
  { label: 'toxic or insulting',    sentiment: 'toxic'    },
];

const RUN_OPTIONS = { hypothesis_template: 'The tone of this comment is {}.' };

let enginePromise = null;
let runQueue = Promise.resolve();
let progressWired = false;

function hasML() {
  return typeof browser !== 'undefined' && !!browser.trial?.ml;
}

async function mlAvailable() {
  if (!hasML()) return false;
  try {
    return await browser.permissions.contains({ permissions: ['trialML'] });
  } catch {
    return false;
  }
}

// Model download progress, forwarded to the popup (rejected when it's closed).
// Wired lazily as well: browser.trial only appears once trialML is granted.
function wireProgress() {
  if (progressWired || !hasML()) return;
  progressWired = true;
  try {
    browser.trial.ml.onProgress.addListener(data => {
      browser.runtime.sendMessage({ type: 'cv-progress', data }).catch(() => {});
    });
  } catch {}
}

function ensureEngine() {
  if (!enginePromise) {
    wireProgress();
    enginePromise = browser.trial.ml.createEngine(ENGINE_OPTIONS).catch(error => {
      enginePromise = null; // e.g. interrupted download — let the next call retry
      throw error;
    });
  }
  return enginePromise;
}

// The runtime rejects parallel engine runs, so all inference is serialized.
function enqueueRun(args, options) {
  const run = runQueue.then(async () => {
    await ensureEngine();
    return browser.trial.ml.runEngine({ args, options });
  });
  runQueue = run.catch(() => {});
  return run;
}

function mapZeroShot(output) {
  const first = Array.isArray(output) ? output[0] : output;
  const labels = first?.labels;
  const scores = first?.scores;
  if (!Array.isArray(labels) || labels.length === 0) return null;
  const match = CANDIDATES.find(candidate => candidate.label === String(labels[0]));
  if (!match) return null;
  const score = Array.isArray(scores) && typeof scores[0] === 'number' ? scores[0] : null;
  const confidence = score === null ? '' : ` (${Math.round(score * 100)}% confidence)`;
  return {
    sentiment: match.sentiment,
    reason: `The on-device classifier read this as ${match.label}${confidence}.`,
    rewrite: null,
  };
}

async function analyze(text) {
  if (!await mlAvailable()) throw new Error('Firefox on-device AI is not enabled');
  const output = await enqueueRun(
    [text, CANDIDATES.map(candidate => candidate.label)],
    RUN_OPTIONS,
  );
  const result = mapZeroShot(output);
  if (!result) throw new Error('unexpected classifier output');
  return result;
}

// Content scripts that loaded before the permission grant sit dormant until
// this wakes them (see initFirefox in content.js).
async function notifyContentScripts() {
  try {
    const tabs = await browser.tabs.query({});
    await Promise.allSettled(
      tabs.map(tab => browser.tabs.sendMessage(tab.id, { type: 'cv-ml-ready' })),
    );
  } catch {}
}

async function warmup() {
  if (!await mlAvailable()) throw new Error('Firefox on-device AI is not enabled');
  await ensureEngine();
  await notifyContentScripts();
}

function handleMessage(message) {
  switch (message?.type) {
    case 'cv-status':
      return mlAvailable().then(available => ({ available }));
    case 'cv-analyze':
      return analyze(String(message.text ?? ''))
        .then(result => ({ ok: true, result }))
        .catch(error => ({ ok: false, error: error?.message || 'analysis failed' }));
    case 'cv-warmup':
      return warmup()
        .then(() => ({ ok: true }))
        .catch(error => ({ ok: false, error: error?.message || 'setup failed' }));
  }
  return undefined;
}

function resetEngineState() {
  enginePromise = null;
  runQueue = Promise.resolve();
  progressWired = false;
}

if (typeof browser !== 'undefined') {
  browser.runtime.onMessage.addListener(handleMessage);
  wireProgress();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    analyze,
    handleMessage,
    mapZeroShot,
    mlAvailable,
    resetEngineState,
    warmup,
  };
}
