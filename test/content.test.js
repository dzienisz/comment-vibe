'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeText,
  analyzeViaBackground,
  analyzeViaJev,
  applyJevSetting,
  applySettings,
  applyRewrite,
  applyViaExecCommand,
  attachToInput,
  beginInputChange,
  buildMessages,
  buildRewriteMessages,
  buildTooltipTools,
  cacheKey,
  cleanRewriteOutput,
  cleanResultCache,
  constructSession,
  expireReusableSession,
  extractEarlySentiment,
  FEW_SHOT,
  getCachedResult,
  getModelStatus,
  getSession,
  handleJevStorageChange,
  hostDisabled,
  invalidateRequest,
  isCleanupEligible,
  isCurrentRequest,
  isChromeBuild,
  isFirefoxMLContext,
  normalize,
  normalizeDetectedLanguage,
  normalizeHost,
  parseAnalysisResponse,
  parseResponse,
  resetSessionState,
  rewriteText,
  REWRITE_MODES,
  RESPONSE_SCHEMA,
  RESULT_CACHE_TTL,
  shouldShowRatePrompt,
  analysisModeFrom,
  RATE_AFTER_APPLIES,
  setCachedResult,
  streamPrompt,
  tracked,
} = require('../content.js');

function sessionFor(chunks) {
  return {
    async * promptStreaming() {
      yield * chunks;
    },
  };
}

function modernApi(create) {
  return {
    availability: async () => 'available',
    create,
  };
}

test.afterEach(() => {
  resetSessionState();
  cleanResultCache(0);
  delete global.LanguageModel;
  delete global.window;
  delete global.browser;
  delete global.document;
  delete global.ResizeObserver;
});

// ── Minimal DOM stub for badge/tooltip flow tests ────────────────────────────
//
// Just enough DOM for attachToInput → onInput → renderBadge/renderApplied to
// run in node: element trees with class/dataset-aware querySelector, text
// aggregation, event listeners, and style.setProperty.
class FakeEl {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.ownerDocument = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {
      _values: {},
      setProperty: (k, v) => { this.style._values[k] = v; },
      getPropertyValue: k => this.style._values[k] || '',
    };
    this._className = '';
    this._text = '';
    this._html = '';
    this._listeners = {};
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.value = '';
  }
  get className() { return this._className; }
  set className(v) { this._className = v; }
  get classList() {
    const self = this;
    return {
      add: (...cs) => { self._className = [...new Set([...self._className.split(' ').filter(Boolean), ...cs])].join(' '); },
      toggle: (c, force) => {
        const has = self._className.split(' ').includes(c);
        if (force === undefined ? !has : force) this.classList.add(c);
        else self._className = self._className.split(' ').filter(x => x !== c).join(' ');
      },
      contains: c => self._className.split(' ').includes(c),
    };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  get textContent() {
    return this._text + this.children.map(c => c.textContent).join('');
  }
  set textContent(v) { this.children = []; this._html = ''; this._text = String(v); }
  set innerHTML(v) { this.children = []; this._text = ''; this._html = String(v); }
  get innerHTML() { return this._html; }
  _adopt(node) { if (node instanceof FakeEl) { node.parentNode = this; node.ownerDocument = this.ownerDocument; } }
  append(...nodes) { for (const n of nodes) { this._adopt(n); this.children.push(n); } }
  appendChild(n) { this._adopt(n); this.children.push(n); return n; }
  prepend(n) { this._adopt(n); this.children.unshift(n); }
  insertBefore(node, ref) {
    this._adopt(node);
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
    return node;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.children.indexOf(this);
    return this.parentNode.children[i + 1] || null;
  }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this._html = ''; this.append(...nodes); }
  remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  contains(node) {
    if (node === this) return true;
    return this.children.some(c => c instanceof FakeEl && c.contains(node));
  }
  matches(sel) { return matchSimple(this, sel); }
  _walk(fn) { for (const c of this.children) { if (c instanceof FakeEl) { fn(c); c._walk(fn); } } }
  querySelectorAll(sel) {
    const out = [];
    this._walk(el => { if (sel.split(',').some(s => matchSimple(el, s.trim()))) out.push(el); });
    if (sel === '.cv-spinner' && this._html.includes('cv-spinner')) out.push(new FakeEl('span'));
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter(f => f !== fn); }
  dispatchEvent(event) {
    for (const fn of this._listeners[event.type] || []) fn(event);
    return true;
  }
  click() { this.dispatchEvent({ type: 'click', stopPropagation() {}, preventDefault() {} }); }
  focus() {}
  getBoundingClientRect() { return { top: 100, bottom: 130, left: 10, right: 310, width: 300, height: 30 }; }
}

function matchSimple(el, sel) {
  sel = sel.replace(/:not\([^)]*\)/g, '').replace(/:[a-z-]+$/i, '').trim();
  const m = sel.match(/^([a-zA-Z][a-zA-Z0-9]*)?((?:\.[\w-]+|\[[^\]]+\])*)$/);
  if (!m || (!m[1] && !m[2])) return false;
  const [, tag, rest] = m;
  if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  for (const part of rest.match(/\.[\w-]+|\[[^\]]+\]/g) || []) {
    if (part.startsWith('.')) {
      if (!el.classList.contains(part.slice(1))) return false;
    } else {
      const inner = part.slice(1, -1);
      const eq = inner.indexOf('=');
      const name = (eq < 0 ? inner : inner.slice(0, eq)).trim();
      const want = eq < 0 ? null : inner.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      const have = name.startsWith('data-')
        ? el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]
        : el.getAttribute(name);
      if (want === null ? have === undefined || have === null : String(have) !== want) return false;
    }
  }
  return true;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sleepUntilAnalyzed = () => sleep(1200);

// Fake textarea + document/window globals, then attachToInput.
function attachFakeField() {
  const document_ = {
    activeElement: null,
    body: new FakeEl('body'),
    createElement: tag => { const el = new FakeEl(tag); el.ownerDocument = document_; return el; },
    addEventListener() {},
  };
  global.document = document_;
  global.window = { innerWidth: 1024, innerHeight: 768, addEventListener() {}, removeEventListener() {}, open() {} };
  global.ResizeObserver = class { observe() {} disconnect() {} };
  const el = document_.createElement('textarea');
  attachToInput(el);
  return { el, state: tracked.get(el) };
}

function nanoReturning(stats, analyzeJson) {
  return {
    availability: async () => 'available',
    create: async () => ({
      clone: async () => ({
        async * promptStreaming() { stats.analyses++; yield analyzeJson; },
        prompt: async () => '"A friendlier rewrite."',
        destroy() {},
      }),
      destroy() {},
    }),
  };
}

test('parseResponse parses valid JSON', () => {
  assert.deepEqual(parseResponse('{"sentiment":"positive","reason":"Helpful."}'), {
    sentiment: 'positive',
    reason: 'Helpful.',
  });
});

test('parseResponse extracts JSON surrounded by prose', () => {
  assert.deepEqual(parseResponse('Result: {"sentiment":"negative","reason":"Harsh."} Done.'), {
    sentiment: 'negative',
    reason: 'Harsh.',
  });
});

