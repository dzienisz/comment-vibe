'use strict';

const LANG_OPTS = {
  expectedInputs:  [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

async function checkAI() {
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

(async () => {
  const statusEl  = document.getElementById('status');
  const statusTxt = document.getElementById('status-text');
  const setupEl   = document.getElementById('setup');

  const available = await checkAI();

  if (available) {
    statusEl.className  = 'status status--ok';
    statusTxt.textContent = 'Chrome AI ready ✓';
  } else {
    statusEl.className  = 'status status--err';
    statusTxt.textContent = 'Chrome AI not available';
    setupEl.classList.add('visible');
  }
})();
