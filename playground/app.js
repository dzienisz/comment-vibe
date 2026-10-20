'use strict';

// ⬇️ WAŻNE: wklej tu bezpośredni link do wtyczki Comment Vibe w Chrome Web Store.
// To jedyne miejsce — CTA w menu i na stronie głównej używają tej stałej.
const STORE_URL = 'https://chromewebstore.google.com/detail/comment-vibe/kibcnjcipaofjlbbnjdjaobbkoajiejp';
const REPO_URL  = 'https://github.com/dzienisz/comment-vibe';

// ── Małe helpery DOM ──────────────────────────────────────────────────────────

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

// ── Logi w konsoli ────────────────────────────────────────────────────────────
// DevTools nie ma panelu „które API AI wywołano", a Network jest puste (model
// liczy lokalnie). Dlatego logujemy każde wywołanie sami — wygodne do debugowania
// i pod demo na żywo. Filtruj w konsoli po „[Built-in AI]".

const LOG_BADGE = 'background:#3b6ef5;color:#fff;padding:1px 6px;border-radius:4px;font-weight:700';

function aiLog(msg, extra) {
  if (extra !== undefined) console.log('%c[Built-in AI]%c ' + msg, LOG_BADGE, 'color:#3b6ef5', extra);
  else console.log('%c[Built-in AI]%c ' + msg, LOG_BADGE, 'color:#3b6ef5');
}

// ── Live availability ─────────────────────────────────────────────────────────

async function checkApi(api, values) {
  // Wpisy informacyjne (np. WebMCP) mają własny test obecności zamiast availability().
  if (typeof api.check === 'function') {
    try { const s = await api.check(); aiLog(`${api.name}: ${s}`); return s; }
    catch (e) { console.warn(`[Built-in AI] ${api.name}.check() rzuciło:`, e); return 'error'; }
  }
  const ctor = getApi(api.globalName);
  if (!ctor) {
    aiLog(`${api.globalName}: brak tego API w przeglądarce`);
    return 'no-api';
  }
  try {
    let state;
    if (typeof ctor.availability === 'function') {
      state = await ctor.availability(getApiOptions(api, values));
    } else if (api.globalName === 'LanguageModel' && typeof ctor.capabilities === 'function') {
      const { available } = await ctor.capabilities();
      state = { readily: 'available', 'after-download': 'downloadable', no: 'unavailable' }[available];
    } else {
      return 'unknown';
    }
    aiLog(`${api.globalName}: ${state}`);
    return Object.hasOwn(AVAIL_META, state) ? state : 'unknown';
  } catch (e) {
    console.warn(`[Built-in AI] ${api.globalName}: sprawdzenie dostępności rzuciło wyjątek:`, e);
    return 'error';
  }
}

