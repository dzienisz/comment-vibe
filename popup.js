'use strict';

const LANG_OPTS = {
  expectedInputs:  [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

async function checkChromeAI() {
  try {
    if (typeof LanguageModel !== 'undefined') {
      // Pass language options to satisfy the API requirement;
      // fall back without them for older Chrome builds that reject the options.
      let avail = await LanguageModel.availability(LANG_OPTS);
      if (avail === 'unavailable') avail = await LanguageModel.availability();
      return avail !== 'unavailable';
    }
    if (window.ai?.languageModel) {
      const { available } = await window.ai.languageModel.capabilities();
      return available !== 'no';
    }
  } catch {}
  return false;
}

function hasChromeAI() {
  return typeof LanguageModel !== 'undefined' || !!window.ai?.languageModel;
}

function isFirefox() {
  return typeof browser !== 'undefined' && !!browser.permissions;
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

async function initFirefoxPopup(els) {
  document.getElementById('info').innerHTML =
    "Comment Vibe uses <strong>Firefox's on-device AI runtime</strong> to classify " +
    'the tone of your comments in real time — completely on-device, no data sent anywhere.';

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

  if (hasChromeAI()) {
    const available = await checkChromeAI();
    if (available) {
      setStatus(els, 'ok', 'Chrome AI ready ✓');
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
