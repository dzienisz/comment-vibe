'use strict';

// Strona rozszerzenia — tylko tu (i w skryptach tła) działa browser.trial.ml.
// Firefox trzyma jeden silnik na uruchomienie rozszerzenia i nie pozwala go
// zamknąć, więc aktywny silnik zapisujemy w storage.session (czyszczone przy
// przeładowaniu rozszerzenia, tak jak silnik), a zmiana zadania przeładowuje
// rozszerzenie i otwiera stronę na nowym zadaniu.

const REPO_URL = 'https://github.com/dzienisz/comment-vibe/tree/main/playground-firefox';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

const LOG_BADGE = 'background:#e66000;color:#fff;padding:1px 6px;border-radius:4px;font-weight:700';
function mlLog(msg, extra) {
  if (extra !== undefined) console.log('%c[trial.ml]%c ' + msg, LOG_BADGE, 'color:#e66000', extra);
  else console.log('%c[trial.ml]%c ' + msg, LOG_BADGE, 'color:#e66000');
}

// ── Stan API i silnika ────────────────────────────────────────────────────────

const memoryStore = {};
const sessionStore = () => globalThis.browser?.storage?.session;

async function getActiveEngine() {
  const store = sessionStore();
  if (!store) return memoryStore.engine ?? null;
  return (await store.get('engine')).engine ?? null;
}

async function setActiveEngine(key) {
  const store = sessionStore();
  if (!store) memoryStore.engine = key;
  else await store.set({ engine: key });
}

function hasRuntime() {
  return typeof browser !== 'undefined' && !!browser.permissions;
}

async function hasPermission() {
  if (!hasRuntime()) return false;
  try { return await browser.permissions.contains({ permissions: ['trialML'] }); }
  catch { return false; }
}

async function apiState() {
  if (!hasRuntime()) return 'no-extension';
  if (!await hasPermission()) return 'no-permission';
  if (!browser.trial?.ml) return 'no-api';
  return 'ready';
}

const STATE_META = {
  'no-extension':  { label: '🚫 To nie jest strona rozszerzenia Firefox', cls: 'av-no' },
  'no-permission': { label: '🔒 Brak uprawnienia trialML', cls: 'av-dl' },
  'no-api':        { label: '🚫 Brak browser.trial.ml w tej przeglądarce', cls: 'av-no' },
  'ready':         { label: '✅ browser.trial.ml dostępne', cls: 'av-ok' },
};

function statePill(state) {
  const meta = STATE_META[state];
  return el('span', { class: `pill ${meta.cls}`, text: meta.label });
}

async function requestPermission() {
  const granted = await browser.permissions.request({ permissions: ['trialML'] });
  mlLog(`uprawnienie trialML: ${granted ? 'przyznane' : 'odrzucone'}`);
  // browser.trial pojawia się dopiero po przyznaniu — odśwież widok.
  if (granted) route();
}

let progressListener = null;
function onProgress(listener) {
  progressListener = listener;
}

let progressWired = false;
function wireProgress() {
  if (progressWired || !browser.trial?.ml) return;
  progressWired = true;
  browser.trial.ml.onProgress.addListener(data => progressListener?.(data));
}

// Zwraca 'ready', gdy silnik pasuje do zadania, albo 'switch', gdy trzeba przeładować.
async function ensureEngine(options, report) {
  const active = await getActiveEngine();
  const key = engineKey(options);
  if (active === key) return 'ready';
  if (active) return 'switch';
  wireProgress();
  report.status('Tworzę silnik — pierwsze uruchomienie pobiera model');
  try {
    await browser.trial.ml.createEngine(options);
  } catch (e) {
    if (isAlreadyCreated(e)) return 'switch';
    throw e;
  }
  await setActiveEngine(key);
  return 'ready';
}

async function switchTask(hash) {
  await browser.storage.local.set({ reopen: hash });
  mlLog('przeładowuję rozszerzenie, żeby utworzyć nowy silnik');
  browser.runtime.reload();
}

// ── Menu ─────────────────────────────────────────────────────────────────────

function buildSidebar() {
  const nav = document.getElementById('nav');
  nav.appendChild(navItem('overview', 'Przegląd'));
  for (const task of TASKS) nav.appendChild(navItem(task.id, task.name));
  document.getElementById('sidebar-foot').appendChild(el('div', { class: 'foot-note', html:
    `Część projektu <strong>Comment Vibe</strong> · stan na ${FIREFOX_INFO.verifiedAt} · ` +
    `Firefox ${FIREFOX_INFO.release} · <a href="${REPO_URL}" target="_blank" rel="noopener">kod</a>` }));
}