function availPill(state) {
  const meta = AVAIL_META[state] || AVAIL_META.error;
  return el('span', { class: `pill ${meta.cls}`, text: meta.label });
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

function buildSidebar() {
  const nav = document.getElementById('nav');
  nav.appendChild(navItem('overview', 'Przegląd', 'st-neutral'));
  for (const api of APIS) {
    nav.appendChild(navItem(api.id, api.name, STATUS_META[api.status].cls));
  }
  nav.appendChild(el('div', { class: 'nav-sep', text: 'Inne przeglądarki' }));
  nav.appendChild(navItem('edge', 'Microsoft Edge', 'st-neutral'));
  nav.appendChild(navItem('firefox', 'Firefox', 'st-neutral'));

  const foot = document.getElementById('sidebar-foot');
  foot.innerHTML = '';
  foot.appendChild(el('a', { class: 'cta', href: STORE_URL, target: '_blank', rel: 'noopener' }, [
    el('span', { class: 'cta-title', text: '⬇️ Pobierz Comment Vibe' }),
    el('span', { class: 'cta-sub', text: 'wtyczka do Chrome — przetestuj' }),
  ]));
  foot.appendChild(el('div', { class: 'foot-note', html:
    `Część projektu <strong>Comment Vibe</strong> · stan na ${RELEASE_INFO.verifiedAt} · Chrome ${RELEASE_INFO.stable} Stable` }));
}

function navItem(id, label, dotCls) {
  return el('a', {
    class: 'nav-item',
    href: `#${id}`,
    'data-id': id,
  }, [
    el('span', { class: `dot ${dotCls}` }),
    el('span', { text: label }),
  ]);
}

function setActive(id) {
  document.querySelectorAll('.nav-item').forEach(a =>
    a.classList.toggle('active', a.dataset.id === id));
  document.querySelector('.nav-item.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ── Panel: Przegląd ─────────────────────────────────────────────────────────

function renderOverview() {
  const main = document.getElementById('main');
  main.innerHTML = '';

  main.appendChild(el('h1', { text: 'Wbudowane AI w Chrome — środowisko testowe' }));
  main.appendChild(el('p', { class: 'lead', html:
    `Dema modeli działają <strong>lokalnie</strong>, bez wysyłania tekstu na serwer.
     Generatywne API korzystają z Gemini Nano; Translator i Language Detector mają osobne modele.
     WebMCP udostępnia narzędzia agentom, a nie uruchamia lokalnego modelu.
     Wybierz API z menu po lewej, sprawdź czy działa u Ciebie i odpal demo na żywo.
     Dokumentację zweryfikowano <strong>${RELEASE_INFO.verifiedAt}</strong>:
     <strong>Chrome ${RELEASE_INFO.stable} Stable</strong>, Chrome ${RELEASE_INFO.beta} Beta.
     To datowany stan dokumentacji, nie automatycznie aktualizowany wykaz wydań.` }));
  main.appendChild(el('p', { class: 'muted', html:
    `Kolejne wydanie: Chrome ${RELEASE_INFO.beta} Stable jest <strong>planowane na ${RELEASE_INFO.nextStableDate}</strong>.
     Od Chrome 153 wydania Stable ukazują się co dwa tygodnie; Chrome ${RELEASE_INFO.beta + 1} jest w kanale Dev.
     Plan nie jest potwierdzeniem wdrożenia API — trial nie staje się stable wraz z aktualizacją przeglądarki.
     <a target="_blank" rel="noopener" href="${RELEASE_INFO.source}">Harmonogram Google</a> ·
     <a target="_blank" rel="noopener" href="${RELEASE_INFO.betaSource}">Zmiany w Beta</a> ·
     <a target="_blank" rel="noopener" href="${RELEASE_INFO.roadmap}">Bieżąca mapa wydań</a>.
     Na nowszych wersjach nadal używamy wykrywania API i ich metod, bez blokady numerem wersji.` }));

  // CTA wtyczki
  const cta = el('div', { class: 'cta-card' });
  cta.appendChild(el('div', { class: 'cta-card-text' }, [
    el('h2', { text: '🧩 Comment Vibe — wtyczka do Chrome' }),
    el('p', { class: 'cta-card-sub', text:
      'Sprawdza ton Twojego komentarza, zanim go wyślesz — lokalnie, na Gemini Nano. ' +
      'To dokładnie to samo API, które testujesz tutaj.' }),
  ]));
  cta.appendChild(el('div', { class: 'cta-actions' }, [
    el('a', { class: 'btn-primary-link', href: STORE_URL, target: '_blank', rel: 'noopener', text: '⬇️ Pobierz z Chrome Web Store' }),
    el('a', { class: 'btn-ghost-link', href: REPO_URL, target: '_blank', rel: 'noopener', text: 'Kod na GitHub' }),
  ]));
  main.appendChild(cta);

  // Środowisko
  const env = el('div', { class: 'card' });
  env.appendChild(el('h2', { text: 'Twoje środowisko' }));
  const ua = navigator.userAgent;
  const m = ua.match(/Chrome\/(\d+)/);
  const chromeVer = m ? m[1] : 'nie wykryto';
  env.appendChild(infoRow('Wersja Chromium z User-Agent (nie określa kanału)', chromeVer));
  env.appendChild(infoRow('Bezpieczny kontekst (isSecureContext)', String(window.isSecureContext)));
  env.appendChild(infoRow('Origin', location.origin || '(file://)'));
  if (!window.isSecureContext) {
    env.appendChild(el('p', { class: 'warn', html:
      'Te API wymagają bezpiecznego kontekstu. Otwórz stronę przez HTTPS lub <code>http://localhost</code> ' +
      '(np. <code>python3 -m http.server</code>). Sam bezpieczny kontekst nie gwarantuje dostępności API.' }));
  }
  env.appendChild(el('p', { class: 'muted', html:
    'Modele są pobierane osobno. Pierwsze użycie może wymagać pobrania danych i aktywacji przez użytkownika; ' +
    'samo sprawdzenie dostępności nie uruchamia pobierania. Wymagania zależą od API, sprzętu, języka i polityk przeglądarki. ' +
    'Lokalny model działa tylko przy włączonym <em>On-device AI</em> w <code>chrome://settings/ai</code> ' +
    '(Chrome 152+; wcześniej <code>chrome://settings/system</code>). Stable ma go domyślnie włączonego, ' +
    'nowe profile Beta, Dev i Canary od Chrome 157 — wyłączonego; wyłączenie usuwa pobrany model. ' +
    'Szczegóły modelu: <code>chrome://on-device-internals</code> (strona debugowania — najpierw włącz ją w <code>chrome://chrome-urls</code>). ' +
    '<a target="_blank" rel="noopener" href="https://developer.chrome.com/docs/ai/get-started">Aktualne wymagania Google</a>.' }));
  main.appendChild(env);

  // Macierz dostępności
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Dostępność API u Ciebie' }));
  const table = el('table', { class: 'matrix' });
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', { text: 'API' }),
    el('th', { text: 'Status (dokumentacja)' }),
    el('th', { text: 'Twoja przeglądarka' }),
  ])));
  const tbody = el('tbody');
  for (const api of APIS) {
    const cell = el('td', {}, el('span', { class: 'pill av-pending', text: '… sprawdzam' }));
    tbody.appendChild(el('tr', {}, [
      el('td', {}, el('a', { href: `#${api.id}`, text: api.name })),
      el('td', {}, el('span', { class: `pill ${STATUS_META[api.status].cls}`, text: STATUS_META[api.status].label })),
      cell,
    ]));
    checkApi(api).then(state => { cell.innerHTML = ''; cell.appendChild(availPill(state)); });
  }
  table.appendChild(tbody);
  card.appendChild(el('div', { class: 'table-wrap' }, table));
  main.appendChild(card);

  main.appendChild(renderResources());

  main.appendChild(el('p', { class: 'muted', html:
    'Źródła: ' +
    '<a target="_blank" rel="noopener" href="https://developer.chrome.com/docs/ai/built-in-apis">Built-in AI APIs</a> · ' +
    '<a target="_blank" rel="noopener" href="https://developer.chrome.com/docs/ai/get-started">Get started</a>' }));
}

