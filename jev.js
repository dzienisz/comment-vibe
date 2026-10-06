'use strict';

// Optional "Fast mode": tone checks through TypeSafe's Jev decision model
// (https://docs.typesafe.ai). This is the only code path that sends text off
// the device, so it stays off until the user turns it on in the popup, grants
// the api.typesafe.ai host permission, and saves their own API key.
//
// Runs in the background context (Chrome service worker, Firefox background
// scripts) because extension pages with a granted host permission are exempt
// from CORS — the API rejects browser preflights from extension origins. The
// key lives in storage.local (never synced) and never reaches content scripts.
// Jev answers typed questions instead of writing text, so it only powers the
// tone badge; writing actions keep running on-device.

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_ORIGIN = 'https://api.typesafe.ai/*';
const JEV_MODEL = 'jev-latest';
const JEV_TIMEOUT_MS = 8_000;
const JEV_MAX_CHARS = 4_000;
const JEV_STORAGE = { enabled: 'cvJevEnabled', apiKey: 'cvJevKey' };
const JEV_SENTIMENTS = ['positive', 'neutral', 'negative', 'toxic'];

const JEV_QUESTIONS = {
  tone: {
    type: 'choice',
    instructions: 'How will other readers perceive the tone of this comment the user is about to post?',
    criteria: {
      positive: 'Friendly, appreciative, encouraging or supportive.',
      neutral: 'Factual, informational, or a calm question, with no strong emotion.',
      negative: 'Critical, dismissive, sarcastic, complaining or harsh, but without insults or slurs.',
      toxic: 'Contains insults, name-calling, slurs, threats, harassment or hateful language aimed at people.',
    },
  },
};

const JEV_READS_AS = {
  positive: 'friendly or appreciative',
  neutral: 'neutral and factual',
  negative: 'critical or harsh',
  toxic: 'insulting or hostile',
};

function buildJevRequest(text) {
  return {
    model: JEV_MODEL,
    state: String(text ?? '').slice(0, JEV_MAX_CHARS),
    questions: JEV_QUESTIONS,
  };
}

function parseJevResponse(body) {
  const answer = body?.answers?.tone;
  const sentiment = typeof answer?.choice === 'string' ? answer.choice.trim().toLowerCase() : '';
  if (!JEV_SENTIMENTS.includes(sentiment)) return null;
  const probability = answer.probabilities?.[answer.choice] ?? answer.probabilities?.[sentiment];
  const score = typeof probability === 'number' ? probability
    : typeof answer.confidence === 'number' ? answer.confidence : null;
  const sure = score === null ? '' : ` (${Math.round(score * 100)}% sure)`;
  return {
    sentiment,
    reason: `Jev reads this as ${JEV_READS_AS[sentiment]}${sure}.`,
    rewrite: null,
    confidence: score,
  };
}

function jevErrorMessage(status) {
  if (status === 401 || status === 403) return 'TypeSafe rejected the API key';
  if (status === 429) return 'TypeSafe rate limit reached — try again shortly';
  if (status === 529 || status >= 500) return 'TypeSafe is temporarily unavailable';
  return `Jev request failed (HTTP ${status})`;
}

async function jevAnalyze(text, apiKey, fetchImpl = fetch) {
  if (!apiKey) throw new Error('No TypeSafe API key saved');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS);
  try {
    const response = await fetchImpl(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildJevRequest(text)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(jevErrorMessage(response.status));
    const result = parseJevResponse(await response.json());
    if (!result) throw new Error('Unexpected Jev response');
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Jev did not answer in time');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function jevExtApi() {
  if (typeof browser !== 'undefined' && browser.runtime?.id) return browser;
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) return chrome;
  return null;
}

async function jevSettings(api = jevExtApi()) {
  const data = await Promise.resolve(
    api?.storage?.local?.get({ [JEV_STORAGE.enabled]: false, [JEV_STORAGE.apiKey]: '' }),
  ).catch(() => null);
  return {
    enabled: data?.[JEV_STORAGE.enabled] === true,
    apiKey: typeof data?.[JEV_STORAGE.apiKey] === 'string' ? data[JEV_STORAGE.apiKey] : '',
  };
}

async function jevPermitted(api = jevExtApi()) {
  try {
    return !!await api?.permissions?.contains({ origins: [JEV_ORIGIN] });
  } catch {
    return false;
  }
}

async function jevRun(text, apiKey, fetchImpl) {
  const started = Date.now();
  const result = await jevAnalyze(text, apiKey, fetchImpl);
  return { ok: true, result, ms: Date.now() - started };
}

function jevFailure(error) {
  return { ok: false, error: error?.message || 'Jev request failed' };
}

function handleJevMessage(message, fetchImpl) {
  switch (message?.type) {
    case 'cv-jev-analyze':
      return (async () => {
        const { enabled, apiKey } = await jevSettings();
        if (!enabled || !apiKey) throw new Error('Fast mode is off');
        if (!await jevPermitted()) throw new Error('Fast mode needs access to api.typesafe.ai');
        return jevRun(message.text, apiKey, fetchImpl);
      })().catch(jevFailure);
    case 'cv-jev-test':
      return (async () => {
        if (!await jevPermitted()) throw new Error('Fast mode needs access to api.typesafe.ai');
        const apiKey = typeof message.apiKey === 'string' && message.apiKey.trim()
          ? message.apiKey.trim()
          : (await jevSettings()).apiKey;
        return jevRun('Thanks for sharing this, it was really helpful!', apiKey, fetchImpl);
      })().catch(jevFailure);
  }
  return undefined;
}

// sendResponse + `return true` instead of returning the promise: Chrome only
// recently started honouring promise-returning onMessage listeners.
if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  jevExtApi()?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    const pending = handleJevMessage(message);
    if (!pending) return undefined;
    pending.then(sendResponse);
    return true;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildJevRequest,
    handleJevMessage,
    jevAnalyze,
    jevErrorMessage,
    parseJevResponse,
    JEV_ENDPOINT,
    JEV_ORIGIN,
    JEV_STORAGE,
  };
}