function navItem(id, label) {
  return el('a', { class: 'nav-item', href: `#${id}`, 'data-id': id }, [
    el('span', { class: 'dot st-ot' }), el('span', { text: label }),
  ]);
}

function setActive(id) {
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.id === id));
}

// ── Przegląd ─────────────────────────────────────────────────────────────────

async function renderOverview(main) {
  main.appendChild(el('h1', { text: 'Firefox AI — środowisko testowe' }));
  main.appendChild(el('p', { class: 'lead', html:
    `Firefox nie udostępnia stronom <code>LanguageModel</code>, <code>Translator</code> ani <code>Summarizer</code>.
     Lokalne AI jest dostępne tylko dla rozszerzeń: <code>browser.trial.ml</code> (Firefox 134+) uruchamia
     potoki <strong>Transformers.js</strong> w osobnym procesie, na Twoim urządzeniu. To nie jest czat — każde
     zadanie ma swój mały model. Stan dokumentacji: <strong>${FIREFOX_INFO.verifiedAt}</strong>,
     Firefox ${FIREFOX_INFO.release} (Beta ${FIREFOX_INFO.beta}, Nightly ${FIREFOX_INFO.nightly}, ESR ${FIREFOX_INFO.esr}).` }));

  const env = el('div', { class: 'card' });
  env.appendChild(el('h2', { text: 'Twoje środowisko' }));
  const ua = navigator.userAgent.match(/Firefox\/(\d+)/);
  env.appendChild(infoRow('Wersja Firefoksa z User-Agent', ua ? ua[1] : 'nie wykryto'));
  const stateCell = el('span', { class: 'info-value' }, el('span', { class: 'pill av-pending', text: '… sprawdzam' }));
  env.appendChild(el('div', { class: 'info-row' }, [el('span', { class: 'info-label', text: 'browser.trial.ml' }), stateCell]));
  const engineCell = el('span', { class: 'info-value', text: '…' });
  env.appendChild(el('div', { class: 'info-row' }, [el('span', { class: 'info-label', text: 'Aktywny silnik' }), engineCell]));
  const actions = el('div', { class: 'demo-actions' });
  env.appendChild(actions);
  main.appendChild(env);

  const state = await apiState();
  stateCell.innerHTML = '';
  stateCell.appendChild(statePill(state));
  const active = await getActiveEngine();
  engineCell.textContent = active ? active.replace('|', ' · ') : 'brak — powstanie przy pierwszym demo';
  if (state === 'no-permission') {
    actions.appendChild(el('button', { class: 'btn primary', id: 'grant', text: 'Przyznaj uprawnienie trialML', onclick: requestPermission }));
  }
  if (state === 'ready') {
    const out = el('span', { class: 'demo-status' });
    actions.appendChild(el('button', { class: 'btn ghost', id: 'delete-models', text: 'Usuń pobrane modele', onclick: async () => {
      try { await browser.trial.ml.deleteCachedModels(); out.textContent = 'Usunięto modele tego rozszerzenia.'; }
      catch (e) { out.textContent = `Błąd: ${e.message}`; }
    }}));
    actions.appendChild(out);
  }

  const setup = el('div', { class: 'card' });
  setup.appendChild(el('h2', { text: 'Gdy API nie działa' }));
  setup.appendChild(el('ul', { class: 'tips' }, [
    el('li', { html: '<strong>Firefox 148+:</strong> jeśli w Ustawieniach → <em>AI controls</em> zablokowano funkcje AI, odblokuj je. ' +
      'Blokada wyłącza też <code>extensions.ml.enabled</code> i API zwraca „Trial ML API is disabled”. Rozszerzenie nie może otworzyć tej strony samo.' }),
    el('li', { html: '<strong>Firefox 134–139:</strong> ustaw <code>browser.ml.enable</code> i <code>extensions.ml.enabled</code> na <em>true</em> w <code>about:config</code> (od Firefoksa 140 domyślnie włączone).' }),
    el('li', { html: 'Uprawnienie <code>trialML</code> jest opcjonalne — przyznaje się je kliknięciem, a <code>browser.trial</code> pojawia się dopiero po przyznaniu.' }),
  ]));
  main.appendChild(setup);

  const limits = el('div', { class: 'card' });
  limits.appendChild(el('h2', { text: 'Ograniczenia trial API' }));
  limits.appendChild(el('ul', { class: 'tips' }, [
    el('li', { html: '<strong>Jeden silnik na uruchomienie rozszerzenia.</strong> Drugie <code>createEngine</code> rzuca „Engine already created” i nie ma metody zamknięcia silnika — dlatego zmiana zadania tutaj przeładowuje rozszerzenie.' }),
    el('li', { html: 'Modele tylko z huba Mozilli albo z organizacji <strong>Mozilla</strong> i <strong>Xenova</strong> na Hugging Face.' }),
    el('li', { html: 'Bez równoległych uruchomień i bez strumieniowania; przy braku pamięci Firefox może usunąć silnik.' }),
    el('li', { html: 'Modele są w pamięci podręcznej rozszerzenia i znikają przy jego odinstalowaniu.' }),
    el('li', { html: 'API jest eksperymentalne — sprawdzaj obecność metod zamiast numeru wersji.' }),
  ]));
  main.appendChild(limits);

  main.appendChild(el('p', { class: 'muted', html:
    `Źródła: <a target="_blank" rel="noopener" href="${FIREFOX_INFO.docs}">WebExtensions AI API</a> · ` +
    `<a target="_blank" rel="noopener" href="${FIREFOX_INFO.examples}">przykłady firefox-ai</a> · ` +
    `<a target="_blank" rel="noopener" href="https://dzienko.dev/comment-vibe/playground/#firefox">playground Chrome i stan API w Firefoksie</a>` }));
}

