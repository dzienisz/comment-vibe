'use strict';

const LANG_OPTS = {
  expectedInputs:  [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

// 'available' | 'downloading' | 'unavailable' — the middle state matters:
// telling a user whose model is still downloading that the AI is "not
// available" sends them chasing flags that no longer exist on Chrome 138+.
async function chromeAIStatus() {
  try {
    if (typeof LanguageModel !== 'undefined') {
      // Pass language options to satisfy the API requirement;
      // fall back without them for older Chrome builds that reject the options.
      let avail = await LanguageModel.availability(LANG_OPTS);
      if (avail === 'unavailable') avail = await LanguageModel.availability();
      if (avail === 'unavailable') return 'unavailable';
      return avail === 'available' ? 'available' : 'downloading';
    }
    if (window.ai?.languageModel) {
      const { available } = await window.ai.languageModel.capabilities();
      if (available === 'no') return 'unavailable';
      return available === 'readily' ? 'available' : 'downloading';
    }
  } catch {}
  return 'unavailable';
}

function hasChromeAI() {
  return typeof LanguageModel !== 'undefined' || !!window.ai?.languageModel;
}

function isFirefox() {
  return typeof browser !== 'undefined' && !!browser.permissions;
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
  prefs.hidden = false;

  const disabled = new Set((data.cvDisabledHosts || []).map(normalizeHost));
  globalBox.checked = data.cvEnabled !== false;

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

// The download state gets a real action instead of instructions: create() is
// what triggers the model fetch, and monitor() reports progress on builds that
// support it.
function wireDownload(els) {
  const button   = document.getElementById('dl-start');
  const progress = document.getElementById('dl-progress');
  button.addEventListener('click', async () => {
    button.disabled = true;
    progress.hidden = false;
    progress.textContent = 'Starting download…';
    const monitor = m => m.addEventListener('downloadprogress', e => {
      progress.textContent = `Downloading model… ${Math.round((e.loaded || 0) * 100)}%`;
    });
    try {
      let session;
      try {
        session = await LanguageModel.create({ ...LANG_OPTS, monitor });
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        session = await LanguageModel.create(LANG_OPTS);
      }
      session.destroy?.();
      document.getElementById('setup-download').classList.remove('visible');
      setStatus(els, 'ok', 'Chrome AI ready ✓');
    } catch (error) {
      button.disabled = false;
      progress.textContent = `Download failed: ${error?.message || 'unknown error'}. Try again later.`;
    }
  });
}

async function initFirefoxPopup(els) {
  document.getElementById('info').innerHTML =
    "Comment Vibe uses <strong>Firefox's on-device AI runtime</strong> to classify " +
    'the tone of your comments in real time — completely on-device, no data sent anywhere. ' +
    "Unlike Chrome's generative Gemini Nano, Firefox's AI API is a <em>classifier</em>: " +
    'it judges tone in ~100 languages but cannot write rewrite suggestions — those are ' +
    'Chrome-only for now. ' +
    '<a href="https://dzienko.dev/comment-vibe/#browsers" target="_blank" rel="noopener">Full comparison ↗</a>';

  const granted = await browser.permissions
    .contains({ permissions: ['trialML'] })
    .catch(() => false);

  if (granted) {
    setStatus(els, 'ok', 'Firefox AI ready ✓');
    return;
  }

  setStatus(els, 'err', 'On-device AI not enabled');
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
  if (api) {
    initPrefs(api);
    const version = api.runtime.getManifest?.().version;
    if (version) document.getElementById('version').textContent = ` · v${version}`;
  }

  if (hasChromeAI()) {
    const status = await chromeAIStatus();
    if (status === 'available') {
      setStatus(els, 'ok', 'Chrome AI ready ✓');
    } else if (status === 'downloading') {
      setStatus(els, 'checking', 'AI model not downloaded yet');
      document.getElementById('setup-download').classList.add('visible');
      wireDownload(els);
    } else {
      setStatus(els, 'err', 'Chrome AI not available');
      document.getElementById('setup').classList.add('visible');
    }
    return;
  }

  if (isFirefox()) {
    await initFirefoxPopup(els);
    return;
  }

  setStatus(els, 'err', 'Chrome AI not available');
  document.getElementById('setup').classList.add('visible');
})();
