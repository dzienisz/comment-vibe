'use strict';

const LANG_OPTS = {
  expectedInputs:  [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

function storeUrl() {
  return navigator.userAgent.includes('Firefox')
    ? 'https://addons.mozilla.org/firefox/addon/comment-vibe-on-device-check/'
    : 'https://chromewebstore.google.com/detail/comment-vibe/kibcnjcipaofjlbbnjdjaobbkoajiejp';
}

// 'available' | 'downloadable' | 'downloading' | 'unavailable' — the middle
// states matter: telling a user whose model is still downloading that the AI is
// "not available" sends them chasing flags that no longer exist on Chrome 138+,
// and a download already in progress should show its progress, not a button.
async function chromeAIStatus() {
  try {
    if (typeof LanguageModel !== 'undefined') {
      // Pass language options to satisfy the API requirement;
      // fall back without them for older Chrome builds that reject the options.
      let avail = await LanguageModel.availability(LANG_OPTS);
      if (avail === 'unavailable') avail = await LanguageModel.availability();
      if (avail === 'unavailable') return 'unavailable';
      return avail === 'available' || avail === 'downloading' ? avail : 'downloadable';
    }
    if (window.ai?.languageModel) {
      const { available } = await window.ai.languageModel.capabilities();
      if (available === 'no') return 'unavailable';
      return available === 'readily' ? 'available' : 'downloadable';
    }
  } catch {}
  return 'unavailable';
}

function hasChromeAI() {
  return typeof LanguageModel !== 'undefined' || !!window.ai?.languageModel;
}

// Chrome now exposes `browser` as well; only the Chrome manifest has a service worker.
function isFirefox() {
  if (typeof browser === 'undefined' || !browser.permissions) return false;
  try {
    return !browser.runtime?.getManifest?.()?.background?.service_worker;
  } catch {
    return true;
  }
}

// Real extension context (not a plain page preview): chrome.runtime exists on
// regular web pages too, but only extension pages get an id.
function getExtApi() {
  if (typeof browser !== 'undefined' && browser.runtime?.id) return browser;
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) return chrome;
  return null;
}

function setStatus(els, kind, text) {
  els.statusEl.className = `status status--${kind}`;
  els.statusTxt.textContent = text;
}

// Progress event shapes differ between Firefox versions — extract a
// percentage from whichever fields are present, or give up (null).
function progressPercent(data) {
  if (typeof data?.progress === 'number') {
    return Math.round(data.progress <= 1 ? data.progress * 100 : data.progress);
  }
  if (typeof data?.totalLoaded === 'number' && typeof data?.total === 'number' && data.total > 0) {
    return Math.round((data.totalLoaded / data.total) * 100);
  }
  return null;
}

const normalizeHost = host => String(host || '').toLowerCase().replace(/^www\./, '');

// Global + per-site enable switches, backed by storage.sync. The content
// script listens to storage.onChanged, so toggles apply without a reload.
async function initPrefs(api) {
  const storage = api.storage?.sync;
  if (!storage) return;
  const data = await Promise.resolve(
    storage.get({ cvDisabledHosts: [], cvEnabled: true }),
  ).catch(() => null);
  if (!data) return;

  const prefs     = document.getElementById('prefs');
  const globalBox = document.getElementById('global-enabled');
  const siteRow   = document.getElementById('site-row');
  const siteBox   = document.getElementById('site-enabled');
  const siteLabel = document.getElementById('site-label');
  const modeBox   = document.getElementById('auto-mode');
  prefs.hidden = false;

  const disabled = new Set((data.cvDisabledHosts || []).map(normalizeHost));
  globalBox.checked = data.cvEnabled !== false;
  modeBox.checked = data.cvMode !== 'manual';

  let host = null;
  const tabs = await Promise.resolve(
    api.tabs?.query?.({ active: true, currentWindow: true }),
  ).catch(() => null);
  const url = tabs?.[0]?.url || '';
  if (/^https?:/.test(url)) {
    try { host = normalizeHost(new URL(url).hostname); } catch {}
  }
  if (host) {
    siteRow.hidden = false;
    siteLabel.textContent = `Enabled on ${host}`;
    siteBox.checked = !disabled.has(host);
  }

  globalBox.addEventListener('change', () => {
    Promise.resolve(storage.set({ cvEnabled: globalBox.checked })).catch(() => {});
  });
  modeBox.addEventListener('change', () => {
    Promise.resolve(storage.set({ cvMode: modeBox.checked ? 'auto' : 'manual' })).catch(() => {});
  });
  siteBox.addEventListener('change', async () => {
    // Re-read before writing: `disabled` is a snapshot from popup-open time and
    // another tab or synced device may have edited the list since.
    const fresh = await Promise.resolve(
      storage.get({ cvDisabledHosts: [] }),
    ).catch(() => null);
    const current = new Set(
      (fresh?.cvDisabledHosts ?? [...disabled]).map(normalizeHost),
    );
    if (siteBox.checked) current.delete(host); else current.add(host);
    disabled.clear();
    current.forEach(h => disabled.add(h));
    Promise.resolve(storage.set({ cvDisabledHosts: [...current] })).catch(() => {});
  });
}

// Fast mode (TypeSafe Jev). The key and the on/off flag live in storage.local
// — never synced. Enabling needs the api.typesafe.ai host permission, which
// must be requested straight from the click (user gesture), and a key that
// passes a live test call; jev.js in the background does the actual requests.
const JEV_ORIGINS = ['https://api.typesafe.ai/*'];
let onFastModeChange = null;

function setCloudBadge(on) {
  const mark = document.getElementById('private-mark');
  mark.textContent = on ? 'Fast mode' : 'On-device';
  mark.title = on
    ? 'Tone checks use TypeSafe Jev (cloud); writing actions stay on this device'
    : 'Your comments stay on this device';
  mark.classList.toggle('private-mark--cloud', on);
  onFastModeChange?.(on);
  const line = document.getElementById('privacy-line');
  if (!line) return;
  line.dataset.local ??= line.textContent;
  line.textContent = on
    ? line.dataset.cloud || 'Fast mode sends the text being checked to TypeSafe; writing actions stay on this device.'
    : line.dataset.local;
}

async function initCloud(api) {
  const local = api.storage?.local;
  if (!local || !api.permissions?.request) return null;
  const section = document.getElementById('cloud');
  const toggle  = document.getElementById('jev-enabled');
  const config  = document.getElementById('jev-config');
  const keyBox  = document.getElementById('jev-key');
  const save    = document.getElementById('jev-save');
  const status  = document.getElementById('jev-status');
  section.hidden = false;

  const data = await Promise.resolve(local.get({ cvJevEnabled: false, cvJevKey: '' })).catch(() => null);
  const permitted = await Promise.resolve(api.permissions.contains({ origins: JEV_ORIGINS })).catch(() => false);
  const enabled = data?.cvJevEnabled === true && permitted;
  toggle.checked = enabled;
  config.hidden = !enabled;
  if (data?.cvJevKey) keyBox.placeholder = 'Key saved — paste to replace';
  setCloudBadge(enabled);

  const say = (kind, text) => {
    status.className = `cloud-status${kind ? ` cloud-status--${kind}` : ''}`;
    status.textContent = text;
  };

  const test = async apiKey => {
    save.disabled = true;
    say('', 'Testing…');
    const result = await Promise.resolve(api.runtime.sendMessage({ type: 'cv-jev-test', apiKey }))
      .catch(error => ({ ok: false, error: error?.message }));
    save.disabled = false;
    if (!result?.ok) {
      say('err', result?.error || 'Test failed');
      return false;
    }
    say('ok', `Connected · answered in ${result.ms} ms`);
    return true;
  };

  toggle.addEventListener('change', async () => {
    if (!toggle.checked) {
      config.hidden = true;
      Promise.resolve(local.set({ cvJevEnabled: false })).catch(() => {});
      setCloudBadge(false);
      return;
    }
    const granted = await Promise.resolve(api.permissions.request({ origins: JEV_ORIGINS })).catch(() => false);
    if (!granted) {
      toggle.checked = false;
      return;
    }
    config.hidden = false;
    const saved = await Promise.resolve(local.get({ cvJevKey: '' })).catch(() => null);
    if (!saved?.cvJevKey) {
      say('', 'Paste your TypeSafe API key to finish.');
      keyBox.focus();
      return;
    }
    if (await test('')) {
      await Promise.resolve(local.set({ cvJevEnabled: true })).catch(() => {});
      setCloudBadge(true);
    }
  });

  save.addEventListener('click', async () => {
    const apiKey = keyBox.value.trim();
    if (!apiKey && keyBox.placeholder.startsWith('Paste your')) {
      say('err', 'Paste a key first.');
      return;
    }
    if (!await test(apiKey)) return;
    const update = { cvJevEnabled: true };
    if (apiKey) update.cvJevKey = apiKey;
    await Promise.resolve(local.set(update)).catch(() => {});
    keyBox.value = '';
    keyBox.placeholder = 'Key saved — paste to replace';
    toggle.checked = true;
    setCloudBadge(true);
  });

  return enabled;
}

// The download state gets a real action instead of instructions: create() is
// what triggers the model fetch, and monitor() reports progress on builds that
// support it. The popup closes on any outside click while Chrome keeps
// downloading, so on reopen an in-progress download reattaches to its progress.
function wireDownload(els, inProgress) {
  const button   = document.getElementById('dl-start');
  const progress = document.getElementById('dl-progress');
  const factory  = typeof LanguageModel !== 'undefined' ? LanguageModel : window.ai?.languageModel;

  const start = async fromClick => {
    button.disabled = true;
    progress.hidden = false;
    progress.textContent = fromClick ? 'Starting download…' : 'Download in progress…';
    const monitor = m => m.addEventListener('downloadprogress', e => {
      progress.textContent = `Downloading model… ${Math.round((e.loaded || 0) * 100)}%`;
    });
    try {
      let session;
      try {
        session = await factory.create({ ...LANG_OPTS, monitor });
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        session = await factory.create(LANG_OPTS);
      }
      session.destroy?.();
      document.getElementById('setup-download').classList.remove('visible');
      setStatus(els, 'ok', 'Chrome AI ready ✓');
    } catch (error) {
      button.disabled = false;
      // Without a click Chrome may refuse create() (user activation).
      if (!fromClick && error?.name === 'NotAllowedError') {
        progress.textContent = 'Chrome is downloading the model in the background. You can close this popup.';
        return;
      }
      progress.textContent = `Download failed: ${error?.message || 'unknown error'}. Try again later.`;
    }
  };

  button.addEventListener('click', () => start(true));
  if (inProgress) {
    button.textContent = 'Show progress';
    start(false);
  }
}

async function initFirefoxPopup(els, fastMode) {
  document.getElementById('info').innerHTML =
    "Comment Vibe uses <strong>Firefox's on-device AI runtime</strong> to classify " +
    'the tone of your comments in real time — <span id="privacy-line" ' +
    'data-cloud="except in Fast mode, which sends the text being checked to TypeSafe.">' +
    'completely on-device, no data sent anywhere.</span> ' +
    "Unlike Chrome's generative Gemini Nano, Firefox's AI API is a <em>classifier</em>: " +
    'it judges tone in ~100 languages but cannot write rewrite suggestions — those are ' +
    'Chrome-only for now. ' +
    '<a href="https://dzienko.dev/comment-vibe/#browsers" target="_blank" rel="noopener">Full comparison ↗</a>';

  const granted = await browser.permissions
    .contains({ permissions: ['trialML'] })
    .catch(() => false);

  setCloudBadge(fastMode);
  if (granted) {
    setStatus(els, 'ok', 'Firefox AI ready ✓');
    return;
  }

  onFastModeChange = on => setStatus(els, on ? 'ok' : 'err', on ? 'Fast mode ready ✓' : 'On-device AI not enabled');
  onFastModeChange(fastMode);
  const setupFf  = document.getElementById('setup-firefox');
  const enable   = document.getElementById('ff-enable');
  const progress = document.getElementById('ff-progress');
  setupFf.classList.add('visible');

  browser.runtime.onMessage.addListener(message => {
    if (message?.type !== 'cv-progress') return;
    const pct = progressPercent(message.data);
    progress.textContent = pct === null ? 'Downloading model…' : `Downloading model… ${pct}%`;
  });

  enable.addEventListener('click', async () => {
    // must be called directly from the click handler (user gesture)
    const ok = await browser.permissions.request({ permissions: ['trialML'] }).catch(() => false);
    if (!ok) return;

    enable.disabled = true;
    progress.hidden = false;
    progress.textContent = 'Preparing model…';
    setStatus(els, 'checking', 'Setting up on-device AI…');

    const result = await browser.runtime
      .sendMessage({ type: 'cv-warmup' })
      .catch(error => ({ ok: false, error: error?.message }));

    if (result?.ok) {
      setupFf.classList.remove('visible');
      onFastModeChange = null;
      setStatus(els, 'ok', 'Firefox AI ready ✓');
    } else {
      enable.disabled = false;
      progress.textContent = `Setup failed: ${result?.error || 'unknown error'}. ` +
        'Check the about:config flags below and try again.';
      setStatus(els, 'err', 'On-device AI not available');
    }
  });
}

(async () => {
  const els = {
    statusEl:  document.getElementById('status'),
    statusTxt: document.getElementById('status-text'),
  };

  const api = getExtApi();
  document.getElementById('rate-link').href = storeUrl();
  let fastMode = false;
  if (api) {
    initPrefs(api);
    fastMode = await initCloud(api).catch(() => null);
    const version = api.runtime.getManifest?.().version;
    if (version) document.getElementById('version').textContent = ` · v${version}`;
  }

  if (hasChromeAI()) {
    const status = await chromeAIStatus();
    if (status === 'available') {
      setStatus(els, 'ok', 'Chrome AI ready ✓');
    } else if (status === 'downloadable' || status === 'downloading') {
      const inProgress = status === 'downloading';
      setStatus(els, 'checking', inProgress ? 'AI model downloading…' : 'AI model not downloaded yet');
      document.getElementById('setup-download').classList.add('visible');
      wireDownload(els, inProgress);
    } else {
      onFastModeChange = on => setStatus(els, on ? 'ok' : 'err', on ? 'Fast mode ready ✓' : 'Chrome AI not available');
      onFastModeChange(fastMode);
      document.getElementById('setup').classList.add('visible');
    }
    return;
  }

  if (isFirefox()) {
    await initFirefoxPopup(els, fastMode === true);
    return;
  }

  onFastModeChange = on => setStatus(els, on ? 'ok' : 'err', on ? 'Fast mode ready ✓' : 'Chrome AI not available');
  onFastModeChange(fastMode);
  document.getElementById('setup').classList.add('visible');
})();
