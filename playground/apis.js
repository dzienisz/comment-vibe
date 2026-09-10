'use strict';

// ── Dane wszystkich wbudowanych API AI w Chrome ───────────────────────────────
// Zweryfikowany stan: RELEASE_INFO. Źródło: https://developer.chrome.com/docs/ai/built-in-apis
//
// Każdy wpis opisuje jedno API: status z dokumentacji, historię wersji, linki,
// przykład użycia oraz konfigurację interaktywnego demo (pola + funkcja `run`).
// `run(values, report)` jest wywoływane po kliknięciu „Uruchom":
//   report.status(text)     – komunikat o postępie
//   report.progress(0..1)   – postęp pobierania modelu
// i zwraca tekst do wyświetlenia (lub rzuca błąd, który zostanie pokazany).

// Helper: podpina podgląd pobierania modelu do opcji create({ monitor }).
const dl = report => m =>
  m.addEventListener('downloadprogress', e => {
    const fraction = e.total > 0 ? e.loaded / e.total : e.loaded;
    if (Number.isFinite(fraction)) report.progress(Math.max(0, Math.min(1, fraction)));
  });

const RELEASE_INFO = {
  verifiedAt: '2026-09-10',
  stable: 153,
  beta: 154,
  nextStableDate: '2026-09-22',
  source: 'https://developer.chrome.com/blog/chrome-two-week-start',
  betaSource: 'https://developer.chrome.com/blog/chrome-154-beta',
  roadmap: 'https://chromestatus.com/roadmap',
};

function getApi(globalName) {
  if (globalName === 'LanguageModel') return globalThis.LanguageModel ?? globalThis.ai?.languageModel;
  if (globalName === 'document.modelContext') return globalThis.document?.modelContext ?? globalThis.navigator?.modelContext;
  return globalThis[globalName];
}

function getApiOptions(api, values) {
  const defaults = Object.fromEntries((api.demo?.fields || []).map(field => [field.id, field.value]));
  return api.demo?.options?.({ ...defaults, ...values }) ?? api.availabilityOptions ?? {};
}

async function runWithSession(id, values, report, run) {
  const api = APIS.find(api => api.id === id);
  const factory = getApi(api.globalName);
  if (typeof factory?.create !== 'function') throw new Error(`${api.name}: brak metody create() w tej przeglądarce.`);
  const session = await factory.create({ ...getApiOptions(api, values), monitor: dl(report) });
  try {
    return await run(session);
  } finally {
    session.destroy?.();
  }
}

