'use strict';

// ── Config ──────────────────────────────────────────────────────────────────

const MIN_LENGTH  = 15;
const DEBOUNCE_MS = 900;
const SESSION_TTL = 600_000;

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

let aiSession  = null;
let sessionBusy = false;
let lastUsedAt  = 0;

async function getSession() {
  if (aiSession && Date.now() - lastUsedAt > SESSION_TTL) {
    aiSession.destroy?.();
    aiSession = null;
  }
  if (aiSession) return aiSession;

  if (sessionBusy) {
    await new Promise(resolve => {
      const t = setInterval(() => { if (!sessionBusy) { clearInterval(t); resolve(); } }, 50);
    });
    return aiSession;
  }

  sessionBusy = true;
  try {
    if (typeof LanguageModel !== 'undefined') {
      const avail = await LanguageModel.availability();
      if (avail === 'unavailable') throw new Error('unavailable');
      try {
        aiSession = await LanguageModel.create({ systemPrompt: SYSTEM_PROMPT, ...LANGUAGE_OPTIONS });
      } catch {
        aiSession = await LanguageModel.create({ systemPrompt: SYSTEM_PROMPT });
      }
    } else if (window.ai?.languageModel) {
      const { available } = await window.ai.languageModel.capabilities();
      if (available === 'no') throw new Error('unavailable');
      aiSession = await window.ai.languageModel.create({ systemPrompt: SYSTEM_PROMPT });
    } else {
      throw new Error('Chrome AI not found');
    }
  } finally {
    sessionBusy = false;
  }
  return aiSession;
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

async function detectLanguage(text) {
  const d = await getDetector();
  if (!d) return null;
  try {
    const top = (await d.detect(text))?.[0];
    if (top && top.confidence >= MIN_DETECT_CONFIDENCE && top.detectedLanguage !== 'und') {
      return top.detectedLanguage.split('-')[0];
    }
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

async function analyzeText(text) {
  const session = await getSession();
  lastUsedAt = Date.now();
  const raw = await session.prompt([
    ...FEW_SHOT,
    { role: 'user',      content: `Classify the tone of this comment:\n"${text.replace(/"/g, '\\"')}"` },
    { role: 'assistant', content: '{"sentiment":', prefix: true },
  ]);
  return normalize(parseResponse('{"sentiment":' + raw));
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
  const sentiment  = VALID_SENTIMENTS.has(obj.sentiment) ? obj.sentiment : 'neutral';
  const reason     = obj.reason ?? obj.tone ?? obj.analysis ?? obj.description ?? obj.explanation ?? '';
  const rewriteRaw = obj.rewrite ?? obj.suggestion ?? obj.alternative ?? obj.improved_version ?? null;
  const rewrite    = typeof rewriteRaw === 'string' && rewriteRaw.trim() ? rewriteRaw.trim() : null;
  return {
    sentiment,
    emoji:   obj.emoji || EMOJI_FOR[sentiment],
    label:   obj.label || LABEL_FOR[sentiment],
    reason:  typeof reason === 'string' ? reason : '',
    rewrite: (sentiment === 'negative' || sentiment === 'toxic') ? rewrite : null,
  };
}

// ── UI helpers ───────────────────────────────────────────────────────────────

// Inline !important beats any stylesheet rule
function sp(el, prop, val) { el.style.setProperty(prop, val, 'important'); }
function isVisible(el) { return el.style.getPropertyValue('display') !== 'none'; }

function placeBadge(badge, input) {
  const r = input.getBoundingClientRect();
  sp(badge, 'top',  `${Math.max(0, r.bottom - 28)}px`);
  sp(badge, 'left', `${Math.max(0, r.right - (badge.offsetWidth || 110) - 8)}px`);
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

function showTooltip(tooltip, badge) {
  sp(tooltip, 'display', 'block');
  placeTooltip(tooltip, badge);
}

function hideTooltip(tooltip) { sp(tooltip, 'display', 'none'); }

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
    if (isVisible(tooltip)) hideTooltip(tooltip);
    else showTooltip(tooltip, badge);
  });

  document.addEventListener('click', () => hideTooltip(tooltip));

  return { badge, tooltip };
}

function renderBadge(badge, tooltip, result) {
  const { sentiment, emoji, label, reason, rewrite } = result;

  badge.className = `cv-badge ${SENTIMENT_CLASS[sentiment] ?? SENTIMENT_CLASS.neutral}`;
  badge.innerHTML = `<span>${emoji}</span><span>${escHtml(label)}</span>`;
  showBadge(badge, sentiment);

  let html = `
    <div class="cv-tooltip-header">
      <span class="cv-tooltip-title">${emoji} ${escHtml(label)}</span>
      <span class="cv-tooltip-close" role="button" aria-label="Close">✕</span>
    </div>
    <div class="cv-tooltip-reason">${escHtml(reason)}</div>`;

  if (rewrite) {
    html += `
    <div class="cv-tooltip-rewrite">
      <span class="cv-tooltip-rewrite-label">Try instead:</span>
      <div class="cv-tooltip-rewrite-text">${escHtml(rewrite)}</div>
      <button class="cv-tooltip-copy">📋 Copy suggestion</button>
    </div>`;
  }
  tooltip.innerHTML = html;

  tooltip.querySelector('.cv-tooltip-close')?.addEventListener('click', e => {
    e.stopPropagation();
    hideTooltip(tooltip);
  });

  const copyBtn = tooltip.querySelector('.cv-tooltip-copy');
  if (copyBtn && rewrite) {
    copyBtn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(rewrite).then(() => {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.innerHTML = '📋 Copy suggestion'; }, 2000);
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

function attachToInput(el) {
  if (tracked.has(el)) return;

  const { badge, tooltip } = createUI();
  const state = { badge, tooltip, debounceTimer: null, lastText: '', requestId: 0 };
  tracked.set(el, state);

  const onInput = () => {
    const text = getText(el).trim();
    if (text.length < MIN_LENGTH) {
      sp(badge, 'display', 'none');
      hideTooltip(tooltip);
      state.lastText = '';
      return;
    }
    if (text === state.lastText) return;
    state.lastText = text;

    const requestId = ++state.requestId;
    clearTimeout(state.debounceTimer);
    showAnalyzing(badge);
    placeBadge(badge, el);

    state.debounceTimer = setTimeout(async () => {
      try {
        const [result, lang] = await Promise.all([analyzeText(text), detectLanguage(text)]);
        if (requestId !== state.requestId) return;
        const localized = await localizeResult(result, lang);
        if (requestId !== state.requestId) return;
        renderBadge(badge, tooltip, localized);
      } catch {
        sp(badge, 'display', 'none');
      }
      placeBadge(badge, el);
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
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition, { passive: true });

  state.cleanup = () => {
    badge.remove();
    tooltip.remove();
    el.removeEventListener('input',  onInput);
    el.removeEventListener('keyup',  onInput);
    el.removeEventListener('focus',  onFocus);
    el.removeEventListener('blur',   onBlur);
    window.removeEventListener('scroll', reposition);
    window.removeEventListener('resize', reposition);
  };
}

// ── Page scanning ─────────────────────────────────────────────────────────────

function scanPage() {
  for (const sel of SELECTORS) {
    document.querySelectorAll(sel).forEach(el => {
      if (el.closest('.cv-tooltip') || el.classList.contains('cv-badge')) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      attachToInput(el);
    });
  }
}

function watchDOM() {
  new MutationObserver(mutations => {
    if (mutations.some(m => m.addedNodes.length > 0)) scanPage();
    mutations.forEach(m => {
      m.removedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        [node, ...(node.querySelectorAll('*') ?? [])].forEach(el => {
          const state = tracked.get(el);
          if (state) { state.cleanup?.(); tracked.delete(el); }
        });
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const hasAI = typeof LanguageModel !== 'undefined' || !!window.ai?.languageModel;
  if (!hasAI) {
    console.warn('[CommentVibe] Chrome built-in AI not available. Enable the Prompt API in chrome://flags');
    return;
  }
  scanPage();
  watchDOM();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
