'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeText,
  beginInputChange,
  constructSession,
  expireReusableSession,
  getSession,
  invalidateRequest,
  isCleanupEligible,
  isCurrentRequest,
  normalize,
  normalizeDetectedLanguage,
  parseResponse,
  resetSessionState,
  streamPrompt,
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
  delete global.LanguageModel;
  delete global.window;
});

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

test('streamPrompt fires the early sentiment callback exactly once', async () => {
  const sentiments = [];
  const raw = await streamPrompt(
    sessionFor(['"toxic"', ',"reason":"Hostile."', ',"rewrite":"Be respectful."}']),
    [{ role: 'user', content: 'message' }],
    sentiment => sentiments.push(sentiment),
  );

  assert.equal(raw, '"toxic","reason":"Hostile.","rewrite":"Be respectful."}');
  assert.deepEqual(sentiments, ['toxic']);
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
      yield '"negative"';
      if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      yield ',"reason":"Harsh."}';
    },
  };

  await assert.rejects(
    streamPrompt(
      session,
      [{ role: 'user', content: 'message' }],
      () => invalidateRequest(state),
      controller.signal,
    ).then(() => {
      if (isCurrentRequest(state, requestId)) finalRendered = true;
    }),
    { name: 'AbortError' },
  );

  assert.equal(controller.signal.aborted, true);
  assert.equal(state.requestId, 2);
  assert.equal(finalRendered, false);
});

test('constructSession prefers standard API with initial prompts and language options', async () => {
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
  assert.equal(metadata.cloneCapable, true);
  assert.equal(optionsSeen.length, 1);
  assert.equal(optionsSeen[0].initialPrompts.length, 5);
  assert.deepEqual(optionsSeen[0].expectedInputs, [{ type: 'text', languages: ['en'] }]);
  assert.deepEqual(optionsSeen[0].expectedOutputs, [{ type: 'text', languages: ['en'] }]);
  assert.equal(legacyCreates, 0);
});

test('constructSession retries initial prompts without language options', async () => {
  const optionsSeen = [];
  const session = { clone() {} };
  global.LanguageModel = modernApi(async options => {
    optionsSeen.push(options);
    if (optionsSeen.length === 1) throw new TypeError('unsupported language options');
    return session;
  });

  const metadata = await constructSession();

  assert.equal(metadata.session, session);
  assert.equal(metadata.fewShotBaked, true);
  assert.equal(optionsSeen.length, 2);
  assert.equal(optionsSeen[1].initialPrompts.length, 5);
  assert.equal('expectedInputs' in optionsSeen[1], false);
});

test('constructSession falls back to the standard system prompt shape', async () => {
  const optionsSeen = [];
  const session = {};
  global.LanguageModel = modernApi(async options => {
    optionsSeen.push(options);
    if (optionsSeen.length < 3) throw new DOMException('unsupported', 'NotSupportedError');
    return session;
  });

  const metadata = await constructSession();

  assert.equal(metadata.session, session);
  assert.equal(metadata.fewShotBaked, false);
  assert.equal(metadata.cloneCapable, false);
  assert.equal(optionsSeen.length, 3);
  assert.equal(typeof optionsSeen[2].systemPrompt, 'string');
  assert.equal('initialPrompts' in optionsSeen[2], false);
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
          assert.equal(messages.length, 2);
          yield '"positive","reason":"Kind."}';
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
              assert.equal(messages.length, 6);
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
