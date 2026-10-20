'use strict';

// The toolbar button opens the playground page. Switching tasks reloads the
// extension (Firefox allows one trial.ml engine per extension run), so the page
// leaves the task to reopen in storage and this script opens it on startup.

function openPlayground(hash = '') {
  return browser.tabs.create({ url: browser.runtime.getURL(`index.html${hash}`) });
}

browser.action.onClicked.addListener(() => openPlayground());

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') openPlayground();
});

(async () => {
  const { reopen } = await browser.storage.local.get('reopen');
  if (typeof reopen !== 'string') return;
  await browser.storage.local.remove('reopen');
  openPlayground(reopen);
})();
