'use strict';

// Optional "Fast mode": tone checks through a cloud decision model — SubQ
// (https://docs.subq.ai) or TypeSafe's Jev (https://docs.typesafe.ai), same
// request/response contract. This is the only code path that sends text off
// the device, so it stays off until the user turns it on in the popup, grants
// the chosen provider's host permission, and saves their own API key.
//
// Runs in the background context (Chrome service worker, Firefox background
// scripts) because extension pages with a granted host permission are exempt
// from CORS — the API rejects browser preflights from extension origins. The
// key lives in storage.local (never synced) and never reaches content scripts.
// The providers answer typed questions instead of writing text, so they only
// power the tone badge; writing actions keep running on-device.

const JEV_PROVIDERS = {
  subq: {
    label: 'SubQ',
    vendor: 'SubQ',
    endpoint: 'https://api.subq.ai/v1/systemone',
    origin: 'https://api.subq.ai/*',
    model: 'subq-snap-preview',
    keyStorage: 'cvSubqKey',
  },
  typesafe: {
    label: 'Jev',
    vendor: 'TypeSafe',
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    origin: 'https://api.typesafe.ai/*',
    model: 'jev-latest',
    keyStorage: 'cvJevKey',
  },
};

const JEV_ENDPOINT = JEV_PROVIDERS.typesafe.endpoint;
const JEV_ORIGIN = JEV_PROVIDERS.typesafe.origin;
const JEV_TIMEOUT_MS = 8_000;
const JEV_MAX_CHARS = 4_000;
const JEV_STORAGE = {
  enabled: 'cvJevEnabled',
  provider: 'cvJevProvider',
  apiKey: 'cvJevKey',
  subqKey: 'cvSubqKey',
};
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

function jevProvider(id) {
  return JEV_PROVIDERS[id] || JEV_PROVIDERS.typesafe;
}

// Which provider a settings snapshot points at: the stored choice wins, then
// a saved TypeSafe key marks an existing user, and brand-new installs default
// to SubQ.
function resolveJevProvider(stored, typesafeKey) {
  if (JEV_PROVIDERS[stored]) return stored;
  return typeof typesafeKey === 'string' && typesafeKey.trim() ? 'typesafe' : 'subq';
}

function buildJevRequest(text, provider = 'typesafe') {
  return {
    model: jevProvider(provider).model,
    state: String(text ?? '').slice(0, JEV_MAX_CHARS),
    questions: JEV_QUESTIONS,
  };
}

function parseJevResponse(body, provider = 'typesafe') {
  const { label } = jevProvider(provider);
  const answer = body?.answers?.tone;
  const sentiment = typeof answer?.choice === 'string' ? answer.choice.trim().toLowerCase() : '';
  if (!JEV_SENTIMENTS.includes(sentiment)) return null;
  const probability = answer.probabilities?.[answer.choice] ?? answer.probabilities?.[sentiment];
  const score = typeof probability === 'number' ? probability
    : typeof answer.confidence === 'number' ? answer.confidence : null;
  const sure = score === null ? '' : ` (${Math.round(score * 100)}% sure)`;
  return {
    sentiment,
    reason: `${label} reads this as ${JEV_READS_AS[sentiment]}${sure}.`,
    rewrite: null,
    confidence: score,
    provider: JEV_PROVIDERS[provider] ? provider : 'typesafe',
  };
}

function jevErrorMessage(status, provider = 'typesafe') {
  const { label, vendor } = jevProvider(provider);
  if (status === 401 || status === 403) return `${vendor} rejected the API key`;
  if (status === 402) return `${vendor} account is out of credits`;
  if (status === 429) return `${vendor} rate limit reached — try again shortly`;
  if (status === 529 || status >= 500) return `${vendor} is temporarily unavailable`;
  return `${label} request failed (HTTP ${status})`;
}

async function jevAnalyze(text, apiKey, fetchImpl = fetch, provider = 'typesafe') {
  const info = jevProvider(provider);
  if (!apiKey) throw new Error(`No ${info.vendor} API key saved`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS);
  try {
    const response = await fetchImpl(info.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildJevRequest(text, provider)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(jevErrorMessage(response.status, provider));
    const result = parseJevResponse(await response.json(), provider);
    if (!result) throw new Error(`Unexpected ${info.label} response`);
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${info.label} did not answer in time`);
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
    api?.storage?.local?.get({
      [JEV_STORAGE.enabled]: false,
      [JEV_STORAGE.provider]: '',
      [JEV_STORAGE.apiKey]: '',
      [JEV_STORAGE.subqKey]: '',
    }),
  ).catch(() => null);
  const typesafeKey = typeof data?.[JEV_STORAGE.apiKey] === 'string' ? data[JEV_STORAGE.apiKey] : '';
  const provider = resolveJevProvider(data?.[JEV_STORAGE.provider], typesafeKey);
  const stored = data?.[JEV_PROVIDERS[provider].keyStorage];
  return {
    enabled: data?.[JEV_STORAGE.enabled] === true,
    provider,
    apiKey: typeof stored === 'string' ? stored : '',
  };
}

async function jevStoredKey(provider, api = jevExtApi()) {
  const data = await Promise.resolve(
    api?.storage?.local?.get({ [jevProvider(provider).keyStorage]: '' }),
  ).catch(() => null);
  const key = data?.[jevProvider(provider).keyStorage];
  return typeof key === 'string' ? key : '';
}

async function jevPermitted(provider = 'typesafe', api = jevExtApi()) {
  try {
    return !!await api?.permissions?.contains({ origins: [jevProvider(provider).origin] });
  } catch {
    return false;
  }
}

function jevHost(provider) {
  try {
    return new URL(jevProvider(provider).endpoint).host;
  } catch {
    return jevProvider(provider).host || 'the provider';
  }
}

async function jevRun(text, apiKey, fetchImpl, provider = 'typesafe') {
  const started = Date.now();
  const result = await jevAnalyze(text, apiKey, fetchImpl, provider);
  return { ok: true, result, ms: Date.now() - started };
}

function jevFailure(error) {
  return { ok: false, error: error?.message || 'Fast mode request failed' };
}

function handleJevMessage(message, fetchImpl) {
  switch (message?.type) {
    case 'cv-jev-analyze':
      return (async () => {
        const { enabled, provider, apiKey } = await jevSettings();
        if (!enabled || !apiKey) throw new Error('Fast mode is off');
        if (!await jevPermitted(provider)) throw new Error(`Fast mode needs access to ${jevHost(provider)}`);
        return jevRun(message.text, apiKey, fetchImpl, provider);
      })().catch(jevFailure);
    case 'cv-jev-test':
      return (async () => {
        const provider = JEV_PROVIDERS[message.provider]
          ? message.provider
          : (await jevSettings()).provider;
        if (!await jevPermitted(provider)) throw new Error(`Fast mode needs access to ${jevHost(provider)}`);
        const apiKey = typeof message.apiKey === 'string' && message.apiKey.trim()
          ? message.apiKey.trim()
          : await jevStoredKey(provider);
        return jevRun('Thanks for sharing this, it was really helpful!', apiKey, fetchImpl, provider);
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
    resolveJevProvider,
    JEV_PROVIDERS,
    JEV_ENDPOINT,
    JEV_ORIGIN,
    JEV_STORAGE,
  };
}
