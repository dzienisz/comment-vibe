'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const popupSource = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
const initIndex = popupSource.indexOf('\n(async () => {');
assert.notEqual(initIndex, -1);
const popupDeclarations = popupSource.slice(0, initIndex);

async function autoModeChecked(stored = {}) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          classList: { add() {}, remove() {}, toggle() {} },
          addEventListener() {},
        });
      }
      return elements.get(id);
    },
  };
  const context = vm.createContext({
    document,
    navigator: { userAgent: 'Chrome' },
    window: {},
  });
  vm.runInContext(popupSource, context);
  context.api = {
    storage: {
      sync: {
        get(defaults) {
          return Object.fromEntries(Object.keys(defaults).map(key => [
            key,
            Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : defaults[key],
          ]));
        },
        set() {},
      },
    },
    tabs: { query: async () => [] },
  };
  await vm.runInContext('initPrefs(api)', context);
  return elements.get('auto-mode').checked;
}

test('popup restores automatic checking as off when manual mode is stored', async () => {
  assert.equal(await autoModeChecked({ cvMode: 'manual' }), false);
});

test('popup defaults automatic checking on when no mode is stored', async () => {
  assert.equal(await autoModeChecked(), true);
});

function loadPopupContext(LanguageModel) {
  const timers = new Map();
  let nextTimerId = 0;
  let now = 0;
  const context = vm.createContext({
    LanguageModel,
    window: {},
    setTimeout(callback, delay) {
      const timerId = ++nextTimerId;
      timers.set(timerId, { callback, dueAt: now + delay });
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
  });
  vm.runInContext(popupDeclarations, context, { filename: 'popup.js' });

  return {
    chromeAIStatus: () => context.chromeAIStatus(),
    tick(milliseconds) {
      now += milliseconds;
      for (const [timerId, timer] of timers) {
        if (timer.dueAt <= now) {
          timers.delete(timerId);
          timer.callback();
        }
      }
    },
    get pendingTimerCount() {
      return timers.size;
    },
  };
}

test('chromeAIStatus treats a stalled Prompt API probe as unavailable after five seconds', async () => {
  const popup = loadPopupContext({
    availability: () => new Promise(() => {}),
  });
  const status = popup.chromeAIStatus();

  popup.tick(5000);
  assert.equal(await status, 'unavailable');
  assert.equal(popup.pendingTimerCount, 0);
});

test('chromeAIStatus preserves a quickly available Prompt API result', async () => {
  let calls = 0;
  const popup = loadPopupContext({
    availability: async () => {
      calls++;
      return 'available';
    },
  });

  const status = await popup.chromeAIStatus();
  popup.tick(5000);

  assert.equal(status, 'available');
  assert.equal(calls, 1);
  assert.equal(popup.pendingTimerCount, 0);
});

test('aiSettingsUrl opens the AI settings page on Chrome 152+ and System settings before that', () => {
  const context = vm.createContext({ window: {}, navigator: { userAgent: '' } });
  vm.runInContext(popupDeclarations, context, { filename: 'popup.js' });
  const ua = v => `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;

  assert.equal(context.aiSettingsUrl(ua('155.0.8059.84')), 'chrome://settings/ai');
  assert.equal(context.aiSettingsUrl(ua('152.0.0.0')), 'chrome://settings/ai');
  assert.equal(context.aiSettingsUrl(ua('151.0.0.0')), 'chrome://settings/system');
  assert.equal(context.aiSettingsUrl('Mozilla/5.0'), 'chrome://settings/ai');
});