function renderResources() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Zasoby' }));
  for (const { group, items } of RESOURCES) {
    card.appendChild(el('h3', { class: 'res-group', text: group }));
    const list = el('ul', { class: 'resources' });
    for (const r of items) {
      list.appendChild(el('li', {}, [
        el('a', { href: r.url, target: '_blank', rel: 'noopener', text: r.label }),
        el('span', { class: 'muted', text: ` — ${r.note}` }),
      ]));
    }
    card.appendChild(list);
  }
  return card;
}

function infoRow(label, value) {
  return el('div', { class: 'info-row' }, [
    el('span', { class: 'info-label', text: label }),
    el('span', { class: 'info-value', text: value }),
  ]);
}

// ── Panel: Firefox ──────────────────────────────────────────────────────────

function isFirefox() {
  return /Firefox\//.test(globalThis.navigator?.userAgent || '');
}

function renderFirefox() {
  const main = document.getElementById('main');
  main.innerHTML = '';
  const fx = FIREFOX_STATUS;

  main.appendChild(el('h1', { text: 'Firefox — lokalne AI' }));
  main.appendChild(el('p', { class: 'lead', html:
    `Firefox <strong>nie udostępnia stronom</strong> żadnego z API z tego środowiska, więc dema obok pokażą tam
     „brak API”. Lokalne AI w Firefoksie jest <strong>tylko dla rozszerzeń</strong>: <code>browser.trial.ml</code>
     (Firefox 134+) uruchamia modele Transformers.js na urządzeniu. Stan na <strong>${fx.verifiedAt}</strong>:
     Firefox ${fx.release}, Beta ${fx.beta}, Nightly ${fx.nightly}, ESR ${fx.esr}.` }));

  const web = el('div', { class: 'card' });
  web.appendChild(el('h2', { text: 'API stron WWW w Firefoksie' }));
  const table = el('table', { class: 'matrix' });
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', { text: 'API' }), el('th', { text: 'W Firefoksie' }), el('th', { text: 'Stanowisko' }),
  ])));
  const tbody = el('tbody');
  for (const row of fx.webApis) {
    const meta = POSITION_META[row.position];
    tbody.appendChild(el('tr', {}, [
      el('td', { text: row.api }),
      el('td', {}, el('span', { class: 'pill av-no', text: '🚫 Brak' })),
      el('td', {}, el('a', { href: `https://github.com/mozilla/standards-positions/issues/${row.issue}`,
        target: '_blank', rel: 'noopener' }, el('span', { class: `pill ${meta.cls}`, text: meta.label }))),
    ]));
  }
  table.appendChild(tbody);
  web.appendChild(el('div', { class: 'table-wrap' }, table));
  main.appendChild(web);

  const ext = el('div', { class: 'card' });
  ext.appendChild(el('h2', { text: 'API rozszerzeń: browser.trial.ml' }));
  ext.appendChild(el('p', { html:
    'Każde zadanie ma własny mały model, a nie jeden czat. Dozwolone są modele z huba Mozilli oraz z organizacji ' +
    '<strong>Mozilla</strong> i <strong>Xenova</strong> na Hugging Face. Rozszerzenie prosi o opcjonalne uprawnienie ' +
    '<code>trialML</code>, ma jeden silnik naraz i nie może go zamknąć bez przeładowania. Comment Vibe w Firefoksie używa ' +
    'zadania <code>zero-shot-classification</code>.' }));
  ext.appendChild(el('p', { class: 'muted', text: `Zadania (taskName): ${fx.tasks.join(', ')}.` }));
  ext.appendChild(el('div', { class: 'code-wrap' }, el('pre', {}, el('code', { text:
`await browser.permissions.request({ permissions: ['trialML'] });
await browser.trial.ml.createEngine({ taskName: 'summarization', modelHub: 'huggingface' });
const [{ summary_text }] = await browser.trial.ml.runEngine({ args: [text] });` }))));
  main.appendChild(ext);

  const pg = el('div', { class: 'card' });
  pg.appendChild(el('h2', { text: 'Firefox AI Playground — dema na żywo' }));
  pg.appendChild(el('ol', { class: 'links' }, [
    el('li', { html: `Pobierz folder <a target="_blank" rel="noopener" href="${fx.playgroundUrl}"><code>playground-firefox/</code></a> z repozytorium.` }),
    el('li', { html: 'Otwórz <code>about:debugging#/runtime/this-firefox</code> → <em>Load Temporary Add-on…</em> i wybierz <code>playground-firefox/manifest.json</code>.' }),
    el('li', { html: 'Kliknij ikonę rozszerzenia, przyznaj <code>trialML</code> i uruchom demo — pierwsze uruchomienie pobiera model.' }),
  ]));
  main.appendChild(pg);

  const setup = el('div', { class: 'card' });
  setup.appendChild(el('h2', { text: 'Gdy API jest wyłączone' }));
  setup.appendChild(el('ul', { class: 'tips' }, [
    el('li', { html: '<strong>Firefox 148+:</strong> blokada w Ustawieniach → <em>AI controls</em> wyłącza też <code>extensions.ml.enabled</code>; API zwraca wtedy „Trial ML API is disabled”.' }),
    el('li', { html: '<strong>Firefox 134–139:</strong> ustaw <code>browser.ml.enable</code> i <code>extensions.ml.enabled</code> na <em>true</em> w <code>about:config</code> (od 140 domyślnie włączone).' }),
  ]));
  main.appendChild(setup);

  main.appendChild(el('p', { class: 'muted', html:
    `Źródła: <a target="_blank" rel="noopener" href="${fx.docs}">WebExtensions AI API</a> · ` +
    '<a target="_blank" rel="noopener" href="https://github.com/mozilla/standards-positions">Mozilla standards positions</a> · ' +
    '<a target="_blank" rel="noopener" href="https://github.com/mdn/browser-compat-data">MDN browser-compat-data</a>' }));
}

