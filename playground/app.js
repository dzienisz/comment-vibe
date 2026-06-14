'use strict';

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

async function checkApi(api) {
  const ctor = window[api.globalName];
  if (!ctor || typeof ctor.availability !== 'function') {
    aiLog(`${api.globalName}: brak tego API w przeglądarce`);
    return 'no-api';
  }
  try {
    const state = await ctor.availability(api.availabilityOptions || undefined);
    aiLog(`${api.globalName}.availability() → ${state}`);
    return state;
  } catch (e) {
    console.warn(`[Built-in AI] ${api.globalName}.availability() rzuciło wyjątek:`, e);
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
}

// ── Panel: Przegląd ─────────────────────────────────────────────────────────

function renderOverview() {
  const main = document.getElementById('main');
  main.innerHTML = '';

  main.appendChild(el('h1', { text: 'Wbudowane AI w Chrome — środowisko testowe' }));
  main.appendChild(el('p', { class: 'lead', html:
    `Wszystkie modele działają <strong>lokalnie</strong> (Gemini Nano), bez wysyłania danych na serwer.
     Wybierz API z menu po lewej, sprawdź czy działa u Ciebie i odpal demo na żywo.
     Stan opisany na podstawie dokumentacji Chrome — aktualny stabilny kanał: <strong>Chrome 149</strong> (czerwiec 2026).` }));

  // Środowisko
  const env = el('div', { class: 'card' });
  env.appendChild(el('h2', { text: 'Twoje środowisko' }));
  const ua = navigator.userAgent;
  const m = ua.match(/Chrome\/(\d+)/);
  const chromeVer = m ? m[1] : 'nie wykryto';
  env.appendChild(infoRow('Wersja Chrome', chromeVer + (m && +m[1] < 138 ? ' (zalecane 138+)' : '')));
  env.appendChild(infoRow('Bezpieczny kontekst (isSecureContext)', String(window.isSecureContext)));
  env.appendChild(infoRow('Origin', location.origin || '(file://)'));
  if (!window.isSecureContext) {
    env.appendChild(el('p', { class: 'warn', html:
      'To API wymagają bezpiecznego kontekstu. Otwórz tę stronę przez <code>http://localhost</code> ' +
      '(np. <code>python3 -m http.server</code>), a nie z pliku <code>file://</code>.' }));
  }
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
  card.appendChild(table);
  main.appendChild(card);

  main.appendChild(el('p', { class: 'muted', html:
    'Źródła: ' +
    '<a target="_blank" rel="noopener" href="https://developer.chrome.com/docs/ai/built-in-apis">Built-in AI APIs</a> · ' +
    '<a target="_blank" rel="noopener" href="https://developer.chrome.com/docs/ai/get-started">Get started</a>' }));
}

function infoRow(label, value) {
  return el('div', { class: 'info-row' }, [
    el('span', { class: 'info-label', text: label }),
    el('span', { class: 'info-value', text: value }),
  ]);
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
  const result = el('div', {}, el('span', { class: 'pill av-pending', text: '… sprawdzam' }));
  const refresh = el('button', { class: 'btn ghost', text: 'Sprawdź ponownie',
    onclick: () => runCheck() });
  checkCard.appendChild(el('div', { class: 'check-row' }, [result, refresh]));
  main.appendChild(checkCard);
  const runCheck = () => {
    result.innerHTML = '';
    result.appendChild(el('span', { class: 'pill av-pending', text: '… sprawdzam' }));
    checkApi(api).then(state => { result.innerHTML = ''; result.appendChild(availPill(state)); });
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

  // Linki
  const links = el('div', { class: 'card' });
  links.appendChild(el('h2', { text: 'Linki' }));
  const ul = el('ul', { class: 'links' });
  for (const l of api.links) {
    ul.appendChild(el('li', {}, el('a', { href: l.url, target: '_blank', rel: 'noopener', text: l.label })));
  }
  links.appendChild(ul);
  main.appendChild(links);

  // Demo na żywo
  main.appendChild(buildDemo(api));
}

// ── Demo runner ────────────────────────────────────────────────────────────────

function buildDemo(api) {
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
    field.appendChild(control);
    card.appendChild(field);
  }

  const status = el('div', { class: 'demo-status' });
  const bar = el('div', { class: 'progress' }, el('div', { class: 'progress-fill' }));
  bar.style.display = 'none';
  const output = el('pre', { class: 'demo-output', text: '' });

  const runBtn = el('button', { class: 'btn primary', text: '▶ Uruchom', onclick: async () => {
    const values = {};
    for (const [id, ctrl] of Object.entries(inputs)) values[id] = ctrl.value;

    runBtn.disabled = true;
    output.textContent = '';
    status.textContent = '';
    bar.style.display = 'none';
    bar.querySelector('.progress-fill').style.width = '0%';

    console.group(`%c Built-in AI %c ${api.name} · ${api.globalName}`, LOG_BADGE, 'color:#3b6ef5;font-weight:600');
    aiLog('wywołuję demo — dane wejściowe:', values);

    const report = {
      status: msg => { status.textContent = msg; aiLog(msg); },
      progress: frac => {
        const pct = Math.round(frac * 100);
        bar.style.display = 'block';
        bar.querySelector('.progress-fill').style.width = `${pct}%`;
        status.textContent = `Pobieram model… ${pct}%`;
        aiLog(`pobieranie modelu: ${pct}%`);
      },
    };

    const t0 = performance.now();
    try {
      const out = await api.demo.run(values, report);
      const ms = Math.round(performance.now() - t0);
      status.textContent = `Gotowe w ${ms} ms`;
      bar.style.display = 'none';
      output.textContent = out;
      aiLog(`✅ gotowe w ${ms} ms — wynik:`, out);
    } catch (e) {
      bar.style.display = 'none';
      status.textContent = '';
      output.classList.add('error');
      output.textContent = `Błąd: ${e?.message || e}\n\n` +
        `Najczęstsze przyczyny:\n` +
        `• To API jest niedostępne w tej wersji Chrome (zobacz „Czy zadziała u Ciebie?")\n` +
        `• Model nie został jeszcze pobrany — uruchom ponownie\n` +
        `• Strona nie jest w bezpiecznym kontekście (użyj http://localhost)`;
      setTimeout(() => output.classList.remove('error'), 4000);
      aiLog(`❌ błąd: ${e?.message || e}`);
      console.error('[Built-in AI] pełny błąd:', e);
    } finally {
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
// Na publicznej stronie web Prompt API (global `LanguageModel`) jest gated —
// bez tokenu Origin Trial lub flagi po prostu nie istnieje. Wykrywamy to
// synchronicznie i podpowiadamy, co zrobić. Stabilne API działają mimo to.

function injectBanner(main) {
  if (typeof LanguageModel !== 'undefined') return;            // Prompt API jest — bez baneru
  if (sessionStorage.getItem('cv-banner-dismissed')) return;
  const banner = el('div', { class: 'banner' }, [
    el('span', { html:
      '⚠️ <strong>Prompt API</strong> nie jest dostępne w tej przeglądarce. Od <strong>Chrome 148</strong> ' +
      'jest stabilne także na zwykłych stronach (bez tokenu i flag) — upewnij się, że masz Chrome 148+ ' +
      'na desktopie i kompatybilny sprzęt; model Gemini Nano pobiera się przy pierwszym użyciu. ' +
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
  else {
    const api = APIS.find(a => a.id === id);
    if (api) renderApi(api); else renderOverview();
  }
  injectBanner(document.getElementById('main'));
  document.getElementById('main').scrollTop = 0;
}

buildSidebar();
window.addEventListener('hashchange', route);
route();

aiLog('Otwórz DevTools → Console. Każde wywołanie API loguje się tutaj. ' +
  'Inferencja jest w 100% lokalna — w zakładce Network nie zobaczysz żądań do modelu.');