function infoRow(label, value) {
  return el('div', { class: 'info-row' }, [el('span', { class: 'info-label', text: label }), el('span', { class: 'info-value', text: value })]);
}

// ── Zadanie ──────────────────────────────────────────────────────────────────

function formatElapsed(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

async function renderTask(main, task) {
  main.appendChild(el('div', { class: 'api-head' }, [
    el('div', {}, [el('h1', { text: task.name }), el('p', { class: 'lead', text: task.tagline })]),
    el('span', { class: 'pill st-ot big', text: 'Trial (rozszerzenia)' }),
  ]));
  main.appendChild(el('p', { class: 'code-inline', html: `taskName: <code>${task.taskName}</code>` }));

  const state = await apiState();
  if (state !== 'ready') {
    const card = el('div', { class: 'card' }, [el('h2', { text: 'Czy zadziała u Ciebie?' }), statePill(state)]);
    if (state === 'no-permission') {
      card.appendChild(el('div', { class: 'demo-actions' },
        el('button', { class: 'btn primary', id: 'grant', text: 'Przyznaj uprawnienie trialML', onclick: requestPermission })));
    }
    main.appendChild(card);
  }

  const card = el('div', { class: 'card demo' });
  card.appendChild(el('h2', { text: 'Demo na żywo' }));
  const model = el('select', { id: 'model' });
  for (const [id, label] of task.models) model.appendChild(el('option', { value: id, text: label }));
  card.appendChild(el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Model' }), model]));

  const inputs = {};
  for (const f of task.fields) {
    const control = f.type === 'textarea' ? el('textarea', { rows: String(f.rows || 3) }) : el('input', { type: 'text' });
    control.value = f.value;
    control.id = `f-${f.id}`;
    inputs[f.id] = control;
    card.appendChild(el('label', { class: 'field' }, [el('span', { class: 'field-label', text: f.label }), control]));
  }
  const values = () => Object.fromEntries(Object.entries(inputs).map(([id, c]) => [id, c.value]));

  const status = el('div', { class: 'demo-status', id: 'status' });
  const fill = el('div', { class: 'progress-fill' });
  const pctLabel = el('span', { class: 'progress-pct', text: '0%' });
  const bar = el('div', { class: 'progress-row' }, [
    el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Pobieranie modelu' }, fill), pctLabel]);
  bar.style.display = 'none';
  const output = el('pre', { class: 'demo-output', id: 'output' });
  const raw = el('pre', { id: 'raw' }, el('code'));
  const rawWrap = el('details', { class: 'raw' }, [el('summary', { text: 'Surowy wynik runEngine' }), raw]);
  rawWrap.hidden = true;
  const switchBox = el('div', { class: 'demo-actions' });

  const runBtn = el('button', { class: 'btn primary', id: 'run', text: '▶ Uruchom' });
  if (state !== 'ready') runBtn.disabled = true;
  runBtn.addEventListener('click', async () => {
    const options = engineOptions(task, model.value);
    runBtn.disabled = true;
    output.textContent = '';
    output.classList.remove('error');
    switchBox.innerHTML = '';
    rawWrap.hidden = true;
    const t0 = performance.now();
    let phase = 'Uruchamiam…';
    const tick = () => { status.textContent = `${phase} · ${formatElapsed(performance.now() - t0)}`; };
    const timer = setInterval(tick, 100);
    const report = { status: msg => { phase = msg; tick(); mlLog(msg); } };
    onProgress(data => {
      const p = progressPercent(data);
      if (p === null || p >= 100) return;
      bar.style.display = 'flex';
      fill.style.width = `${p}%`;
      pctLabel.textContent = `${p}%`;
      phase = 'Pobieram model — nie zamykaj karty';
    });
    try {
      const engine = await ensureEngine(options, report);
      if (engine === 'switch') {
        clearInterval(timer);
        status.textContent = '';
        const active = await getActiveEngine();
        output.textContent = `Silnik w tym uruchomieniu to ${active ? active.replace('|', ' · ') : 'inne zadanie'}.\n` +
          'Firefox pozwala na jeden silnik na uruchomienie rozszerzenia, więc zmiana zadania lub modelu wymaga przeładowania.';
        switchBox.appendChild(el('button', { class: 'btn primary', id: 'switch', text: '↻ Przeładuj i otwórz to zadanie',
          onclick: () => switchTask(`#${task.id}`) }));
        return;
      }
      report.status('Liczę lokalnie');
      const args = task.args(values());
      const runOptions = task.options(values());
      mlLog('runEngine', { args, options: runOptions });
      const out = await browser.trial.ml.runEngine({ args, options: runOptions });
      clearInterval(timer);
      status.textContent = `Gotowe w ${formatElapsed(performance.now() - t0)}`;
      output.textContent = task.format(out) || '(pusty wynik — zobacz surowy wynik)';
      raw.firstChild.textContent = JSON.stringify(out, null, 2)?.slice(0, 20000) ?? String(out);
      rawWrap.hidden = false;
      mlLog('wynik', out);
    } catch (e) {
      clearInterval(timer);
      status.textContent = '';
      output.classList.add('error');
      output.textContent = `Błąd: ${e?.message || e}` + (isDisabled(e)
        ? '\n\nFirefox blokuje funkcje AI: odblokuj je w Ustawieniach → AI controls (Firefox 148+). ' +
          'Na Firefoksie 134–139 ustaw browser.ml.enable i extensions.ml.enabled w about:config.'
        : '\n\nNajczęstsze przyczyny: przerwane pobieranie (uruchom ponownie), model spoza Mozilla/Xenova, brak pamięci.');
      console.error('[trial.ml] pełny błąd:', e);
    } finally {
      clearInterval(timer);
      bar.style.display = 'none';
      onProgress(null);
      runBtn.disabled = false;
    }
  });
  card.appendChild(el('div', { class: 'demo-actions' }, [runBtn, status]));
  card.appendChild(bar);
  card.appendChild(output);
  card.appendChild(switchBox);
  card.appendChild(rawWrap);
  main.appendChild(card);

  const code = el('div', { class: 'card' });
  code.appendChild(el('h2', { text: 'Użycie' }));
  const pre = el('pre', {}, el('code'));
  const refreshCode = () => { pre.firstChild.textContent = usageSnippet(task, values(), model.value); };
  refreshCode();
  model.addEventListener('change', refreshCode);
  for (const c of Object.values(inputs)) c.addEventListener('input', refreshCode);
  code.appendChild(el('div', { class: 'code-wrap' }, pre));
  main.appendChild(code);
}

// ── Routing ──────────────────────────────────────────────────────────────────

let renderId = 0;
async function route() {
  const id = (location.hash || '#overview').slice(1);
  const mine = ++renderId;
  const main = document.getElementById('main');
  const next = document.createDocumentFragment();
  const task = TASKS.find(t => t.id === id);
  setActive(task ? id : 'overview');
  if (task) await renderTask(next, task); else await renderOverview(next);
  if (mine !== renderId) return;
  main.innerHTML = '';
  main.appendChild(next);
  window.scrollTo(0, 0);
}

if (typeof document !== 'undefined') {
  buildSidebar();
  window.addEventListener('hashchange', route);
  route();
}
