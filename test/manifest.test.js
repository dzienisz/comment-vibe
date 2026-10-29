'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const chromeManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const firefoxManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.firefox.json'), 'utf8'));

test('manifest descriptions fit the 132-character store limit', () => {
  for (const manifest of [chromeManifest, firefoxManifest]) {
    assert.ok(manifest.description.length <= 132, `${manifest.description.length}-character description`);
    assert.equal(
      manifest.description,
      "On-device AI checks your comment's tone on LinkedIn, X, YouTube or Reddit and offers a kinder rewrite before posting. Private, free."
    );
  }
});

test('manifest names fit their store limits', () => {
  assert.ok(chromeManifest.name.length <= 75, `${chromeManifest.name.length}-character Chrome name`);
  assert.equal(firefoxManifest.name, 'Comment Vibe — Private AI Tone Checker');
  assert.ok(firefoxManifest.name.length <= 45, `${firefoxManifest.name.length}-character Firefox name`);
});

test('Chrome and Firefox manifests use the same version', () => {
  assert.equal(chromeManifest.version, firefoxManifest.version);
});
