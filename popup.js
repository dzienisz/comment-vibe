'use strict';

const LANG_OPTS = {
  expectedInputs:  [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

async function getModelStatus() {
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

(async () => {
  const statusEl  = document.getElementById('status');
  const statusTxt = document.getElementById('status-text');
  const setupEl   = document.getElementById('setup');

  const status = await getModelStatus();

  if (status === 'available') {
    statusEl.className    = 'status status--ok';
    statusTxt.textContent = 'Chrome AI ready ✓';
  } else if (status === 'downloading') {
    statusEl.className    = 'status status--checking';
    statusTxt.textContent = 'Preparing AI model…';
  } else {
    statusEl.className    = 'status status--err';
    statusTxt.textContent = 'Chrome AI not available';
    setupEl.classList.add('visible');
  }
})();
