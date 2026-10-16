'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const popupScript = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');

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
  vm.runInContext(popupScript, context);
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