// ── Panel: Edge ─────────────────────────────────────────────────────────────

function isEdge() {
  const brands = globalThis.navigator?.userAgentData?.brands || [];
  return brands.some(b => b.brand === 'Microsoft Edge') || /\bEdg\//.test(globalThis.navigator?.userAgent || '');
}

function renderEdge() {
  const main = document.getElementById('main');
  main.innerHTML = '';
  const edge = EDGE_STATUS;
  const docUrl = slug => `https://learn.microsoft.com/microsoft-edge/web-platform/${slug}`;

  main.appendChild(el('h1', { text: 'Microsoft Edge — wbudowane AI' }));
  main.appendChild(el('p', { class: 'lead', html:
    `Edge ma <strong>te same API</strong> co Chrome (<code>LanguageModel</code>, <code>Translator</code>…), ale z innymi
     modelami (Phi-4-mini lub Aion-1.0-Instruct zamiast Gemini Nano) i innym stanem wdrożenia. Dema w tym środowisku
     działają w Edge, gdy dane API jest włączone. Stan na <strong>${edge.verifiedAt}</strong>: Edge ${edge.stable} Stable,
     ${edge.beta} Beta (Stable ${edge.nextStableDate}), ${edge.dev} Dev, ${edge.canary} Canary.` }));

  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'API w Edge' }));
  const table = el('table', { class: 'matrix' });
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', { text: 'API' }), el('th', { text: 'W Edge' }), el('th', { text: 'Szczegóły' }),
  ])));
  const tbody = el('tbody');
  for (const row of edge.apis) {
    const api = APIS.find(a => a.id === row.id);
    const meta = EDGE_STATE_META[row.state];
    const name = row.doc
      ? el('a', { href: docUrl(row.doc), target: '_blank', rel: 'noopener', text: api.name })
      : el('span', { text: api.name });
    tbody.appendChild(el('tr', {}, [
      el('td', {}, name),
      el('td', {}, el('span', { class: `pill ${meta.cls}`, text: meta.label })),
      el('td', { class: 'muted', html: row.note }),
    ]));
  }
  table.appendChild(tbody);
  card.appendChild(el('div', { class: 'table-wrap' }, table));
  main.appendChild(card);

  const setup = el('div', { class: 'card' });
  setup.appendChild(el('h2', { text: 'Jak włączyć (Canary/Dev)' }));
  setup.appendChild(el('ol', { class: 'links' }, [
    el('li', { html: `Zainstaluj <a target="_blank" rel="noopener" href="${edge.insider}">Edge Canary lub Dev</a>.` }),
    el('li', { html: 'W <code>edge://flags</code> włącz flagę danego API (nazwy w tabeli) i uruchom Edge ponownie.' }),
    el('li', { html: 'W <code>edge://on-device-internals</code> sprawdź <em>Device performance class</em>: ' +
      '<strong>High</strong> lub wyżej obsługuje Phi-4-mini (GPU).' }),
    el('li', { html: 'Przy klasie Medium/Low albo gdy sesja Phi-4-mini się wysypuje: włącz <em>Enable prerelease on-device ' +
      'language model</em> (Canary/Dev 150.0.4070+) — Aion-1.0-Instruct działa na CPU i zastępuje Phi-4-mini.' }),
  ]));
  setup.appendChild(el('ul', { class: 'tips' }, [
    el('li', { html: '<strong>Sprzęt:</strong> Windows 10/11 lub macOS 13.3+, 5,5 GB VRAM, 20 GB wolnego miejsca ' +
      '(poniżej 10 GB model jest usuwany), sieć bez limitu danych.' }),
    el('li', { html: 'Edge nie ma odpowiednika <code>chrome://settings/ai</code>. Administrator może wyłączyć model ' +
      'polityką <code>GenAILocalFoundationalModelSettings</code>.' }),
  ]));
  main.appendChild(setup);

  main.appendChild(el('p', { class: 'muted', html:
    `Źródła: <a target="_blank" rel="noopener" href="${edge.docs}">Prompt API w Edge</a> · ` +
    `<a target="_blank" rel="noopener" href="https://learn.microsoft.com/microsoft-edge/web-platform/release-notes/">noty wydań Edge</a> · ` +
    `<a target="_blank" rel="noopener" href="${edge.demos}">dema Microsoftu</a>` }));
}