const APIS = [
  // ── Prompt API ──────────────────────────────────────────────────────────────
  {
    id: 'prompt',
    name: 'Prompt API',
    globalName: 'LanguageModel',
    status: 'stable',
    tagline: 'Dowolne zapytania w języku naturalnym do Gemini Nano.',
    description: `Najbardziej uniwersalne z wbudowanych API — to po prostu czat z lokalnym
      modelem Gemini Nano. Sam definiujesz prompt systemowy, przykłady (few-shot) i format
      odpowiedzi. To na nim stoi rdzeń rozszerzenia <strong>Comment Vibe</strong>.
      <br><br>Od Chrome 148 jest stabilne także na <strong>zwykłych stronach web</strong> (nie tylko
      w rozszerzeniach) — bez tokenu i bez flag. Uwaga na nazewnictwo: stara przestrzeń
      <code>window.ai.languageModel</code> jest wycofywana na rzecz globalnego <code>LanguageModel</code>.
      Aktualna dokumentacja opisuje wejście tekstowe, obraz i dźwięk oraz wyłącznie tekst na wyjściu.
      Obsługę konkretnej kombinacji sprawdzaj przez <code>availability()</code> z tymi samymi
      <code>expectedInputs</code> i <code>expectedOutputs</code>, których użyjesz w <code>create()</code>;
      wejście audio wymaga GPU. Udokumentowane języki to en, ja, es, de i fr — demo domyślnie używa angielskiego.
      <br><br>Na web parametr <code>samplingMode</code> pozostaje osobnym origin trial.
      <code>topK</code>, <code>temperature</code> i <code>LanguageModel.params()</code> to nadal ścieżka
      rozszerzeń, nie domyślne API strony. Rozwój kolejnych języków nie ma tu przypisanej daty stable.`,
    versions: [
      { v: 'Chrome 127', label: 'Pierwsze wydanie za flagą (wczesny dostęp / origin trial)', state: 'past' },
      { v: 'Chrome 138', label: 'Stabilne dla rozszerzeń', state: 'past' },
      { v: 'Chrome 148', label: 'Stabilne także dla otwartego web (bez flag/tokenu)', state: 'now' },
    ],
    links: [
      { label: 'Dokumentacja: Prompt API', url: 'https://developer.chrome.com/docs/ai/prompt-api' },
      { label: 'Pierwsze kroki z wbudowanym AI', url: 'https://developer.chrome.com/docs/ai/get-started' },
      { label: 'Zarządzanie kontekstem i kompaktowanie sesji', url: 'https://developer.chrome.com/docs/ai/session-compacting' },
    ],
    usage: `const session = await LanguageModel.create({
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
  initialPrompts: [
    { role: 'system', content: 'You are a helpful assistant.' },
  ],
});

const result = await session.prompt('Write a haiku about Chrome.');
console.log(result);

session.destroy();`,
    availabilityOptions: undefined,
    demo: {
      fields: [
        { type: 'textarea', id: 'text', label: 'Twój prompt (demo w języku angielskim)',
          value: 'Write a short, friendly welcome for viewers of my YouTube channel.' },
      ],
      options: () => globalThis.LanguageModel ? {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      } : {},
      run: async (v, report) => {
        report.status('Tworzę sesję…');
        return runWithSession('prompt', v, report, session => {
          report.status('Generuję odpowiedź…');
          return session.prompt(v.text);
        });
      },
    },
  },

  // ── Summarizer API ────────────────────────────────────────────────────────────
  {
    id: 'summarizer',
    name: 'Summarizer API',
    globalName: 'Summarizer',
    status: 'stable',
    tagline: 'Streszczanie długich tekstów na urządzeniu.',
    description: `Dedykowane API do kondensowania długich treści — artykułów, wątków komentarzy,
      transkrypcji. Pozwala wybrać typ (np. „tl;dr", lista punktów), długość i format wyniku.
      Działa wyłącznie w trybie tekst → tekst. Demo deklaruje angielski na wejściu i wyjściu;
      aktualnie udokumentowane języki to en, ja, es, de i fr.`,
    versions: [
      { v: 'Chrome 138', label: 'Stabilne (web + rozszerzenia)', state: 'now' },
    ],
    links: [
      { label: 'Dokumentacja: Summarizer API', url: 'https://developer.chrome.com/docs/ai/summarizer-api' },
    ],
    usage: `const summarizer = await Summarizer.create({
  expectedInputLanguages: ['en'],
  outputLanguage: 'en',
  type: 'tldr',     // 'tldr' | 'key-points' | 'teaser' | 'headline'
  length: 'short',  // 'short' | 'medium' | 'long'
});

const summary = await summarizer.summarize(longText);
console.log(summary);`,
    availabilityOptions: undefined,
    demo: {
      fields: [
        { type: 'select', id: 'type', label: 'Typ', value: 'tldr',
          options: [['tldr', 'tl;dr'], ['key-points', 'Punkty kluczowe'], ['teaser', 'Zajawka'], ['headline', 'Nagłówek']] },
        { type: 'select', id: 'length', label: 'Długość', value: 'short',
          options: [['short', 'Krótko'], ['medium', 'Średnio'], ['long', 'Długo']] },
        { type: 'textarea', id: 'text', label: 'Tekst do streszczenia', rows: 6,
          value: 'Chrome built-in AI APIs run models directly in the browser without sending text to a server. Developers can build privacy-preserving features that work offline after the initial model download. Some APIs are stable, while others remain experimental. Availability depends on the device, language, browser policies, and the options used to create a session.' },
      ],
      options: v => ({ type: v.type, length: v.length, expectedInputLanguages: ['en'], outputLanguage: 'en' }),
      run: async (v, report) => {
        report.status('Tworzę summarizer…');
        return runWithSession('summarizer', v, report, s => {
          report.status('Streszczam…');
          return s.summarize(v.text);
        });
      },
    },
  },

  // ── Translator API ──────────────────────────────────────────────────────────
  {
    id: 'translator',
    name: 'Translator API',
    globalName: 'Translator',
    status: 'stable',
    tagline: 'Tłumaczenie między językami, lokalnie.',
    description: `Tłumaczy tekst między parami języków na urządzeniu. Każda para języków to
      osobny model pobierany na żądanie. To jedno z dwóch API, które dodałem do Comment Vibe
      w wersji 1.1 — sugestia poprawy komentarza wraca w języku, w którym piszesz.`,
    versions: [
      { v: 'Chrome 138', label: 'Stabilne (web + rozszerzenia)', state: 'now' },
    ],
    links: [
      { label: 'Dokumentacja: Translator API', url: 'https://developer.chrome.com/docs/ai/translator-api' },
    ],
    usage: `const translator = await Translator.create({
  sourceLanguage: 'en',
  targetLanguage: 'pl',
});

const pl = await translator.translate('Hello, world!');
console.log(pl);`,
    availabilityOptions: { sourceLanguage: 'en', targetLanguage: 'pl' },
    demo: {
      fields: [
        { type: 'select', id: 'source', label: 'Z języka', value: 'en',
          options: [['en', 'angielski'], ['pl', 'polski'], ['es', 'hiszpański'], ['de', 'niemiecki'], ['fr', 'francuski'], ['ja', 'japoński']] },
        { type: 'select', id: 'target', label: 'Na język', value: 'pl',
          options: [['pl', 'polski'], ['en', 'angielski'], ['es', 'hiszpański'], ['de', 'niemiecki'], ['fr', 'francuski'], ['ja', 'japoński']] },
        { type: 'textarea', id: 'text', label: 'Tekst', value: 'Built-in AI runs entirely on your device.' },
      ],
      options: v => ({ sourceLanguage: v.source, targetLanguage: v.target }),
      run: async (v, report) => {
        if (v.source === v.target) throw new Error('Wybierz dwa różne języki.');
        report.status('Tworzę tłumacza…');
        return runWithSession('translator', v, report, t => {
          report.status('Tłumaczę…');
          return t.translate(v.text);
        });
      },
    },
  },

  // ── Language Detector API ─────────────────────────────────────────────────────
  {
    id: 'detector',
    name: 'Language Detector API',
    globalName: 'LanguageDetector',
    status: 'stable',
    tagline: 'Rozpoznawanie języka tekstu wraz z pewnością.',
    description: `Wykrywa język fragmentu tekstu i zwraca listę kandydatów z poziomem pewności
      (0–1). Zwykle używane razem z Translatorem. W Comment Vibe to ono decyduje, na jaki
      język przetłumaczyć etykietę i sugestię.`,
    versions: [
      { v: 'Chrome 138', label: 'Stabilne (web + rozszerzenia)', state: 'now' },
    ],
    links: [
      { label: 'Dokumentacja: Language Detection', url: 'https://developer.chrome.com/docs/ai/language-detection' },
    ],
    usage: `const detector = await LanguageDetector.create();

const results = await detector.detect('Dzień dobry, jak się masz?');
const best = results[0];
console.log(best.detectedLanguage, best.confidence);`,
    availabilityOptions: undefined,
    demo: {
      fields: [
        { type: 'textarea', id: 'text', label: 'Tekst do rozpoznania', value: 'Dzień dobry, miło Cię widzieć!' },
      ],
      run: async (v, report) => {
        report.status('Tworzę detektor…');
        return runWithSession('detector', v, report, async d => {
          report.status('Wykrywam język…');
          const res = await d.detect(v.text);
          return res.slice(0, 5)
            .map(r => `${r.detectedLanguage.padEnd(8)} ${(r.confidence * 100).toFixed(1)}%`)
            .join('\n');
        });
      },
    },
  },

  // ── Writer API ──────────────────────────────────────────────────────────────
  {
    id: 'writer',
    name: 'Writer API',
    globalName: 'Writer',
    status: 'dev-trial',
    tagline: 'Generowanie nowych treści wg zadania.',
    description: `Tworzy nowy tekst zgodny z opisanym zadaniem — np. opis produktu, e-mail,
      post. Pozwala sterować tonem, formatem i długością. <strong>Wciąż eksperymentalne
      (developer trial)</strong> — może nie być dostępne bez flagi lub udziału w Early
      Preview Program, dlatego w Comment Vibe go nie używam.
      <br><br>Origin trial Chrome 137–148 zakończył się; aktualna tabela Google podaje
      developer trial, bez potwierdzonej wersji stable. Wygaśnięcie trial nie oznacza porzucenia API.
      Przed użyciem w produkcji sprawdzaj dostępność i zapewnij alternatywną ścieżkę.`,
    versions: [
      { v: 'Origin trial 137–148', label: 'Trial zakończony; nadal brak stabilnego wydania (developer trial / EPP)', state: 'trial' },
    ],
    links: [
      { label: 'Dokumentacja: Writer API', url: 'https://developer.chrome.com/docs/ai/writer-api' },
    ],
    usage: `const writer = await Writer.create({
  tone: 'neutral',       // 'formal' | 'neutral' | 'casual'
  format: 'plain-text',  // 'plain-text' | 'markdown'
  length: 'short',
});

const text = await writer.write('A short product description for a coffee mug.');`,
    availabilityOptions: undefined,
    demo: {
      fields: [
        { type: 'select', id: 'tone', label: 'Ton', value: 'neutral',
          options: [['formal', 'formalny'], ['neutral', 'neutralny'], ['casual', 'swobodny']] },
        { type: 'textarea', id: 'text', label: 'Zadanie', value: 'A short, friendly intro for a YouTube video about Chrome built-in AI.' },
      ],
      options: v => ({ tone: v.tone }),
      run: async (v, report) => {
        report.status('Tworzę writer…');
        return runWithSession('writer', v, report, w => {
          report.status('Piszę…');
          return w.write(v.text);
        });
      },
    },
  },

  // ── Rewriter API ──────────────────────────────────────────────────────────────
  {
    id: 'rewriter',
    name: 'Rewriter API',
    globalName: 'Rewriter',
    status: 'dev-trial',
    tagline: 'Przepisywanie i zmiana tonu istniejącego tekstu.',
    description: `Przeredagowuje istniejący tekst — zmienia ton, długość lub formę.
      To naturalny kandydat, by zastąpić „ręczne" przepisywanie przez Prompt API w Comment Vibe.
      <strong>Na razie developer trial</strong>, więc czekam aż się ustabilizuje, zanim na nim oprę produkcyjną funkcję.
      <br><br>Origin trial Chrome 137–148 zakończył się; aktualny status to developer trial.
      Nie ma potwierdzonej daty stabilnego wydania. Prompt API pozostaje alternatywą,
      ale dostępność i jakość obu rozwiązań trzeba oceniać osobno.`,
    versions: [
      { v: 'Origin trial 137–148', label: 'Trial zakończony; nadal brak stabilnego wydania (developer trial / EPP)', state: 'trial' },
    ],
    links: [
      { label: 'Dokumentacja: Rewriter API', url: 'https://developer.chrome.com/docs/ai/rewriter-api' },
    ],
    usage: `const rewriter = await Rewriter.create({
  tone: 'more-casual',   // 'as-is' | 'more-formal' | 'more-casual'
  length: 'as-is',
});

const text = await rewriter.rewrite(
  'We regret to inform you that your request was denied.'
);`,
    availabilityOptions: undefined,
    demo: {
      fields: [
        { type: 'select', id: 'tone', label: 'Ton', value: 'more-casual',
          options: [['as-is', 'bez zmian'], ['more-formal', 'bardziej formalnie'], ['more-casual', 'bardziej swobodnie']] },
        { type: 'textarea', id: 'text', label: 'Tekst do przepisania', value: 'You are completely wrong and this idea makes no sense at all.' },
      ],
      options: v => ({ tone: v.tone }),
      run: async (v, report) => {
        report.status('Tworzę rewriter…');
        return runWithSession('rewriter', v, report, r => {
          report.status('Przepisuję…');
          return r.rewrite(v.text);
        });
      },
    },
  },

  // ── Proofreader API ────────────────────────────────────────────────────────────
  {
    id: 'proofreader',
    name: 'Proofreader API',
    globalName: 'Proofreader',
    status: 'dev-trial',
    tagline: 'Korekta gramatyki, ortografii i interpunkcji.',
    description: `Interaktywna korekta tekstu — zwraca poprawioną wersję oraz listę konkretnych
      poprawek. Może uzupełniać analizę tonu o korektę gramatyczną. <strong>Developer trial</strong>:
      origin trial Chrome 141–145 zakończył się, a aktualna tabela Google nie podaje stabilnego wydania.
      Dostępność sprawdzaj metodą <code>availability()</code>; flaga lub EPP mogą być wymagane.`,
    versions: [
      { v: 'Origin trial 141–145', label: 'Trial zakończony; aktualnie developer trial — brak potwierdzonej wersji stable', state: 'trial' },
    ],
    links: [
      { label: 'Dokumentacja: Proofreader API', url: 'https://developer.chrome.com/docs/ai/proofreader-api' },
    ],
    usage: `const proofreader = await Proofreader.create();

const result = await proofreader.proofread('I has a apple and two banana.');
console.log(result.correctedInput);
console.log(result.corrections); // lista poprawek`,
    availabilityOptions: undefined,
    demo: {
      fields: [
        { type: 'textarea', id: 'text', label: 'Tekst do korekty', value: 'I has a apple and he dont like it.' },
      ],
      run: async (v, report) => {
        report.status('Tworzę proofreader…');
        return runWithSession('proofreader', v, report, async p => {
          report.status('Sprawdzam…');
          const res = await p.proofread(v.text);
          const corrected = res.correctedInput ?? res.corrected ?? '(brak pola correctedInput)';
          let out = `Poprawiony tekst:\n${corrected}`;
          const corrections = res.corrections ?? [];
          if (corrections.length) {
            out += `\n\nPoprawki (${corrections.length}):\n` +
              corrections.map((c, i) => `${i + 1}. ${JSON.stringify(c)}`).join('\n');
          }
          return out;
        });
      },
    },
  },

  // ── WebMCP (nowość w Chrome 149) ──────────────────────────────────────────────
  {
    id: 'webmcp',
    name: 'WebMCP',
    globalName: 'document.modelContext',
    status: 'origin-trial',
    tagline: 'Strona udostępnia swoje funkcje agentom AI jako narzędzia.',
    description: `Nowość w <strong>Chrome 149</strong> (origin trial). Inna bajka niż generatywne API
      powyżej — WebMCP nie generuje tekstu. Pozwala stronie <strong>wystawić własne funkcje i formularze
      jako narzędzia</strong>, które agent AI w przeglądarce może wywołać wprost, zamiast zgadywać, gdzie
      kliknąć. To krok w stronę „agentic web". <br><br>API wciąż się zmienia: kanoniczna przestrzeń
      to teraz <code>document.modelContext</code> (stare <code>navigator.modelContext</code> jest
      wycofywane od Chrome 150 — narzędzia należą do konkretnej strony, nie do przeglądarki),
      a w Chrome 153 <code>execute(input, { signal })</code> pozwala obsługiwać anulowanie
      wywołań. Wyrejestrowanie narzędzia nie przerywa już trwającego wykonania.
      <strong>Chrome 153 jest stabilny, ale WebMCP nadal jest origin trial</strong> — numer
      przeglądarki nie oznacza stabilności API. Wykrycie <code>registerTool</code> nie potwierdza
      obecności agenta. To wpis informacyjny, bez dema; agent może korzystać z usług sieciowych.`,
    versions: [
      { v: 'Chrome 149', label: 'Origin trial (od czerwca 2026) — wcześniej tylko za flagą', state: 'past' },
      { v: 'Chrome 150', label: 'navigator.modelContext wycofywane na rzecz document.modelContext', state: 'past' },
      { v: 'Chrome 153', label: 'Anulowanie przez execute(input, { signal }); wyrejestrowanie nie przerywa aktywnych wywołań. API nadal w trial.', state: 'now' },
      { v: 'Kolejne wersje', label: 'Brak potwierdzonej daty stable WebMCP; śledź dokumentację i wykrywaj metody, nie numer Chrome.', state: 'future' },
    ],
    links: [
      { label: 'Dokumentacja: WebMCP', url: 'https://developer.chrome.com/docs/ai/webmcp' },
      { label: 'Imperative API: rejestracja i anulowanie narzędzi', url: 'https://developer.chrome.com/docs/ai/webmcp/imperative-api' },
    ],
    usage: `// Szkic koncepcyjny — API jest na wczesnym etapie i może się zmienić.
// Strona rejestruje narzędzie, które agent AI może wywołać.
// W Chrome 153 (API nadal w trial) execute dostaje { signal } (AbortSignal)
// w drugim argumencie — przekaż go do fetch() itp., by anulowanie przerwało
// też pracę w toku. Destrukturyzacja jest bezpieczna też na starszym Chrome,
// o ile podasz domyślną wartość: async execute(input, { signal } = {}) { … }.
const context = document.modelContext ?? navigator.modelContext;
if (typeof context?.registerTool !== 'function') {
  throw new Error('WebMCP is not available');
}
const ac = new AbortController();
await context.registerTool({
  name: 'add-to-cart',
  description: 'Dodaje produkt do koszyka',
  inputSchema: { /* JSON Schema parametrów */ },
  async execute({ productId }, { signal } = {}) {
    await fetch('/cart', { method: 'POST', body: productId, signal });
    return { content: [{ type: 'text', text: 'Dodano do koszyka' }] };
  },
}, { signal: ac.signal });

// Wyrejestrowanie: ac.abort() — uwaga: NIE anuluje już trwających wywołań.`,
    check: async () => typeof getApi('document.modelContext')?.registerTool === 'function' ? 'detected' : 'no-api',
    demo: null,
  },
];

