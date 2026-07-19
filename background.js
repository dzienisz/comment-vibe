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
  // Xenova is one of the two organisations Firefox allows model downloads from.
  // Multilingual NLI (mDeBERTa-v3, ~100 languages): unlike the English-only
  // distilbert-mnli it shipped with, it classifies non-English comments
  // correctly (measured on an EN+PL sample set: 11/16 vs 7/16, with Polish
  // positives no longer collapsing to "negative"). Trade-off: ~340 MB download
  // (q8) instead of ~65 MB, and roughly 3x slower inference — still well under
  // a second per comment.
  modelId: 'Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7',
  dtype: 'q8',
};

// Label phrasing tuned together with the model swap — descriptive adjective
// phrases scored best with this NLI head across EN and PL samples.
const CANDIDATES = [
  { label: 'friendly and appreciative',    sentiment: 'positive' },
  { label: 'a neutral factual statement',  sentiment: 'neutral'  },
  { label: 'critical or dismissive',       sentiment: 'negative' },
  { label: 'insulting or hateful',         sentiment: 'toxic'    },
];

const RUN_OPTIONS = { hypothesis_template: 'This comment is {}.' };

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
      // Firefox keeps the engine in the parent process, where it outlives this
      // MV3 event page. After a background restart createEngine rejects with
      // "Engine already created" — the engine is fine, so treat it as ready
      // (runEngine transparently revives it if it was closed for inactivity).
      if (/already created/i.test(error?.message || '')) return;
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
  // Pre-download the model right after install/update (when permitted), so a
  // model swap in an update doesn't stall the first in-page analysis behind
  // a full download. Cached models make this a no-op.
  browser.runtime.onInstalled?.addListener(() => {
    mlAvailable().then(available => { if (available) ensureEngine().catch(() => {}); });
  });
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