// ── Panel: pojedyncze API ─────────────────────────────────────────────────────

function renderApi(api) {
  const main = document.getElementById('main');
  main.innerHTML = '';

  // Nagłówek + status
  main.appendChild(el('div', { class: 'api-head' }, [
    el('div', {}, [
      el('h1', { text: api.name }),
      el('p', { class: 'lead', text: api.tagline }),
    ]),
    el('span', { class: `pill ${STATUS_META[api.status].cls} big`, text: STATUS_META[api.status].label }),
  ]));
  main.appendChild(el('p', { class: 'code-inline', html: `Globalny obiekt: <code>${api.globalName}</code>` }));

  // Live check — „czy mogę tego użyć?"
  const checkCard = el('div', { class: 'card' });
  checkCard.appendChild(el('h2', { text: 'Czy zadziała u Ciebie?' }));
  checkCard.appendChild(el('p', { class: 'muted', text:
    `Status dokumentacji: ${RELEASE_INFO.verifiedAt}. Test przeglądarki używa opcji wybranych w demo; nie pobiera modelu.` }));
  const result = el('div', {}, el('span', { class: 'pill av-pending', text: '… sprawdzam' }));
  const refresh = el('button', { class: 'btn ghost', text: 'Sprawdź ponownie',
    onclick: () => runCheck() });
  checkCard.appendChild(el('div', { class: 'check-row' }, [result, refresh]));
  main.appendChild(checkCard);
  let demoValues;
  let checkId = 0;
  const runCheck = () => {
    const id = ++checkId;
    result.innerHTML = '';
    result.appendChild(el('span', { class: 'pill av-pending', text: '… sprawdzam' }));
    checkApi(api, demoValues).then(state => {
      if (id !== checkId) return;
      result.innerHTML = '';
      result.appendChild(availPill(state));
    });
  };
  runCheck();

  // Opis
  const desc = el('div', { class: 'card' });
  desc.appendChild(el('h2', { text: 'Opis' }));
  desc.appendChild(el('p', { html: api.description }));
  main.appendChild(desc);

  // Historia wersji
  const hist = el('div', { class: 'card' });
  hist.appendChild(el('h2', { text: 'Historia / status wersji' }));
  const tl = el('ul', { class: 'timeline' });
  for (const ver of api.versions) {
    tl.appendChild(el('li', { class: `tl-${ver.state}` }, [
      el('span', { class: 'tl-ver', text: ver.v }),
      el('span', { class: 'tl-label', text: ver.label }),
    ]));
  }
  hist.appendChild(tl);
  main.appendChild(hist);

  // Użycie (kod)
  const code = el('div', { class: 'card' });
  code.appendChild(el('h2', { text: 'Użycie' }));
  const pre = el('pre', {}, el('code', { text: api.usage }));
  const copy = el('button', { class: 'btn ghost copy', text: 'Kopiuj', onclick: () => {
    navigator.clipboard.writeText(api.usage).then(() => {
      copy.textContent = '✓ Skopiowano';
      setTimeout(() => { copy.textContent = 'Kopiuj'; }, 1500);
    }).catch(() => {});
  }});
  code.appendChild(el('div', { class: 'code-wrap' }, [copy, pre]));
  main.appendChild(code);

  // Wskazówki
  if (api.tips?.length) {
    const tips = el('div', { class: 'card' });
    tips.appendChild(el('h2', { text: 'Wskazówki' }));
    const list = el('ul', { class: 'tips' });
    for (const tip of api.tips) list.appendChild(el('li', { html: tip }));
    tips.appendChild(list);
    main.appendChild(tips);
  }

  // Linki
  const links = el('div', { class: 'card' });
  links.appendChild(el('h2', { text: 'Linki' }));
  const ul = el('ul', { class: 'links' });
  for (const l of api.links) {
    ul.appendChild(el('li', {}, el('a', { href: l.url, target: '_blank', rel: 'noopener', text: l.label })));
  }
  links.appendChild(ul);
  main.appendChild(links);

  // Demo na żywo (wpisy informacyjne, np. WebMCP, nie mają dema)
  if (api.demo) {
    const onDownload = state => {
      if (!state) return runCheck();
      ++checkId;
      result.innerHTML = '';
      result.appendChild(availPill(state));
    };
    main.appendChild(buildDemo(api, values => { demoValues = values; runCheck(); }, onDownload));
  } else {
    const note = el('div', { class: 'card' });
    note.appendChild(el('h2', { text: 'Demo' }));
    note.appendChild(el('p', { class: 'muted', text:
      'To wpis informacyjny — to API nie generuje tekstu (nie ma schematu wejście → wynik), ' +
      'więc nie ma tu interaktywnego dema. Szczegóły w dokumentacji powyżej.' }));
    main.appendChild(note);
  }
}