test('parseResponse falls back to toxic for malformed toxic output', () => {
  assert.deepEqual(parseResponse('The output is toxic {not-json'), { sentiment: 'toxic' });
});

test('parseResponse falls back to negative for negative keywords', () => {
  assert.deepEqual(parseResponse('This sounds harsh'), { sentiment: 'negative' });
});

test('parseResponse falls back to positive for positive keywords', () => {
  assert.deepEqual(parseResponse('This sounds kind'), { sentiment: 'positive' });
});

test('parseResponse falls back to neutral without recognized keywords', () => {
  assert.deepEqual(parseResponse('No classification available'), { sentiment: 'neutral' });
});

test('normalize accepts an alternative reason key', () => {
  assert.equal(normalize({ sentiment: 'negative', tone: 'Dismissive.' }).reason, 'Dismissive.');
});

test('normalize accepts an alternative rewrite key', () => {
  assert.equal(
    normalize({ sentiment: 'toxic', suggestion: 'Please reconsider this.' }).rewrite,
    'Please reconsider this.',
  );
});

test('normalize removes rewrites for positive and neutral results', () => {
  assert.equal(normalize({ sentiment: 'positive', rewrite: 'Unused.' }).rewrite, null);
  assert.equal(normalize({ sentiment: 'neutral', rewrite: 'Unused.' }).rewrite, null);
});

test('normalize converts an empty rewrite to null', () => {
  assert.equal(normalize({ sentiment: 'negative', rewrite: '   ' }).rewrite, null);
});

test('normalize safely defaults null and array inputs', () => {
  const fallback = {
    sentiment: 'neutral',
    emoji: '😐',
    label: 'Neutral',
    reason: '',
    rewrite: null,
  };

  assert.deepEqual(normalize(null), fallback);
  assert.deepEqual(normalize([]), fallback);
});

test('normalize rejects object-valued user-facing fields', () => {
  assert.deepEqual(normalize({
    sentiment: 'negative',
    label: { html: '<b>Hostile</b>' },
    reason: { text: 'Harsh.' },
    rewrite: { text: 'Please reconsider.' },
  }), {
    sentiment: 'negative',
    emoji: '😕',
    label: 'Negative',
    reason: '',
    rewrite: null,
  });
});

test('normalize trims and lowercases sentiment and localized labels', () => {
  assert.deepEqual(normalize({
    sentiment: '  TOXIC  ',
    label: '  Toksyczne  ',
    reason: 'Obraźliwy ton.',
    rewrite: '  Proszę wyrazić to uprzejmiej.  ',
  }), {
    sentiment: 'toxic',
    emoji: '🚫',
    label: 'Toksyczne',
    reason: 'Obraźliwy ton.',
    rewrite: 'Proszę wyrazić to uprzejmiej.',
  });
});

test('normalize replaces empty labels and malicious emoji with canonical values', () => {
  assert.deepEqual(normalize({
    sentiment: 'positive',
    emoji: '<img src=x onerror=alert(1)>',
    label: '   ',
    reason: 'Friendly.',
    rewrite: 'Must not survive.',
  }), {
    sentiment: 'positive',
    emoji: '😊',
    label: 'Positive',
    reason: 'Friendly.',
    rewrite: null,
  });
});

test('normalize preserves markup-like strings as literal display text', () => {
  assert.deepEqual(normalize({
    sentiment: 'toxic',
    emoji: '<img src=x onerror=alert(1)>',
    label: '<b>Toxic</b>',
    reason: 'Use x < 10 and keep <3 as text.',
    rewrite: 'Prefer <option A> over <option B>.',
  }), {
    sentiment: 'toxic',
    emoji: '🚫',
    label: '<b>Toxic</b>',
    reason: 'Use x < 10 and keep <3 as text.',
    rewrite: 'Prefer <option A> over <option B>.',
  });
});

test('normalizeDetectedLanguage returns the primary language subtag', () => {
  assert.equal(normalizeDetectedLanguage({ detectedLanguage: 'pl-PL', confidence: 0.9 }), 'pl');
});

test('normalizeDetectedLanguage rejects undetermined language', () => {
  assert.equal(normalizeDetectedLanguage({ detectedLanguage: 'und', confidence: 0.9 }), null);
});

test('normalizeDetectedLanguage rejects confidence below 0.5', () => {
  assert.equal(normalizeDetectedLanguage({ detectedLanguage: 'pl-PL', confidence: 0.49 }), null);
});

test('normalizeDetectedLanguage rejects absent detection', () => {
  assert.equal(normalizeDetectedLanguage(undefined), null);
});

test('streamPrompt accumulates delta chunks', async () => {
  const raw = await streamPrompt(
    sessionFor(['"negative"', ',"reason":"Harsh."}']),
    [{ role: 'user', content: 'message' }],
  );

  assert.equal(raw, '"negative","reason":"Harsh."}');
});

test('streamPrompt accepts cumulative chunks', async () => {
  const raw = await streamPrompt(
    sessionFor(['"positive"', '"positive","reason":"Kind."}']),
    [{ role: 'user', content: 'message' }],
  );

  assert.equal(raw, '"positive","reason":"Kind."}');
});

test('streamPrompt fires the early sentiment callback exactly once in constraint mode', async () => {
  const sentiments = [];
  const raw = await streamPrompt(
    sessionFor(['{"sentiment":"toxic"', ',"reason":"Hostile."', ',"rewrite":"Be respectful."}']),
    [{ role: 'user', content: 'message' }],
    sentiment => sentiments.push(sentiment),
    null,
    true,
  );

  assert.equal(raw, '{"sentiment":"toxic","reason":"Hostile.","rewrite":"Be respectful."}');
  assert.deepEqual(sentiments, ['toxic']);
});

test('streamPrompt fires the early sentiment callback in prefill mode', async () => {
  const sentiments = [];
  const raw = await streamPrompt(
    sessionFor(['toxic"', ',"reason":"Hostile."}']),
    [{ role: 'user', content: 'message' }],
    sentiment => sentiments.push(sentiment),
    null,
    false,
  );

  assert.equal(raw, 'toxic","reason":"Hostile."}');
  assert.deepEqual(sentiments, ['toxic']);
});

test('extractEarlySentiment reads sentiment from a constrained JSON stream', () => {
  assert.equal(extractEarlySentiment('{"sentiment":"positive",', true), 'positive');
  assert.equal(extractEarlySentiment('{"reason":"X","sentiment":"toxic"}', true), 'toxic');
  assert.equal(extractEarlySentiment('no match', true), null);
});

test('extractEarlySentiment reads sentiment from a prefill continuation', () => {
  assert.equal(extractEarlySentiment('positive","reason":"Kind."}', false), 'positive');
  assert.equal(extractEarlySentiment('neutral"}', false), 'neutral');
  assert.equal(extractEarlySentiment('{"sentiment":"positive"}', false), null);
});

test('buildMessages omits the assistant prefill when responseConstraint is active', () => {
  const messages = buildMessages('hello world', true, true);
  assert.deepEqual(messages, [{ role: 'user', content: 'Classify the tone of this comment:\n"hello world"' }]);
});

