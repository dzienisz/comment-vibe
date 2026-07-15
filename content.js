'use strict';

// ── Config ──────────────────────────────────────────────────────────────────

const MIN_LENGTH  = 15;
const DEBOUNCE_MS = 900;
const SESSION_TTL = 600_000;
const ANALYSIS_TIMEOUT_MS = 30_000;
const MODEL_DOWNLOAD_TIMEOUT_MS = 300_000;

const SENTIMENT_CLASS = {
  positive: 'cv-badge--positive',
  neutral:  'cv-badge--neutral',
  negative: 'cv-badge--negative',
  toxic:    'cv-badge--toxic',
};

const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'negative', 'toxic']);

const EMOJI_FOR = { positive: '😊', neutral: '😐', negative: '😕', toxic: '🚫' };
const LABEL_FOR = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative', toxic: 'Toxic' };

const COLOR_MAP = {
  positive: { bg: '#dcfce7', color: '#15803d', border: '1px solid #86efac' },
  neutral:  { bg: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' },
  negative: { bg: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' },
  toxic:    { bg: '#f3e8ff', color: '#6d28d9', border: '1px solid #c4b5fd' },
};

const SYSTEM_PROMPT = `You are a tone and sentiment analyzer for social media comments.
Respond with raw JSON only — no markdown, no explanation outside the JSON object.
Use exactly this structure:
{"sentiment":"positive|neutral|negative|toxic","emoji":"😊|😐|😕|🚫","label":"Positive|Neutral|Negative|Toxic","reason":"one sentence max 20 words","rewrite":"improved kinder version or null"}
Set rewrite to a kinder rewritten version when sentiment is negative or toxic, otherwise null.`;

const LANGUAGE_OPTIONS = {
  expectedInputs:  [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

const SELECTORS = [
  '.ql-editor[contenteditable="true"]',
  '[data-testid="tweetTextarea_0"]',
  '[data-testid^="tweetTextarea"][contenteditable="true"]',
  '#contenteditable-root[contenteditable="true"]',
  'yt-formatted-string[contenteditable="true"]',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][aria-label*="comment" i]',
  '[contenteditable="true"][aria-label*="reply" i]',
  '[contenteditable="true"][aria-placeholder*="comment" i]',
  '[contenteditable="true"][data-placeholder*="comment" i]',
  '[contenteditable="true"][data-placeholder*="reply" i]',
  'textarea[placeholder*="comment" i]',
  'textarea[placeholder*="reply" i]',
  'textarea[placeholder*="write" i]',
];

// ── AI session ───────────────────────────────────────────────────────────────

let reusableSession = null;
let sessionCreation = null;
let lastUsedAt = 0;
// true when the few-shot examples are baked into the session via initialPrompts
// (they then survive clone() and don't need re-sending with every prompt)

function sessionMetadata(session, fewShotBaked) {
  return { session, fewShotBaked, cloneCapable: typeof session.clone === 'function' };
}

function supportsReducedOptionsRetry(error) {
  return error instanceof TypeError || error?.name === 'NotSupportedError';
}

// Cheap, non-triggering check: availability()/capabilities() never starts a
// download by themselves, so this can be polled before deciding whether to
// show "Analyzing…" or an honest "model is still downloading" state.
async function getModelStatus() {
  if (typeof LanguageModel !== 'undefined') {
    const avail = await LanguageModel.availability();
    if (avail === 'unavailable') return 'unavailable';
    return avail === 'available' ? 'available' : 'downloading';
  }
  if (typeof window !== 'undefined' && window.ai?.languageModel) {
    const { available } = await window.ai.languageModel.capabilities();
    if (available === 'no') return 'unavailable';
    return available === 'readily' ? 'available' : 'downloading';
  }
  // Firefox delegates analysis to the background service, which only wakes the
  // content script's input tracking once its model is ready (see initFirefox).
  // So from here the model is effectively available; the background owns the
  // real download/readiness lifecycle.
  if (isFirefoxMLContext()) return 'available';
  return 'unavailable';
}

async function constructSession() {
  if (typeof LanguageModel !== 'undefined') {
    const avail = await LanguageModel.availability();
    if (avail === 'unavailable') throw new Error('unavailable');
    const initialPrompts = [{ role: 'system', content: SYSTEM_PROMPT }, ...FEW_SHOT];
    try {
      return sessionMetadata(await LanguageModel.create({ initialPrompts, ...LANGUAGE_OPTIONS }), true);
    } catch (error) {
      if (!supportsReducedOptionsRetry(error)) throw error;
      try {
        return sessionMetadata(await LanguageModel.create({ initialPrompts }), true);
      } catch (reducedError) {
        if (!supportsReducedOptionsRetry(reducedError)) throw reducedError;
        // older builds without initialPrompts support
        return sessionMetadata(await LanguageModel.create({ systemPrompt: SYSTEM_PROMPT }), false);
      }
    }
  }
  if (typeof window !== 'undefined' && window.ai?.languageModel) {
    const { available } = await window.ai.languageModel.capabilities();
    if (available === 'no') throw new Error('unavailable');
    return sessionMetadata(await window.ai.languageModel.create({ systemPrompt: SYSTEM_PROMPT }), false);
  }
  throw new Error('Chrome AI not found');
}

function expireReusableSession(now = Date.now()) {
  if (!reusableSession || now - lastUsedAt <= SESSION_TTL) return;
  reusableSession.session.destroy?.();
  reusableSession = null;
  lastUsedAt = 0;
}

async function getSession() {
  expireReusableSession();
  if (reusableSession) {
    lastUsedAt = Date.now();
    return reusableSession;
  }

  if (sessionCreation) {
    const pending = await sessionCreation;
    if (pending.cloneCapable) {
      lastUsedAt = Date.now();
      return pending;
    }
    return constructSession();
  }

  const creation = constructSession();
  sessionCreation = creation;
  try {
    const created = await creation;
    if (created.cloneCapable) {
      reusableSession = created;
      lastUsedAt = Date.now();
    }
    return created;
  } finally {
    if (sessionCreation === creation) sessionCreation = null;
  }
}

function resetSessionState() {
  reusableSession?.session.destroy?.();
  reusableSession = null;
  sessionCreation = null;
  lastUsedAt = 0;
}

// ── Firefox path (WebExtensions AI API) ──────────────────────────────────────
//
// Firefox has no Prompt API. Its WebExtensions AI API (browser.trial.ml,
// Firefox 134+) only works in extension pages, so when the Chrome globals are
// missing and we are running as a Firefox content script, analysis is
// delegated to background.js over runtime messaging. That path classifies
// tone with a zero-shot model — no streaming and no rewrite suggestions.

function isFirefoxMLContext() {
  return typeof LanguageModel === 'undefined'
    && !(typeof window !== 'undefined' && window.ai?.languageModel)
    && typeof browser !== 'undefined'
    && !!browser.runtime?.sendMessage;
}

async function analyzeViaBackground(text) {
  const response = await browser.runtime.sendMessage({ type: 'cv-analyze', text });
  if (!response?.ok) throw new Error(response?.error || 'analysis failed');
  return normalize(response.result);
}

// ── Localisation (Language Detector + Translator) ─────────────────────────────
//
// The model always reasons in English (reliable structured JSON). When the
// comment is written in another language we translate the user-facing fields
// into that same language, so the rewrite suggestion is directly pasteable and
// the explanation reads in the language the user is already writing in.
// Everything here is best-effort: if the APIs, a model download, or a specific
// language pair are unavailable, we silently keep the English result.

const MIN_DETECT_CONFIDENCE = 0.5;

let detector       = null;
let detectorBusy   = false;
const translators  = new Map(); // targetLang -> Translator | 'unavailable'

async function getDetector() {
  if (typeof LanguageDetector === 'undefined') return null;
  if (detector) return detector;
  if (detectorBusy) return null; // best-effort: skip rather than queue
  detectorBusy = true;
  try {
    if (await LanguageDetector.availability() === 'unavailable') return null;
    detector = await LanguageDetector.create();
  } catch { detector = null; }
  finally { detectorBusy = false; }
  return detector;
}

function normalizeDetectedLanguage(top) {
  if (top && top.confidence >= MIN_DETECT_CONFIDENCE && top.detectedLanguage !== 'und') {
    return top.detectedLanguage.split('-')[0];
  }
  return null;
}

async function detectLanguage(text) {
  const d = await getDetector();
  if (!d) return null;
  try {
    return normalizeDetectedLanguage((await d.detect(text))?.[0]);
  } catch {}
  return null;
}

async function getTranslator(target) {
  if (typeof Translator === 'undefined' || !target || target === 'en') return null;
  const cached = translators.get(target);
  if (cached) return cached === 'unavailable' ? null : cached;
  const pair = { sourceLanguage: 'en', targetLanguage: target };
  try {
    if (await Translator.availability(pair) === 'unavailable') {
      translators.set(target, 'unavailable'); // genuinely unsupported — cache permanently
      return null;
    }
  } catch {
    return null; // transient availability error — don't cache, allow retry
  }
  try {
    const t = await Translator.create(pair);
    translators.set(target, t);
    return t;
  } catch {
    return null; // create can fail while the model downloads — retry next time, don't cache
  }
}

async function translateField(translator, text) {
  if (!translator || !text) return text;
  try { return await translator.translate(text); } catch { return text; }
}

async function localizeResult(result, target) {
  const translator = await getTranslator(target);
  if (!translator) return result;
  const [label, reason, rewrite] = await Promise.all([
    translateField(translator, result.label),
    translateField(translator, result.reason),
    result.rewrite ? translateField(translator, result.rewrite) : Promise.resolve(null),
  ]);
  return { ...result, label, reason, rewrite, lang: target };
}

// ── Analysis ─────────────────────────────────────────────────────────────────

const FEW_SHOT = [
  {
    role: 'user',
    content: 'Classify the tone of this comment:\n"Great article, really insightful and well written!"',
  },
  {
    role: 'assistant',
    content: '{"sentiment":"positive","emoji":"😊","label":"Positive","reason":"Expresses genuine appreciation and enthusiasm.","rewrite":null}',
  },
  {
    role: 'user',
    content: 'Classify the tone of this comment:\n"You are all idiots and this is absolute garbage."',
  },
  {
    role: 'assistant',
    content: '{"sentiment":"toxic","emoji":"🚫","label":"Toxic","reason":"Contains personal insults and aggressive language.","rewrite":"I strongly disagree with this and think it can be much improved."}',
  },
];

async function analyzeText(text, onEarlySentiment, signal) {
  if (isFirefoxMLContext()) return analyzeViaBackground(text);
  const acquired = await getSession();
  const base = acquired.session;
  // Prompt API sessions are stateful: prompting the shared session would append
  // every analysis to its context, slowing each one down until the quota
  // overflows. A clone starts fresh from the initial prompts and is cheap
  // (no model reload), so analyze on a throwaway clone.
  const session = acquired.cloneCapable ? await base.clone() : base;
  const messages = [
    ...(acquired.fewShotBaked ? [] : FEW_SHOT),
    { role: 'user',      content: `Classify the tone of this comment:\n"${text.replace(/"/g, '\\"')}"` },
    { role: 'assistant', content: '{"sentiment":', prefix: true },
  ];
  try {
    const raw = typeof session.promptStreaming === 'function'
      ? await streamPrompt(session, messages, onEarlySentiment, signal)
      : await callPrompt(session, 'prompt', messages, signal);
    return normalize(parseResponse('{"sentiment":' + raw));
  } finally {
    session.destroy?.();
  }
}

// Accumulates the streamed response; fires onEarlySentiment as soon as the
// sentiment value is readable (it's the first field thanks to the prefill),
// so the badge can color in before the reason/rewrite finish generating.
function callPrompt(session, method, messages, signal) {
  if (!signal) return session[method](messages);
  try {
    return session[method](messages, { signal });
  } catch (error) {
    if (error instanceof TypeError && !signal.aborted) return session[method](messages);
    throw error;
  }
}

async function streamPrompt(session, messages, onEarlySentiment, signal) {
  let raw = '';
  let signaled = false;
  for await (const chunk of callPrompt(session, 'promptStreaming', messages, signal)) {
    // older builds stream the cumulative text, newer ones stream deltas
    raw = (chunk.length > raw.length && chunk.startsWith(raw)) ? chunk : raw + chunk;
    if (!signaled && onEarlySentiment) {
      const m = raw.match(/"(positive|neutral|negative|toxic)"/);
      if (m) { signaled = true; onEarlySentiment(m[1]); }
    }
  }
  return raw;
}

function parseResponse(raw) {
  try { return JSON.parse(raw.trim()); } catch {}
  const m = raw.match(/\{[\s\S]*?\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  const l = raw.toLowerCase();
  const PROFANITY = /\b(fuck|shit|damn|ass|bastard|bitch|crap|piss|dick|cunt)\b/;
  if (PROFANITY.test(l) || l.includes('toxic') || l.includes('hateful')) return { sentiment: 'toxic' };
  if (l.includes('negative') || l.includes('harsh') || l.includes('rude'))  return { sentiment: 'negative' };
  if (l.includes('positive') || l.includes('kind')  || l.includes('great')) return { sentiment: 'positive' };
  return { sentiment: 'neutral' };
}

function normalize(obj) {
  const source       = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  const rawSentiment = typeof source.sentiment === 'string' ? source.sentiment.trim().toLowerCase() : '';
  const sentiment    = VALID_SENTIMENTS.has(rawSentiment) ? rawSentiment : 'neutral';
  const label        = typeof source.label === 'string' && source.label.trim()
    ? source.label.trim()
    : LABEL_FOR[sentiment];
  const reasonRaw    = source.reason ?? source.tone ?? source.analysis ?? source.description ?? source.explanation ?? '';
  const reason       = typeof reasonRaw === 'string' ? reasonRaw : '';
  const rewriteRaw   = source.rewrite ?? source.suggestion ?? source.alternative ?? source.improved_version ?? null;
  const rewrite      = typeof rewriteRaw === 'string' && rewriteRaw.trim() ? rewriteRaw.trim() : null;
  return {
    sentiment,
    emoji: EMOJI_FOR[sentiment],
    label,
    reason,
    rewrite: (sentiment === 'negative' || sentiment === 'toxic') ? rewrite : null,
  };
}

// ── UI helpers ───────────────────────────────────────────────────────────────

let activeTooltip = null;

// Inline !important beats any stylesheet rule
function sp(el, prop, val) { el.style.setProperty(prop, val, 'important'); }
function isVisible(el) { return el.style.getPropertyValue('display') !== 'none'; }

// Outside the input so it never covers the text being typed: above the
// top-right corner, falling back to below, and only overlapping the input
// (old behavior) when the input fills the whole viewport.
function placeBadge(badge, input) {
  const r   = input.getBoundingClientRect();
  const bw  = badge.offsetWidth  || 110;
  const bh  = badge.offsetHeight || 26;
  const gap = 6;

  let top = r.top - bh - gap;
  if (top < 8) top = r.bottom + gap;
  if (top + bh > window.innerHeight - 8) {
    top = Math.min(r.bottom, window.innerHeight - 8) - bh - gap;
  }

  let left = r.right - bw;
  if (left + bw > window.innerWidth - 8) left = window.innerWidth - bw - 8;
  if (left < 8) left = 8;

  sp(badge, 'top',  `${top}px`);
  sp(badge, 'left', `${left}px`);
}

function placeTooltip(tooltip, badge) {
  const br = badge.getBoundingClientRect();
  const th = tooltip.offsetHeight || 160;
  const tw = tooltip.offsetWidth  || 290;
  let top  = br.top - th - 8;
  if (top < 8) top = br.bottom + 8;
  let left = br.right - tw;
  if (left < 8) left = 8;
  if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
  sp(tooltip, 'top',  `${top}px`);
  sp(tooltip, 'left', `${left}px`);
}

function showBadge(badge, sentiment) {
  const c = COLOR_MAP[sentiment];
  sp(badge, 'display',    'inline-flex');
  sp(badge, 'background', c.bg);
  sp(badge, 'color',      c.color);
  sp(badge, 'border',     c.border);
}

function showAnalyzing(badge) {
  badge.className = 'cv-badge cv-badge--analyzing';
  badge.innerHTML = '<span class="cv-spinner"></span><span>Analyzing…</span>';
  sp(badge, 'display',    'inline-flex');
  sp(badge, 'background', '#e5e7eb');
  sp(badge, 'color',      '#374151');
  sp(badge, 'border',     'none');
}

function showModelDownloading(badge) {
  badge.className = 'cv-badge cv-badge--analyzing';
  badge.innerHTML = '<span class="cv-spinner"></span><span>Preparing AI model…</span>';
  sp(badge, 'display',    'inline-flex');
  sp(badge, 'background', '#e5e7eb');
  sp(badge, 'color',      '#374151');
  sp(badge, 'border',     'none');
}

function showTooltip(tooltip, badge) {
  sp(tooltip, 'display', 'block');
  placeTooltip(tooltip, badge);
}

function hideTooltip(tooltip) { sp(tooltip, 'display', 'none'); }

function dismissTooltip(tooltip) {
  hideTooltip(tooltip);
  if (activeTooltip === tooltip) activeTooltip = null;
}

function dismissActiveTooltip() {
  if (activeTooltip) dismissTooltip(activeTooltip);
}

function escHtml(str = '') {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Badge & tooltip rendering ─────────────────────────────────────────────────

function createUI() {
  const badge = document.createElement('div');
  badge.className = 'cv-badge';
  sp(badge, 'display', 'none');

  const tooltip = document.createElement('div');
  tooltip.className = 'cv-tooltip';
  sp(tooltip, 'display', 'none');

  document.body.appendChild(badge);
  document.body.appendChild(tooltip);

  badge.addEventListener('click', e => {
    e.stopPropagation();
    if (activeTooltip && activeTooltip !== tooltip) dismissActiveTooltip();
    if (isVisible(tooltip)) {
      dismissTooltip(tooltip);
    } else {
      showTooltip(tooltip, badge);
      activeTooltip = tooltip;
    }
  });

  return { badge, tooltip };
}

function renderBadge(badge, tooltip, result) {
  const { sentiment, emoji, label, reason, rewrite } = result;

  const badgeEmoji = document.createElement('span');
  badgeEmoji.textContent = emoji;
  const badgeLabel = document.createElement('span');
  badgeLabel.textContent = label;
  badge.className = `cv-badge ${SENTIMENT_CLASS[sentiment] ?? SENTIMENT_CLASS.neutral}`;
  badge.replaceChildren(badgeEmoji, badgeLabel);
  showBadge(badge, sentiment);

  const header = document.createElement('div');
  header.className = 'cv-tooltip-header';
  const title = document.createElement('span');
  title.className = 'cv-tooltip-title';
  title.textContent = emoji + ' ' + label;
  const close = document.createElement('span');
  close.className = 'cv-tooltip-close';
  close.setAttribute('role', 'button');
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  header.append(title, close);

  const reasonEl = document.createElement('div');
  reasonEl.className = 'cv-tooltip-reason';
  reasonEl.textContent = reason;
  tooltip.replaceChildren(header, reasonEl);

  close.addEventListener('click', e => {
    e.stopPropagation();
    dismissTooltip(tooltip);
  });

  if (rewrite) {
    const rewriteContainer = document.createElement('div');
    rewriteContainer.className = 'cv-tooltip-rewrite';
    const rewriteLabel = document.createElement('span');
    rewriteLabel.className = 'cv-tooltip-rewrite-label';
    rewriteLabel.textContent = 'Try instead:';
    const rewriteText = document.createElement('div');
    rewriteText.className = 'cv-tooltip-rewrite-text';
    rewriteText.textContent = rewrite;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'cv-tooltip-copy';
    copyBtn.textContent = '📋 Copy suggestion';
    rewriteContainer.append(rewriteLabel, rewriteText, copyBtn);
    tooltip.appendChild(rewriteContainer);

    copyBtn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(rewrite).then(() => {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy suggestion'; }, 2000);
      }).catch(() => {});
    });
  }
}

// ── Input tracking ────────────────────────────────────────────────────────────

const tracked = new WeakMap();

function getText(el) {
  return (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')
    ? el.value
    : (el.innerText || el.textContent || '');
}

function invalidateRequest(state) {
  if (state.debounceTimer !== null) clearTimeout(state.debounceTimer);
  state.debounceTimer = null;
  state.abortController?.abort();
  state.abortController = null;
  return ++state.requestId;
}

function beginInputChange(state, text) {
  if (text === state.lastText) return null;
  const requestId = invalidateRequest(state);
  state.lastText = text;
  return requestId;
}

function isCurrentRequest(state, requestId) {
  return requestId === state.requestId;
}

function attachToInput(el) {
  if (tracked.has(el)) return;

  const { badge, tooltip } = createUI();
  const state = { badge, tooltip, debounceTimer: null, abortController: null, lastText: '', requestId: 0 };
  tracked.set(el, state);

  const onInput = () => {
    const text = getText(el).trim();
    const requestId = beginInputChange(state, text);
    if (requestId === null) return;
    if (text.length < MIN_LENGTH) {
      sp(badge, 'display', 'none');
      dismissTooltip(tooltip);
      return;
    }

    const abortController = new AbortController();
    state.abortController = abortController;
    showAnalyzing(badge);
    placeBadge(badge, el);

    state.debounceTimer = setTimeout(async () => {
      state.debounceTimer = null;
      const modelStatus = await getModelStatus();
      if (!isCurrentRequest(state, requestId)) return;
      if (modelStatus === 'unavailable') {
        sp(badge, 'display', 'none');
        return;
      }
      // A stalled model call (e.g. a slow safety-classification pass) must not
      // leave the badge reading "Analyzing…" forever with no further input to
      // cancel it. A model that's still downloading legitimately needs much
      // longer, so it gets its own honest badge state and a longer bound.
      if (modelStatus !== 'available') {
        showModelDownloading(badge);
        placeBadge(badge, el);
      }
      const giveUpTimer = setTimeout(() => {
        abortController.abort();
        if (isCurrentRequest(state, requestId)) sp(badge, 'display', 'none');
      }, modelStatus === 'available' ? ANALYSIS_TIMEOUT_MS : MODEL_DOWNLOAD_TIMEOUT_MS);
      try {
        const onEarlySentiment = sentiment => {
          if (!isCurrentRequest(state, requestId)) return;
          renderBadge(badge, tooltip, {
            sentiment,
            emoji:   EMOJI_FOR[sentiment],
            label:   LABEL_FOR[sentiment],
            reason:  '…',
            rewrite: null,
          });
          placeBadge(badge, el);
        };
        const [result, lang] = await Promise.all([
          analyzeText(text, onEarlySentiment, abortController.signal),
          detectLanguage(text),
        ]);
        if (!isCurrentRequest(state, requestId)) return;
        const localized = await localizeResult(result, lang);
        if (!isCurrentRequest(state, requestId)) return;
        renderBadge(badge, tooltip, localized);
      } catch (error) {
        if (error?.name !== 'AbortError' && isCurrentRequest(state, requestId)) {
          sp(badge, 'display', 'none');
        }
      } finally {
        clearTimeout(giveUpTimer);
        if (state.abortController === abortController) state.abortController = null;
      }
      if (isCurrentRequest(state, requestId)) placeBadge(badge, el);
    }, DEBOUNCE_MS);
  };

  const onFocus = () => {
    if (state.lastText.length >= MIN_LENGTH) {
      placeBadge(badge, el);
      sp(badge, 'display', 'inline-flex');
    }
  };

  const onBlur = () => {
    setTimeout(() => {
      if (!isVisible(tooltip)) sp(badge, 'display', 'none');
    }, 250);
  };

  const reposition = () => {
    if (isVisible(badge)) {
      placeBadge(badge, el);
      if (isVisible(tooltip)) placeTooltip(tooltip, badge);
    }
  };

  el.addEventListener('input',  onInput);
  el.addEventListener('keyup',  onInput);
  el.addEventListener('focus',  onFocus);
  el.addEventListener('blur',   onBlur);
  // capture: true — scroll events don't bubble, so this is the only way to
  // follow scrolling inside nested containers (modals, feeds)
  window.addEventListener('scroll', reposition, { passive: true, capture: true });
  window.addEventListener('resize', reposition, { passive: true });

  // follow the input when it grows while typing multi-line text
  const resizeObserver = new ResizeObserver(reposition);
  resizeObserver.observe(el);

  state.cleanup = () => {
    invalidateRequest(state);
    if (activeTooltip === tooltip) activeTooltip = null;
    badge.remove();
    tooltip.remove();
    resizeObserver.disconnect();
    el.removeEventListener('input',  onInput);
    el.removeEventListener('keyup',  onInput);
    el.removeEventListener('focus',  onFocus);
    el.removeEventListener('blur',   onBlur);
    window.removeEventListener('scroll', reposition, { capture: true });
    window.removeEventListener('resize', reposition);
  };
}

// ── Page scanning ─────────────────────────────────────────────────────────────

function matchesInputSelector(el) {
  return SELECTORS.some(selector => el.matches(selector));
}

function forEachInputCandidate(root, callback) {
  if (matchesInputSelector(root)) callback(root);
  for (const selector of SELECTORS) root.querySelectorAll(selector).forEach(callback);
}

function attachCandidate(el) {
  if (el.closest('.cv-tooltip') || el.classList.contains('cv-badge')) return;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return;
  attachToInput(el);
}

function scanSubtree(root) {
  forEachInputCandidate(root, attachCandidate);
}

function scanPage() {
  for (const selector of SELECTORS) document.querySelectorAll(selector).forEach(attachCandidate);
}

function isCleanupEligible(el) {
  return !el.isConnected;
}

function cleanupSubtree(root) {
  forEachInputCandidate(root, el => {
    const state = tracked.get(el);
    if (!state || !isCleanupEligible(el)) return;
    state.cleanup?.();
    tracked.delete(el);
  });
}

function watchDOM() {
  document.addEventListener('click', dismissActiveTooltip);
  new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) scanSubtree(node);
      });
    });
    mutations.forEach(mutation => {
      mutation.removedNodes.forEach(node => {
        if (node.nodeType === 1) cleanupSubtree(node);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const hasChromeAI = typeof LanguageModel !== 'undefined' || !!window.ai?.languageModel;
  if (hasChromeAI) {
    scanPage();
    watchDOM();
    return;
  }
  if (isFirefoxMLContext()) {
    initFirefox();
    return;
  }
  console.warn('[CommentVibe] Chrome built-in AI not available. Enable the Prompt API in chrome://flags');
}

// trialML is an optional permission, so the background may report the AI as
// unavailable until the user enables it from the popup. Stay dormant and wait
// for the background's cv-ml-ready broadcast instead of giving up.
function initFirefox() {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    scanPage();
    watchDOM();
  };
  browser.runtime.onMessage.addListener(message => {
    if (message?.type === 'cv-ml-ready') start();
  });
  browser.runtime.sendMessage({ type: 'cv-status' })
    .then(status => { if (status?.available) start(); })
    .catch(() => {});
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    analyzeText,
    analyzeViaBackground,
    beginInputChange,
    constructSession,
    expireReusableSession,
    getModelStatus,
    getSession,
    invalidateRequest,
    isCleanupEligible,
    isCurrentRequest,
    isFirefoxMLContext,
    normalize,
    normalizeDetectedLanguage,
    parseResponse,
    resetSessionState,
    streamPrompt,
  };
}