// Metadane statusów (z dokumentacji) i wyników live-check (z Twojej przeglądarki).
const STATUS_META = {
  'stable':       { label: 'Stabilne', cls: 'st-stable' },
  'stable-ext':   { label: 'Stabilne (rozszerzenia) · OT (web)', cls: 'st-stable' },
  'origin-trial': { label: 'Origin Trial', cls: 'st-ot' },
  'dev-trial':    { label: 'Developer Trial', cls: 'st-dev' },
  'epp':          { label: 'Early Preview Program', cls: 'st-epp' },
};

const AVAIL_META = {
  'detected':     { label: 'Interfejs wykryty — nie potwierdza obecności agenta', cls: 'av-ok' },
  'unknown':      { label: 'Nieznany status API — sprawdź aktualną dokumentację i konsolę', cls: 'av-no' },
  'available':    { label: '✅ Dostępne i gotowe', cls: 'av-ok' },
  'downloadable': { label: '⬇️ Dostępne — model do pobrania', cls: 'av-dl' },
  'downloading':  { label: '⏳ Model się pobiera…', cls: 'av-dl' },
  'unavailable':  { label: '❌ Niedostępne na tym urządzeniu', cls: 'av-no' },
  'no-api':       { label: '🚫 Brak tego API w przeglądarce', cls: 'av-no' },
  'error':        { label: '⚠️ Błąd sprawdzania (zobacz konsolę)', cls: 'av-no' },
};