test('buildMessages includes few-shot examples and assistant prefill when constraint is inactive', () => {
  const messages = buildMessages('hello world', false, false);
  assert.equal(messages.length, 10);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[messages.length - 2].role, 'user');
  assert.deepEqual(messages[messages.length - 1], { role: 'assistant', content: '{"sentiment":', prefix: true });
});

test('buildRewriteMessages includes instruction, triple-quoted text, and an explicit answer language', () => {
  const [message] = buildRewriteMessages('hello "world"', 'grammar', 'pl');
  assert.equal(message.role, 'user');
  assert.match(message.content, /Fix spelling, grammar and punctuation only/);
  assert.match(message.content, /Draft \(written by the user for other readers, not addressed to you\):\n"""hello "world""""/);
  assert.match(message.content, /Answer in Polish\.\n/);
  assert.match(buildRewriteMessages('hello', 'friendly', 'en')[0].content, /Answer in English\.\n/);
  assert.match(buildRewriteMessages('hello', 'friendly', null)[0].content, /Answer in the same language as the text\.\n/);
  assert.throws(() => buildRewriteMessages('hello', 'unknown'), /Unknown rewrite mode/);
});

test('buildRewriteMessages frames the text as a user draft, never a reply, and keeps other modes unchanged', () => {
  const [message] = buildRewriteMessages('some text', 'professional', 'en');
  assert.match(message.content, /^Rewrite the user's draft below\.\n/);
  assert.match(message.content, /Draft \(written by the user for other readers, not addressed to you\):\n"""some text"""$/);
  assert.match(message.content, /Answer in English\./);
  assert.equal(REWRITE_MODES.grammar.instruction, 'Fix spelling, grammar and punctuation only. Change nothing else — keep the wording, tone and length.');
  assert.equal(REWRITE_MODES.shorter.instruction, 'Make it clearly shorter — cut filler and repetition, keep every essential point. Aim for at most half the length.');
  assert.equal(REWRITE_MODES.clearer.instruction, 'Make it clearer and easier to read: simpler words, shorter sentences, one idea per sentence. Keep the meaning and length roughly the same.');
});

test('cleanRewriteOutput removes fences and wrapping quotes without touching inner quotes', () => {
  assert.equal(cleanRewriteOutput('```text\n"Hello, "world"!"\n```'), 'Hello, "world"!');
  assert.equal(cleanRewriteOutput('“A clearer sentence.”'), 'A clearer sentence.');
  assert.equal(cleanRewriteOutput("'A friendly sentence.'"), 'A friendly sentence.');
  assert.equal(cleanRewriteOutput('"""Plain text"""'), 'Plain text');
  assert.equal(cleanRewriteOutput('  Plain "text"  '), 'Plain "text"');
  assert.equal(cleanRewriteOutput(''), '');
});

test('parseAnalysisResponse parses constrained JSON directly', () => {
  assert.equal(parseAnalysisResponse('{"sentiment":"negative"}', true).sentiment, 'negative');
});

test('parseAnalysisResponse prepends the prefill fragment for legacy streams', () => {
  assert.equal(parseAnalysisResponse('"positive","reason":"Kind."}', false).sentiment, 'positive');
});

test('parseAnalysisResponse remaps respectful negative to neutral without a rewrite', () => {
  const result = parseAnalysisResponse(
    '{"sentiment":"negative","emoji":"😕","label":"Negative","reason":"Calm complaint.","rewrite":"Kinder.","respectful":true}',
    true,
  );
  assert.equal(result.sentiment, 'neutral');
  assert.equal(result.label, 'Neutral');
  assert.equal(result.emoji, '😐');
  assert.equal(result.rewrite, null);
});

test('parseAnalysisResponse keeps disrespectful negative and its rewrite', () => {
  const result = parseAnalysisResponse(
    '{"sentiment":"negative","reason":"Sarcastic jab.","rewrite":"Kinder.","respectful":false}',
    true,
  );
  assert.equal(result.sentiment, 'negative');
  assert.equal(result.rewrite, 'Kinder.');
});

test('parseAnalysisResponse leaves negative alone when respectful is missing', () => {
  const result = parseAnalysisResponse(
    '{"sentiment":"negative","reason":"Harsh.","rewrite":"Kinder."}',
    true,
  );
  assert.equal(result.sentiment, 'negative');
  assert.equal(result.rewrite, 'Kinder.');
});

test('parseAnalysisResponse never remaps toxic even when respectful', () => {
  const result = parseAnalysisResponse(
    '{"sentiment":"toxic","reason":"Insults.","rewrite":"Calmer.","respectful":true}',
    true,
  );
  assert.equal(result.sentiment, 'toxic');
});

test('streamPrompt does not emit a preliminary negative sentiment', async () => {
  const sentiments = [];
  const raw = await streamPrompt(
    sessionFor(['{"sentiment":"negative"', ',"reason":"Sarcastic."', ',"respectful":true}']),
    [{ role: 'user', content: 'message' }],
    sentiment => sentiments.push(sentiment),
    null,
    true,
  );
  assert.equal(raw, '{"sentiment":"negative","reason":"Sarcastic.","respectful":true}');
  assert.deepEqual(sentiments, []);
});

test('streamPrompt still emits other preliminary sentiments', async () => {
  const sentiments = [];
  await streamPrompt(
    sessionFor(['{"sentiment":"positive"', ',"reason":"Kind.","respectful":true}']),
    [{ role: 'user', content: 'message' }],
    sentiment => sentiments.push(sentiment),
    null,
    true,
  );
  assert.deepEqual(sentiments, ['positive']);
});

test('RESPONSE_SCHEMA requires respectful and every few-shot answer matches its sentiment', () => {
  assert.ok(RESPONSE_SCHEMA.required.includes('sentiment'));
  assert.ok(RESPONSE_SCHEMA.required.includes('respectful'));
  assert.equal(RESPONSE_SCHEMA.properties.respectful.type, 'boolean');
  const assistants = FEW_SHOT.filter(m => m.role === 'assistant');
  assert.ok(assistants.length >= 4);
  for (const m of assistants) {
    const parsed = JSON.parse(m.content);
    assert.equal(typeof parsed.respectful, 'boolean', m.content);
    assert.equal(parsed.respectful, !(parsed.sentiment === 'negative' || parsed.sentiment === 'toxic'), m.content);
  }
});

test('invalidateRequest clears pending work and increments the request ID once', () => {
  let abortCalls = 0;
  const state = {
    debounceTimer: setTimeout(() => assert.fail('timer should have been cancelled'), 60_000),
    abortController: { abort: () => { abortCalls++; } },
    requestId: 7,
  };

  const requestId = invalidateRequest(state);

  assert.equal(requestId, 8);
  assert.equal(state.requestId, 8);
  assert.equal(state.debounceTimer, null);
  assert.equal(state.abortController, null);
  assert.equal(abortCalls, 1);
});

test('beginInputChange leaves an unchanged input request active', () => {
  let abortCalls = 0;
  const timer = setTimeout(() => {}, 60_000);
  const state = {
    debounceTimer: timer,
    abortController: { abort: () => { abortCalls++; } },
    lastText: 'same comment text',
    requestId: 3,
  };

  const requestId = beginInputChange(state, 'same comment text');

  assert.equal(requestId, null);
  assert.equal(state.requestId, 3);
  assert.equal(state.debounceTimer, timer);
  assert.equal(abortCalls, 0);
  clearTimeout(timer);
});

test('beginInputChange forces a new request when asked', () => {
  let abortCalls = 0;
  const timer = setTimeout(() => {}, 60_000);
  const state = {
    debounceTimer: timer,
    abortController: { abort: () => { abortCalls++; } },
    lastText: 'same comment text',
    requestId: 3,
  };

  const requestId = beginInputChange(state, 'same comment text', true);

  assert.equal(requestId, 4);
  assert.equal(state.requestId, 4);
  assert.equal(state.debounceTimer, null);
  assert.equal(abortCalls, 1);
});

test('cacheKey trims whitespace', () => {
  assert.equal(cacheKey('  hello world  '), 'hello world');
});

test('setCachedResult and getCachedResult round-trip a localized result', () => {
  const result = { sentiment: 'positive', emoji: '😊', label: 'Positive', reason: 'Kind.', rewrite: null, lang: 'en' };
  setCachedResult('hello world', result);
  assert.equal(getCachedResult('  hello world  '), result);
});

test('getCachedResult returns null after TTL expiry and cleanResultCache evicts expired entries', () => {
  const result = { sentiment: 'neutral' };
  setCachedResult('hello world', result);
  cleanResultCache(Date.now() + RESULT_CACHE_TTL + 10_000);
  assert.equal(getCachedResult('hello world'), null);
});

test('handleJevStorageChange drops cached results when the provider changes', () => {
  setCachedResult('hello world', { sentiment: 'positive', providerLabel: 'Jev' });
  handleJevStorageChange({ cvJevProvider: { oldValue: 'typesafe', newValue: 'subq' } }, 'local');
  assert.equal(getCachedResult('hello world'), null);
});

test('handleJevStorageChange ignores changes outside the local area', () => {
  setCachedResult('hello world', { sentiment: 'positive' });
  handleJevStorageChange({ cvJevProvider: { oldValue: 'typesafe', newValue: 'subq' } }, 'sync');
  assert.ok(getCachedResult('hello world'));
});

test('handleJevStorageChange keeps the cache for unrelated keys', () => {
  setCachedResult('hello world', { sentiment: 'positive' });
  handleJevStorageChange({ cvSomethingElse: { oldValue: 1, newValue: 2 } }, 'local');
  assert.ok(getCachedResult('hello world'));
});

test('cleanup eligibility rejects connected elements', () => {
  assert.equal(isCleanupEligible({ isConnected: true }), false);
});

test('cleanup eligibility accepts disconnected elements', () => {
  assert.equal(isCleanupEligible({ isConnected: false }), true);
});

test('an aborted stream cannot produce a current final result', async () => {
  const controller = new AbortController();
  const state = {
    debounceTimer: null,
    abortController: controller,
    requestId: 1,
  };
  const requestId = state.requestId;
  let finalRendered = false;
  const session = {
    async * promptStreaming(messages, options) {
      assert.deepEqual(messages, [{ role: 'user', content: 'message' }]);
      assert.equal(options.signal, controller.signal);
      yield '{"sentiment":"positive"';
      if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      yield ',"reason":"Kind."}';
    },
  };

  await assert.rejects(
    streamPrompt(
      session,
      [{ role: 'user', content: 'message' }],
      () => invalidateRequest(state),
      controller.signal,
      true,
    ).then(() => {
      if (isCurrentRequest(state, requestId)) finalRendered = true;
    }),
    { name: 'AbortError' },
  );

  assert.equal(controller.signal.aborted, true);
  assert.equal(state.requestId, 2);
  assert.equal(finalRendered, false);
});

test('constructSession prefers standard API with initial prompts, language options, and response constraint', async () => {
  const session = { clone() {} };
  const optionsSeen = [];
  let legacyCreates = 0;
  global.LanguageModel = modernApi(async options => {
    optionsSeen.push(options);
    return session;
  });
  global.window = {
    ai: {
      languageModel: {
        capabilities: async () => ({ available: 'readily' }),
        create: async () => { legacyCreates++; },
      },
    },
  };

  const metadata = await constructSession();

  assert.equal(metadata.session, session);
  assert.equal(metadata.fewShotBaked, true);
  assert.equal(metadata.responseConstraint, true);
  assert.equal(metadata.cloneCapable, true);
  assert.equal(optionsSeen.length, 1);
  assert.equal(optionsSeen[0].initialPrompts.length, 9);
  assert.deepEqual(optionsSeen[0].expectedInputs, [{ type: 'text', languages: ['en'] }]);
  assert.deepEqual(optionsSeen[0].expectedOutputs, [{ type: 'text', languages: ['en'] }]);
  assert.equal(optionsSeen[0].responseConstraint, RESPONSE_SCHEMA);
  assert.equal(legacyCreates, 0);
});

test('constructSession retries through option reductions when response constraint or language options are unsupported', async () => {
  const optionsSeen = [];
  const session = { clone() {} };
  global.LanguageModel = modernApi(async options => {
    optionsSeen.push(options);
    if (optionsSeen.length < 4) throw new TypeError('unsupported options');
    return session;
  });

  const metadata = await constructSession();

  assert.equal(metadata.session, session);
  assert.equal(metadata.fewShotBaked, true);
  assert.equal(metadata.responseConstraint, false);
  assert.equal(optionsSeen.length, 4);
  // 1st: full modern options including responseConstraint
  assert.equal(optionsSeen[0].responseConstraint, RESPONSE_SCHEMA);
  assert.deepEqual(optionsSeen[0].expectedInputs, [{ type: 'text', languages: ['en'] }]);
  // 2nd: responseConstraint without language options
  assert.equal(optionsSeen[1].responseConstraint, RESPONSE_SCHEMA);
  assert.equal('expectedInputs' in optionsSeen[1], false);
  // 3rd: language options without responseConstraint
  assert.equal('responseConstraint' in optionsSeen[2], false);
  assert.deepEqual(optionsSeen[2].expectedInputs, [{ type: 'text', languages: ['en'] }]);
  // 4th: minimal initialPrompts
  assert.equal(optionsSeen[3].initialPrompts.length, 9);
  assert.equal('expectedInputs' in optionsSeen[3], false);
  assert.equal('responseConstraint' in optionsSeen[3], false);
});

test('constructSession falls back to the standard system prompt shape', async () => {
  const optionsSeen = [];
  const session = {};
  global.LanguageModel = modernApi(async options => {
    optionsSeen.push(options);
    if (optionsSeen.length < 5) throw new DOMException('unsupported', 'NotSupportedError');
    return session;
  });

  const metadata = await constructSession();

  assert.equal(metadata.session, session);
  assert.equal(metadata.fewShotBaked, false);
  assert.equal(metadata.responseConstraint, false);
  assert.equal(metadata.cloneCapable, false);
  assert.equal(optionsSeen.length, 5);
  assert.equal(typeof optionsSeen[4].systemPrompt, 'string');
  assert.equal('initialPrompts' in optionsSeen[4], false);
});

test('constructSession does not retry operational creation failures', async () => {
  const failure = new Error('model failed');
  let creates = 0;
  global.LanguageModel = modernApi(async () => {
    creates++;
    throw failure;
  });

  await assert.rejects(constructSession(), error => error === failure);
  assert.equal(creates, 1);
});

test('constructSession uses legacy namespace when standard API is absent', async () => {
  const session = {};
  let capabilities = 0;
  let optionsSeen;
  global.window = {
    ai: {
      languageModel: {
        capabilities: async () => {
          capabilities++;
          return { available: 'readily' };
        },
        create: async options => {
          optionsSeen = options;
          return session;
        },
      },
    },
  };

  const metadata = await constructSession();

  assert.equal(metadata.session, session);
  assert.equal(metadata.fewShotBaked, false);
  assert.equal(metadata.cloneCapable, false);
  assert.equal(capabilities, 1);
  assert.equal(typeof optionsSeen.systemPrompt, 'string');
});

test('rewriteText uses a separate modern clone session without response constraints', async () => {
  const optionsSeen = [];
  let cloneCount = 0;
  let cloneDestroy = 0;
  const base = {
    async clone() {
      cloneCount++;
      return {
        prompt: async messages => {
          assert.equal(messages[0].role, 'user');
          assert.match(messages[0].content, /Rewrite the user's draft below/);
          return '"Rewritten text."';
        },
        destroy() { cloneDestroy++; },
      };
    },
    destroy() {},
  };
  global.LanguageModel = modernApi(async options => {
    optionsSeen.push(options);
    return base;
  });

  assert.equal(await rewriteText('Original text', 'clearer', 'en'), 'Rewritten text.');
  assert.equal(optionsSeen.length, 1);
  assert.equal(optionsSeen[0].initialPrompts[0].role, 'system');
  assert.deepEqual(optionsSeen[0].expectedInputs, [{ type: 'text', languages: ['en'] }]);
  assert.equal('responseConstraint' in optionsSeen[0], false);
  assert.equal(cloneCount, 1);
  assert.equal(cloneDestroy, 1);
});

test('rewriteText retries with a reduced modern option shape after TypeError', async () => {
  const optionsSeen = [];
  global.LanguageModel = modernApi(async options => {
    optionsSeen.push(options);
    if (optionsSeen.length === 1) throw new TypeError('unsupported options');
    return {
      prompt: async () => '"Shorter text."',
      destroy() {},
    };
  });

  assert.equal(await rewriteText('Original text', 'shorter'), 'Shorter text.');
  assert.equal(optionsSeen.length, 2);
  assert.equal('initialPrompts' in optionsSeen[1], true);
  assert.equal('expectedInputs' in optionsSeen[1], false);
});

test('rewriteText uses the legacy namespace and rejects in Firefox context', async () => {
  let optionsSeen;
  global.window = {
    ai: {
      languageModel: {
        capabilities: async () => ({ available: 'readily' }),
        create: async options => {
          optionsSeen = options;
          return { prompt: async () => '“Legacy rewrite.”' };
        },
      },
    },
  };
  assert.equal(await rewriteText('Original text', 'friendly'), 'Legacy rewrite.');
  assert.equal(optionsSeen.systemPrompt.includes('writing assistant'), true);

  delete global.window;
  global.browser = { runtime: { sendMessage: async () => ({}) } };
  await assert.rejects(rewriteText('Original text', 'friendly'), /rewrite unavailable/);
});

test('shouldShowRatePrompt follows the threshold and completion state', () => {
  assert.equal(shouldShowRatePrompt(RATE_AFTER_APPLIES - 1, null), false);
  assert.equal(shouldShowRatePrompt(RATE_AFTER_APPLIES, null), true);
  assert.equal(shouldShowRatePrompt(RATE_AFTER_APPLIES + 1, 'later'), true);
  assert.equal(shouldShowRatePrompt(RATE_AFTER_APPLIES, 'done'), false);
});

test('analysisModeFrom only accepts manual explicitly', () => {
  assert.equal(analysisModeFrom('manual'), 'manual');
  assert.equal(analysisModeFrom('auto'), 'auto');
  assert.equal(analysisModeFrom('unexpected'), 'auto');
  assert.equal(analysisModeFrom(undefined), 'auto');
});

test('getModelStatus reports available without triggering create', async () => {
  let creates = 0;
  global.LanguageModel = {
    availability: async () => 'available',
    create: async () => { creates++; },
  };

  assert.equal(await getModelStatus(), 'available');
  assert.equal(creates, 0);
});

test('getModelStatus reports downloading for a not-yet-ready standard model', async () => {
  global.LanguageModel = { availability: async () => 'downloadable' };
  assert.equal(await getModelStatus(), 'downloading');

  global.LanguageModel = { availability: async () => 'downloading' };
  assert.equal(await getModelStatus(), 'downloading');
});

test('getModelStatus reports unavailable when the standard model cannot run here', async () => {
  global.LanguageModel = { availability: async () => 'unavailable' };
  assert.equal(await getModelStatus(), 'unavailable');
});

test('getModelStatus maps the legacy capabilities namespace', async () => {
  global.window = { ai: { languageModel: { capabilities: async () => ({ available: 'readily' }) } } };
  assert.equal(await getModelStatus(), 'available');

  global.window = { ai: { languageModel: { capabilities: async () => ({ available: 'after-download' }) } } };
  assert.equal(await getModelStatus(), 'downloading');

  global.window = { ai: { languageModel: { capabilities: async () => ({ available: 'no' }) } } };
  assert.equal(await getModelStatus(), 'unavailable');
});

test('getModelStatus reports unavailable when neither API namespace exists', async () => {
  assert.equal(await getModelStatus(), 'unavailable');
});

test('concurrent reusable session callers share one creation promise', async () => {
  let release;
  let creates = 0;
  const session = { clone() {}, destroy() {} };
  global.LanguageModel = modernApi(async () => {
    creates++;
    await new Promise(resolve => { release = resolve; });
    return session;
  });

  const first = getSession();
  const second = getSession();
  await Promise.resolve();
  release();
  const [firstMetadata, secondMetadata] = await Promise.all([first, second]);

  assert.equal(creates, 1);
  assert.equal(firstMetadata, secondMetadata);
  assert.equal(firstMetadata.session, session);
});

test('concurrent creation failure reaches all waiters and a later call retries', async () => {
  const failure = new Error('creation failed');
  let release;
  let creates = 0;
  global.LanguageModel = modernApi(async () => {
    creates++;
    if (creates === 1) {
      await new Promise(resolve => { release = resolve; });
      throw failure;
    }
    return { clone() {}, destroy() {} };
  });

  const first = getSession();
  const second = getSession();
  await Promise.resolve();
  release();
  const rejected = await Promise.allSettled([first, second]);

  assert.equal(rejected[0].reason, failure);
  assert.equal(rejected[1].reason, failure);
  const retried = await getSession();
  assert.equal(creates, 2);
  assert.equal(retried.cloneCapable, true);
});

test('clone-capable analyses reuse one base and destroy separate clones', async () => {
  const stats = { create: 0, clone: 0, stream: 0, cloneDestroy: 0, baseDestroy: 0 };
  const promptedSessions = [];
  const base = {
    async clone() {
      const id = ++stats.clone;
      return {
        async * promptStreaming(messages) {
          stats.stream++;
          promptedSessions.push(id);
          assert.equal(messages.length, 1);
          yield '{"sentiment":"positive","reason":"Kind."}';
        },
        destroy() { stats.cloneDestroy++; },
      };
    },
    destroy() { stats.baseDestroy++; },
  };
  global.LanguageModel = modernApi(async () => {
    stats.create++;
    return base;
  });

  const [first, second] = await Promise.all([
    analyzeText('first friendly comment'),
    analyzeText('second friendly comment'),
  ]);

  assert.equal(first.sentiment, 'positive');
  assert.equal(second.sentiment, 'positive');
  assert.deepEqual(stats, { create: 1, clone: 2, stream: 2, cloneDestroy: 2, baseDestroy: 0 });
  assert.deepEqual(promptedSessions.sort(), [1, 2]);
});

test('concurrent and sequential no-clone analyses each own a fresh session', async () => {
  const sessions = [];
  global.window = {
    ai: {
      languageModel: {
        capabilities: async () => ({ available: 'readily' }),
        create: async () => {
          const record = { id: sessions.length + 1, prompts: 0, destroys: 0 };
          sessions.push(record);
          return {
            async prompt(messages) {
              record.prompts++;
              assert.equal(messages.length, 10);
              return '"neutral","reason":"Measured."}';
            },
            destroy() { record.destroys++; },
          };
        },
      },
    },
  };

  await Promise.all([
    analyzeText('first legacy comment'),
    analyzeText('second legacy comment'),
  ]);
  await analyzeText('third legacy comment');

  assert.equal(sessions.length, 3);
  assert.deepEqual(sessions.map(session => session.id), [1, 2, 3]);
  assert.deepEqual(sessions.map(session => session.prompts), [1, 1, 1]);
  assert.deepEqual(sessions.map(session => session.destroys), [1, 1, 1]);
});

test('stream failure destroys the clone but preserves the reusable base', async () => {
  const failure = new Error('stream failed');
  let cloneDestroys = 0;
  let baseDestroys = 0;
  global.LanguageModel = modernApi(async () => ({
    clone: async () => ({
      async * promptStreaming() {
        throw failure;
      },
      destroy() { cloneDestroys++; },
    }),
    destroy() { baseDestroys++; },
  }));

  await assert.rejects(analyzeText('stream failure comment'), error => error === failure);

  assert.equal(cloneDestroys, 1);
  assert.equal(baseDestroys, 0);
});

test('prompt failure destroys a single-use no-clone session', async () => {
  const failure = new Error('prompt failed');
  let destroys = 0;
  global.window = {
    ai: {
      languageModel: {
        capabilities: async () => ({ available: 'readily' }),
        create: async () => ({
          prompt: async () => { throw failure; },
          destroy() { destroys++; },
        }),
      },
    },
  };

  await assert.rejects(analyzeText('legacy failure comment'), error => error === failure);

  assert.equal(destroys, 1);
});

test('aborted analysis destroys its clone without destroying the reusable base', async () => {
  const controller = new AbortController();
  let cloneDestroys = 0;
  let baseDestroys = 0;
  global.LanguageModel = modernApi(async () => ({
    clone: async () => ({
      async * promptStreaming(messages, options) {
        assert.equal(options.signal, controller.signal);
        throw new DOMException('Aborted', 'AbortError');
      },
      destroy() { cloneDestroys++; },
    }),
    destroy() { baseDestroys++; },
  }));
  controller.abort();

  await assert.rejects(
    analyzeText('aborted modern comment', undefined, controller.signal),
    { name: 'AbortError' },
  );

  assert.equal(cloneDestroys, 1);
  assert.equal(baseDestroys, 0);
});

test('TTL expiry destroys a reusable base once and creates a replacement', async () => {
  const bases = [];
  global.LanguageModel = modernApi(async () => {
    const record = { destroys: 0 };
    bases.push(record);
    return {
      clone() {},
      destroy() { record.destroys++; },
    };
  });

  const first = await getSession();
  expireReusableSession(Date.now() + 600_001);
  const second = await getSession();

  assert.notEqual(first.session, second.session);
  assert.equal(bases.length, 2);
  assert.equal(bases[0].destroys, 1);
  assert.equal(bases[1].destroys, 0);
});

test('analyzeText delegates to the Firefox background service', async () => {
  const calls = [];
  global.browser = {
    runtime: {
      sendMessage: async message => {
        calls.push(message);
        return { ok: true, result: { sentiment: 'toxic', reason: 'Insulting.', rewrite: null } };
      },
    },
  };

  assert.equal(isFirefoxMLContext(), true);
  const result = await analyzeText('you are all idiots');

  assert.deepEqual(calls, [{ type: 'cv-analyze', text: 'you are all idiots' }]);
  assert.equal(result.sentiment, 'toxic');
  assert.equal(result.emoji, '🚫');
  assert.equal(result.label, 'Toxic');
  assert.equal(result.reason, 'Insulting.');
});

test('analyzeText uses Jev in Fast mode and never touches the local model', async () => {
  const calls = [];
  global.browser = {
    runtime: {
      sendMessage: async message => {
        calls.push(message.type);
        return { ok: true, result: { sentiment: 'negative', reason: 'Jev reads this as critical.', rewrite: null } };
      },
    },
  };
  applyJevSetting(true);
  try {
    const result = await analyzeText('this is pointless and slow');
    assert.deepEqual(calls, ['cv-jev-analyze']);
    assert.equal(result.engine, 'jev');
    assert.equal(result.sentiment, 'negative');
    assert.equal(result.label, 'Negative');
  } finally {
    applyJevSetting(false);
  }
});

test('analyzeText falls back to on-device AI when Jev fails', async () => {
  const calls = [];
  const warn = console.warn;
  console.warn = () => {};
  global.browser = {
    runtime: {
      sendMessage: async message => {
        calls.push(message.type);
        if (message.type === 'cv-jev-analyze') return { ok: false, error: 'TypeSafe rejected the API key' };
        return { ok: true, result: { sentiment: 'positive', reason: 'Kind.', rewrite: null } };
      },
    },
  };
  applyJevSetting(true);
  try {
    const result = await analyzeText('thanks, this was really helpful');
    assert.deepEqual(calls, ['cv-jev-analyze', 'cv-analyze']);
    assert.equal(result.sentiment, 'positive');
    assert.equal(result.engine, undefined);
  } finally {
    applyJevSetting(false);
    console.warn = warn;
  }
});

test('analyzeText keeps the Jev error when the on-device fallback also fails', async () => {
  global.browser = {
    runtime: {
      sendMessage: async message => (message.type === 'cv-jev-analyze'
        ? { ok: false, error: 'TypeSafe rejected the API key' }
        : { ok: false, error: 'trialML permission not granted' }),
    },
  };
  applyJevSetting(true);
  try {
    await assert.rejects(analyzeText('long enough text'), error => {
      assert.match(error.message, /trialML/);
      assert.match(error.jevError.message, /rejected the API key/);
      return true;
    });
  } finally {
    applyJevSetting(false);
  }
});

test('analyzeText does not call Jev while Fast mode is off', async () => {
  const calls = [];
  global.browser = {
    runtime: {
      sendMessage: async message => {
        calls.push(message.type);
        return { ok: true, result: { sentiment: 'neutral', reason: 'Calm.', rewrite: null } };
      },
    },
  };
  await analyzeText('what time does it start?');
  assert.deepEqual(calls, ['cv-analyze']);
});

test('analyzeViaJev surfaces background errors', async () => {
  global.browser = { runtime: { sendMessage: async () => ({ ok: false, error: 'Fast mode is off' }) } };
  await assert.rejects(analyzeViaJev('long enough text'), /Fast mode is off/);
});

test('analyzeViaBackground surfaces background errors', async () => {
  global.browser = {
    runtime: { sendMessage: async () => ({ ok: false, error: 'Firefox on-device AI is not enabled' }) },
  };
  await assert.rejects(analyzeViaBackground('long enough text'), /not enabled/);

  global.browser = { runtime: { sendMessage: async () => undefined } };
  await assert.rejects(analyzeViaBackground('long enough text'), /analysis failed/);
});

test('normalizeHost lowercases and strips a leading www.', () => {
  assert.equal(normalizeHost('WWW.LinkedIn.COM'), 'linkedin.com');
  assert.equal(normalizeHost('news.ycombinator.com'), 'news.ycombinator.com');
  assert.equal(normalizeHost(''), '');
  assert.equal(normalizeHost(undefined), '');
});

test('hostDisabled matches the normalized host list and the global toggle', () => {
  const hosts = new Set(['linkedin.com']);
  assert.equal(hostDisabled('www.linkedin.com', hosts, true), true);
  assert.equal(hostDisabled('linkedin.com', hosts, true), true);
  assert.equal(hostDisabled('m.linkedin.com', hosts, true), false);
  assert.equal(hostDisabled('linkedin.com', hosts, false), true);
  assert.equal(hostDisabled('anything.example', hosts, false), true);
  assert.equal(hostDisabled('anything.example', new Set(), true), false);
});

test('applyRewrite sets a textarea value and fires an input event', () => {
  const dispatched = [];
  const el = {
    tagName: 'TEXTAREA',
    value: 'harsh draft',
    dispatchEvent: event => dispatched.push(event),
    focus() { this.focused = true; },
  };

  applyRewrite(el, 'kinder version');

  assert.equal(el.value, 'kinder version');
  assert.equal(el.focused, true);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'input');
  assert.equal(dispatched[0].bubbles, true);
});

test('applyRewrite prefers execCommand for rich-text editors', () => {
  const commands = [];
  const dispatched = [];
  const el = {
    tagName: 'DIV',
    textContent: 'harsh draft',
    ownerDocument: {
      execCommand: (command, ui, value) => { commands.push([command, value]); return true; },
      getSelection: () => null,
      createRange: () => null,
    },
    dispatchEvent: event => dispatched.push(event),
    focus() {},
  };

  applyRewrite(el, 'kinder version');

  assert.deepEqual(commands, [['insertText', 'kinder version']]);
  assert.equal(el.textContent, 'harsh draft');
  assert.equal(dispatched.length, 1);
});

test('applyRewrite falls back to textContent when execCommand is unavailable', () => {
  const el = {
    tagName: 'DIV',
    textContent: 'harsh draft',
    ownerDocument: {},
    dispatchEvent() {},
    focus() {},
  };

  applyRewrite(el, 'kinder version');

  assert.equal(el.textContent, 'kinder version');
});

test('applyViaExecCommand reports false when the document cannot run it', () => {
  assert.equal(applyViaExecCommand({ tagName: 'DIV', ownerDocument: {} }, 'x'), false);
  assert.equal(applyViaExecCommand({ tagName: 'DIV' }, 'x'), false);
});

test('Chrome exposing the browser namespace is not mistaken for Firefox', () => {
  const saved = global.browser;
  const runtime = manifest => ({ sendMessage: async () => ({}), getManifest: () => manifest });
  try {
    global.browser = { runtime: runtime({ background: { service_worker: 'jev.js' } }) };
    assert.equal(isChromeBuild(), true);
    assert.equal(isFirefoxMLContext(), false);

    global.browser = { runtime: runtime({ background: { scripts: ['jev.js', 'background.js'] } }) };
    assert.equal(isChromeBuild(), false);
    assert.equal(isFirefoxMLContext(), true);
  } finally {
    global.browser = saved;
  }
});

test('Chrome Prompt API wins over the Firefox path when both exist', async () => {
  global.browser = {
    runtime: { sendMessage: async () => { throw new Error('background must not be called'); } },
  };
  global.LanguageModel = modernApi(async () => ({
    clone: async () => sessionFor(['{"sentiment":"positive"}'.slice('{"sentiment":'.length)]),
    destroy() {},
  }));

  assert.equal(isFirefoxMLContext(), false);
  const result = await analyzeText('lovely and helpful writeup');
  assert.equal(result.sentiment, 'positive');
});

// ── "Use this" = done: applied rewrites are not re-checked ───────────────────

const NEGATIVE_WITH_REWRITE =
  '{"sentiment":"negative","reason":"Harsh wording.","rewrite":"Maybe there is a kinder way."}';

const typeAndAnalyze = async (el, text) => {
  el.value = text;
  el.dispatchEvent({ type: 'input' });
  await sleepUntilAnalyzed();
};

const clickButtonWithText = (root, selector, text) => {
  const button = root.querySelectorAll(selector).find(b => b.textContent === text);
  assert.ok(button, `button "${text}" (${selector})`);
  button.click();
};

test('buildTooltipTools explains local AI is needed when no Prompt API is available', () => {
  const { state } = attachFakeField();
  try {
    delete global.LanguageModel;
    delete global.window.ai;
    const tools = buildTooltipTools(() => {});

    assert.equal(tools.querySelector('.cv-tooltip-tools-label').textContent, 'Improve this text');
    assert.equal(tools.querySelectorAll('.cv-tooltip-chip').length, 0);
    assert.equal(
      tools.querySelector('.cv-tooltip-note').textContent,
      'Rewriting needs on-device AI, which isn’t available in this browser.',
    );
  } finally {
    state.cleanup();
  }
});

test('buildTooltipTools renders all five rewrite modes when LanguageModel is available', () => {
  const { state } = attachFakeField();
  try {
    global.LanguageModel = modernApi(async () => {});
    const tools = buildTooltipTools(() => {});

    const chips = tools.querySelectorAll('.cv-tooltip-chip');
    assert.equal(chips.length, 5);
    assert.deepEqual(chips.map(chip => chip.dataset.mode), Object.keys(REWRITE_MODES));
    assert.equal(tools.querySelector('.cv-tooltip-note'), null);
  } finally {
    state.cleanup();
  }
});

test('unavailable rewrite model shows the local AI guidance in the tooltip', async () => {
  let availabilityCalls = 0;
  global.LanguageModel = {
    availability: async () => ++availabilityCalls <= 2 ? 'available' : 'unavailable',
    create: async () => ({
      clone: async () => ({
        async * promptStreaming() { yield NEGATIVE_WITH_REWRITE; },
        destroy() {},
      }),
      destroy() {},
    }),
  };
  applySettings([], true, 'auto');
  const { el, state } = attachFakeField();
  try {
    await typeAndAnalyze(el, 'that is an outrageously terrible post');
    assert.equal(availabilityCalls, 2);
    clickButtonWithText(state.tooltip, '.cv-tooltip-chip', 'Fix grammar');
    await sleep(0);

    assert.equal(availabilityCalls, 3);
    assert.match(state.tooltip.textContent, /Rewriting needs on-device AI, which isn’t available in this browser\./);
  } finally {
    state.cleanup();
  }
});

test('applying the suggested rewrite shows the applied state without re-analyzing', async () => {
  const stats = { analyses: 0 };
  global.LanguageModel = nanoReturning(stats, NEGATIVE_WITH_REWRITE);
  const { el, state } = attachFakeField();
  try {
    await typeAndAnalyze(el, 'this is the dumbest idea ever posted');
    assert.equal(stats.analyses, 1);
    assert.match(state.badge.className, /cv-badge--negative/);

    clickButtonWithText(state.tooltip, '.cv-tooltip-apply', 'Use this rewrite');

    assert.equal(el.value, 'Maybe there is a kinder way.');
    assert.equal(stats.analyses, 1);
    assert.match(state.badge.className, /cv-badge--applied/);
    assert.doesNotMatch(state.badge.className, /cv-badge--positive/);
    assert.equal(state.badge.style.getPropertyValue('background'), '#f4f6fa');
    assert.equal(state.badge.textContent, '✓ Rewritten');
    assert.match(state.tooltip.textContent, /Not re-checked/);
    await sleepUntilAnalyzed();
    assert.equal(stats.analyses, 1);
    assert.match(state.badge.className, /cv-badge--applied/);
  } finally {
    state.cleanup();
  }
});

test('applying a writing-tool chip rewrite also lands on the applied state', async () => {
  const stats = { analyses: 0 };
  global.LanguageModel = nanoReturning(stats, NEGATIVE_WITH_REWRITE);
  const { el, state } = attachFakeField();
  try {
    await typeAndAnalyze(el, 'what a completely idiotic suggestion');
    clickButtonWithText(state.tooltip, '.cv-tooltip-chip', 'Friendlier');
    await sleep(50);
    clickButtonWithText(state.tooltip, '.cv-tooltip-apply', 'Use this');

    assert.equal(el.value, 'A friendlier rewrite.');
    assert.match(state.badge.className, /cv-badge--applied/);
    assert.equal(state.badge.textContent, '✓ Rewritten');
    await sleepUntilAnalyzed();
    assert.equal(stats.analyses, 1);
  } finally {
    state.cleanup();
  }
});

test('editing the text after applying clears the applied state and re-analyzes', async () => {
  const stats = { analyses: 0 };
  global.LanguageModel = nanoReturning(stats, NEGATIVE_WITH_REWRITE);
  const { el, state } = attachFakeField();
  try {
    await typeAndAnalyze(el, 'that post is total garbage and you know it');
    clickButtonWithText(state.tooltip, '.cv-tooltip-apply', 'Use this rewrite');
    assert.match(state.badge.className, /cv-badge--applied/);

    await typeAndAnalyze(el, 'an entirely different comment here');
    assert.equal(state.appliedText, null);
    assert.equal(stats.analyses, 2);
    assert.match(state.badge.className, /cv-badge--negative/);
  } finally {
    state.cleanup();
  }
});

test('whitespace-only differences still count as the applied rewrite', async () => {
  const stats = { analyses: 0 };
  global.LanguageModel = nanoReturning(stats, NEGATIVE_WITH_REWRITE);
  const { el, state } = attachFakeField();
  try {
    await typeAndAnalyze(el, 'nobody asked for your terrible opinion');
    clickButtonWithText(state.tooltip, '.cv-tooltip-apply', 'Use this rewrite');
    assert.match(state.badge.className, /cv-badge--applied/);

    el.value = 'Maybe  there is a kinder way. ';
    el.dispatchEvent({ type: 'input' });
    assert.match(state.badge.className, /cv-badge--applied/);
    await sleepUntilAnalyzed();
    assert.equal(stats.analyses, 1);
  } finally {
    state.cleanup();
  }
});

test('Refresh after applying re-checks the applied text', async () => {
  const stats = { analyses: 0 };
  global.LanguageModel = nanoReturning(stats, NEGATIVE_WITH_REWRITE);
  const { el, state } = attachFakeField();
  try {
    await typeAndAnalyze(el, 'your comment is genuinely awful and rude');
    clickButtonWithText(state.tooltip, '.cv-tooltip-apply', 'Use this rewrite');
    assert.match(state.badge.className, /cv-badge--applied/);

    const refresh = state.tooltip.querySelector('[aria-label="Analyze again"]');
    assert.ok(refresh);
    refresh.click();
    assert.equal(state.appliedText, null);
    await sleepUntilAnalyzed();
    assert.equal(stats.analyses, 2);
    assert.match(state.badge.className, /cv-badge--negative/);
  } finally {
    state.cleanup();
  }
});

test('Undo restores the original text and goes through the normal flow', async () => {
  const stats = { analyses: 0 };
  global.LanguageModel = nanoReturning(stats, NEGATIVE_WITH_REWRITE);
  const { el, state } = attachFakeField();
  try {
    await typeAndAnalyze(el, 'this whole thread is embarrassingly bad');
    clickButtonWithText(state.tooltip, '.cv-tooltip-apply', 'Use this rewrite');
    assert.match(state.badge.className, /cv-badge--applied/);

    clickButtonWithText(state.tooltip, '.cv-tooltip-copy', 'Undo');
    assert.equal(el.value, 'this whole thread is embarrassingly bad');
    assert.equal(state.appliedText, null);
    await sleepUntilAnalyzed();
    assert.match(state.badge.className, /cv-badge--negative/);
  } finally {
    state.cleanup();
  }
});

test('manual mode: applying a rewrite shows the applied badge, not idle', async () => {
  const stats = { analyses: 0 };
  global.LanguageModel = nanoReturning(stats, NEGATIVE_WITH_REWRITE);
  applySettings([], true, 'manual');
  const { el, state } = attachFakeField();
  try {
    el.value = 'you clearly have no clue what you wrote';
    el.dispatchEvent({ type: 'input' });
    assert.match(state.badge.className, /cv-badge--idle/);

    state.onInput({ force: true, immediate: true, openTooltip: true });
    await sleep(50);
    assert.match(state.badge.className, /cv-badge--negative/);

    clickButtonWithText(state.tooltip, '.cv-tooltip-apply', 'Use this rewrite');
    assert.match(state.badge.className, /cv-badge--applied/);
    assert.doesNotMatch(state.badge.className, /cv-badge--idle/);
    await sleepUntilAnalyzed();
    assert.equal(stats.analyses, 1);
    assert.match(state.badge.className, /cv-badge--applied/);
  } finally {
    state.cleanup();
    applySettings([], true, 'auto');
  }
});