// ── Demo runner ────────────────────────────────────────────────────────────────

// Czas w polskim formacie: „840 ms”, „12,3 s”.
function formatElapsed(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

// onDownload('downloading') przy starcie pobierania, onDownload(null) po zakończeniu.
function buildDemo(api, onOptionsChange = () => {}, onDownload = () => {}) {
  const card = el('div', { class: 'card demo' });
  card.appendChild(el('h2', { text: 'Demo na żywo' }));

  const inputs = {};
  for (const f of api.demo.fields) {
    const field = el('label', { class: 'field' }, el('span', { class: 'field-label', text: f.label }));
    let control;
    if (f.type === 'textarea') {
      control = el('textarea', { rows: String(f.rows || 3) });
      control.value = f.value || '';
    } else if (f.type === 'select') {
      control = el('select');
      for (const [val, lbl] of f.options) {
        const opt = el('option', { value: val, text: lbl });
        if (val === f.value) opt.selected = true;
        control.appendChild(opt);
      }
    }
    inputs[f.id] = control;
    if (f.type === 'select') control.addEventListener('change', () => {
      onOptionsChange(Object.fromEntries(Object.entries(inputs).map(([id, input]) => [id, input.value])));
    });
    field.appendChild(control);
    card.appendChild(field);
  }

  const status = el('div', { class: 'demo-status' });
  const fill = el('div', { class: 'progress-fill' });
  const meter = el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Pobieranie modelu',
    'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  const pctLabel = el('span', { class: 'progress-pct', text: '0%' });
  const bar = el('div', { class: 'progress-row' }, [meter, pctLabel]);
  bar.style.display = 'none';
  const output = el('pre', { class: 'demo-output', text: '' });

  const runBtn = el('button', { class: 'btn primary', text: '▶ Uruchom', onclick: async () => {
    const values = {};
    for (const [id, ctrl] of Object.entries(inputs)) values[id] = ctrl.value;

    runBtn.disabled = true;
    output.textContent = '';
    output.classList.remove('error');
    output.removeAttribute('role');
    status.textContent = '';
    bar.style.display = 'none';
    fill.style.width = '0%';
    pctLabel.textContent = '0%';
    meter.setAttribute('aria-valuenow', '0');

    console.group(`%c Built-in AI %c ${api.name} · ${api.globalName}`, LOG_BADGE, 'color:#3b6ef5;font-weight:600');
    aiLog('wywołuję demo — dane wejściowe:', values);

    // Licznik na żywo — tworzenie sesji i pobieranie potrafią trwać sekundy.
    const t0 = performance.now();
    let phase = 'Uruchamiam…';
    let downloading = false;
    const tick = () => { status.textContent = `${phase} · ${formatElapsed(performance.now() - t0)}`; };
    const timer = setInterval(tick, 100);
    tick();

    const report = {
      status: msg => { phase = msg; tick(); aiLog(msg); },
      progress: frac => {
        const pct = Math.round(frac * 100);
        bar.style.display = 'flex';
        fill.style.width = `${pct}%`;
        pctLabel.textContent = `${pct}%`;
        meter.setAttribute('aria-valuenow', String(pct));
        if (!downloading && frac < 1) { downloading = true; onDownload('downloading'); }
        phase = frac < 1 ? 'Pobieram model — nie zamykaj karty' : 'Model pobrany, uruchamiam…';
        tick();
        aiLog(`pobieranie modelu: ${pct}%`);
      },
    };

    try {
      const out = await api.demo.run(values, report);
      clearInterval(timer);
      const ms = Math.round(performance.now() - t0);
      status.textContent = `Gotowe w ${ms} ms`;
      bar.style.display = 'none';
      output.textContent = out;
      aiLog(`✅ gotowe w ${ms} ms — wynik:`, out);
    } catch (e) {
      clearInterval(timer);
      bar.style.display = 'none';
      status.textContent = '';
      output.classList.add('error');
      output.setAttribute('role', 'alert');
      output.textContent = e?.name === 'InputError' ? `Błąd: ${e.message}` : `Błąd: ${e?.message || e}\n\n` +
        `Najczęstsze przyczyny:\n` +
        `• To API jest niedostępne w tej wersji Chrome (zobacz „Czy zadziała u Ciebie?")\n` +
        `• On-device AI jest wyłączone w chrome://settings/ai\n` +
        `• Model nie został jeszcze pobrany — uruchom ponownie\n` +
        `• Strona nie jest w bezpiecznym kontekście (użyj http://localhost)`;
      aiLog(`❌ błąd: ${e?.message || e}`);
      console.error('[Built-in AI] pełny błąd:', e);
    } finally {
      clearInterval(timer);
      if (downloading) onDownload(null);
      runBtn.disabled = false;
      console.groupEnd();
    }
  }});

  card.appendChild(el('div', { class: 'demo-actions' }, [runBtn, status]));
  card.appendChild(bar);
  card.appendChild(output);
  return card;
}

// ── Baner: Prompt API niedostępne na web ──────────────────────────────────────
// Na publicznej stronie web Prompt API może być nieobecne mimo wydania stable —
// zależy od sprzętu, kontekstu i polityk przeglądarki. Wykrywamy to
// synchronicznie i podpowiadamy, co zrobić. Pozostałe API działają niezależnie.

function injectBanner(main) {
  if (getApi('LanguageModel')) return;                        // Prompt API jest — bez baneru
  if (sessionStorage.getItem('cv-banner-dismissed')) return;
  if (isFirefox()) {
    if (location.hash === '#firefox') return;
    const fxBanner = el('div', { class: 'banner' }, [
      el('span', { html: '🦊 Używasz <strong>Firefoksa</strong>: te API nie działają na stronach w Firefoksie. ' +
        'Zobacz <a href="#firefox">stan lokalnego AI w Firefoksie</a> i rozszerzenie z demami na żywo.' }),
      el('button', { class: 'banner-x', text: '✕', title: 'Ukryj',
        onclick: () => { sessionStorage.setItem('cv-banner-dismissed', '1'); fxBanner.remove(); } }),
    ]);
    main.prepend(fxBanner);
    return;
  }
  if (isEdge()) {
    if (location.hash === '#edge') return;
    const edgeBanner = el('div', { class: 'banner' }, [
      el('span', { html: '⚠️ <strong>Prompt API</strong> nie jest dostępne w tym Edge. W Edge to wciąż developer preview: ' +
        'Canary lub Dev i flaga w <code>edge://flags</code>. Zobacz <a href="#edge">stan API w Edge</a>; ' +
        'Translator i Language Detector działają domyślnie od Edge 148.' }),
      el('button', { class: 'banner-x', text: '✕', title: 'Ukryj',
        onclick: () => { sessionStorage.setItem('cv-banner-dismissed', '1'); edgeBanner.remove(); } }),
    ]);
    main.prepend(edgeBanner);
    return;
  }
  const banner = el('div', { class: 'banner' }, [
    el('span', { html:
      '⚠️ <strong>Prompt API</strong> nie jest dostępne w tej przeglądarce. Od <strong>Chrome 148</strong> ' +
      'jest stabilne także na zwykłych stronach (bez tokenu i flag) — upewnij się, że masz Chrome 148+ ' +
      'na desktopie i kompatybilny sprzęt; model Gemini Nano pobiera się przy pierwszym użyciu. ' +
      'Jeśli API zwraca „niedostępne”, włącz <em>On-device AI</em> w <code>chrome://settings/ai</code>. ' +
      'Pozostałe API mogą działać niezależnie.' }),
    el('button', { class: 'banner-x', text: '✕', title: 'Ukryj',
      onclick: () => { sessionStorage.setItem('cv-banner-dismissed', '1'); banner.remove(); } }),
  ]);
  main.prepend(banner);
}

// ── Routing ─────────────────────────────────────────────────────────────────

function route() {
  const id = (location.hash || '#overview').slice(1);
  setActive(id);
  if (id === 'overview') renderOverview();
  else if (id === 'firefox') renderFirefox();
  else if (id === 'edge') renderEdge();
  else {
    const api = APIS.find(a => a.id === id);
    if (api) renderApi(api); else renderOverview();
  }
  injectBanner(document.getElementById('main'));
  document.getElementById('main').scrollTop = 0;
  window.scrollTo(0, 0);
}

if (typeof document !== 'undefined') {
  buildSidebar();
  window.addEventListener('hashchange', route);
  route();

  aiLog('Otwórz DevTools → Console. Każde wywołanie API loguje się tutaj. ' +
    'Dema wykonują inferencję lokalnie; pobieranie modeli wymaga sieci. WebMCP nie jest lokalnym modelem.');
}
