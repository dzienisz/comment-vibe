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

// Błąd w danych z formularza — demo pokazuje go bez listy typowych przyczyn.
const inputError = message => Object.assign(new Error(message), { name: 'InputError' });

// Helper: podpina podgląd pobierania modelu do opcji create({ monitor }).
const dl = report => m =>
  m.addEventListener('downloadprogress', e => {
    const fraction = e.total > 0 ? e.loaded / e.total : e.loaded;
    if (Number.isFinite(fraction)) report.progress(Math.max(0, Math.min(1, fraction)));
  });

const RELEASE_INFO = {
  verifiedAt: '2026-10-20',
  stable: 156,
  beta: 157,
  nextStableDate: '2026-11-03',
  source: 'https://chromiumdash.appspot.com/schedule',
  betaSource: 'https://chromestatus.com/release-notes/157',
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

// prepare(options) może podmienić opcje tuż przed create() (np. sondą odczytu).
async function runWithSession(id, values, report, run, prepare = options => options) {
  const api = APIS.find(api => api.id === id);
  const factory = getApi(api.globalName);
  if (typeof factory?.create !== 'function') throw new Error(`${api.name}: brak metody create() w tej przeglądarce.`);
  const session = await factory.create(prepare({ ...getApiOptions(api, values), monitor: dl(report) }));
  try {
    return await run(session);
  } finally {
    session.destroy?.();
  }
}

// ── Pomiar Prompt API (MTP) ────────────────────────────────────────────────────

const now = () => globalThis.performance?.now?.() ?? Date.now();
const num = (value, digits = 1) => value.toFixed(digits).replace('.', ',');
const secs = ms => ms < 1000 ? `${Math.round(ms)} ms` : `${num(ms / 1000)} s`;

// WebIDL czyta tylko członków słownika, których przeglądarka zna, więc getter
// mówi, czy create() w ogóle zobaczyło daną opcję. Nieznana opcja jest
// ignorowana bez błędu — bez tej sondy nie widać, że MTP się nie włączy.
function probeOption(options, key) {
  if (!(key in options)) return { options, read: () => null };
  const { [key]: value, ...rest } = options;
  let read = false;
  Object.defineProperty(rest, key, { enumerable: true, get() { read = true; return value; } });
  return { options: rest, read: () => read };
}

// Liczba tokenów odpowiedzi: tokenizer sesji, jeśli go wystawia, inaczej szacunek.
async function countTokens(session, text) {
  for (const method of ['measureContextUsage', 'measureInputUsage']) {
    if (typeof session[method] !== 'function') continue;
    try {
      const value = await session[method](text);
      if (Number.isFinite(value) && value > 0) return { tokens: value, measured: true };
    } catch {}
  }
  return { tokens: Math.max(1, Math.round(text.length / 4)), measured: false };
}

// Jedno wywołanie: TTFT (prefill + pierwszy token) i ciepłe dekodowanie
// liczone od pierwszego fragmentu do końca strumienia.
async function measurePromptRun(session, text) {
  const t0 = now();
  let output = '';
  let firstAt = null;
  if (typeof session.promptStreaming === 'function') {
    for await (const chunk of session.promptStreaming(text)) {
      firstAt ??= now();
      // starsze buildy strumieniują cały tekst, nowsze — przyrosty
      output = (chunk.length > output.length && chunk.startsWith(output)) ? chunk : output + chunk;
    }
  } else {
    output = await session.prompt(text);
  }
  const end = now();
  const { tokens, measured } = await countTokens(session, output);
  const decodeMs = firstAt === null ? null : end - firstAt;
  const decodeTokPerS = decodeMs > 0 && tokens > 1 ? (tokens - 1) / (decodeMs / 1000) : null;
  return { output, tokens, measured, totalMs: end - t0, ttftMs: firstAt === null ? null : firstAt - t0,
    decodeMs, decodeTokPerS, overallTokPerS: end > t0 ? tokens / ((end - t0) / 1000) : null };
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function formatPromptMetrics({ legacy, samplingMode, samplingRead, createMs, runs }) {
  const lines = ['── Pomiar ──'];
  if (legacy) {
    lines.push('samplingMode: nie dotyczy (stara przestrzeń window.ai.languageModel)');
  } else if (samplingMode) {
    lines.push(`samplingMode: '${samplingMode}' — ${samplingRead
      ? 'przeglądarka przyjęła opcję'
      : 'przeglądarka ZIGNOROWAŁA opcję (MTP się nie włączy; patrz opis wyżej)'}`);
  } else {
    lines.push('samplingMode: domyślny (próbkowanie — MTP nie działa)');
  }
  lines.push(`Tworzenie sesji: ${secs(createMs)} (z pobieraniem modelu, jeśli trwało)`);
  runs.forEach((run, i) => {
    const decode = run.decodeTokPerS === null ? '' : ` · dekodowanie ${num(run.decodeTokPerS)} tok/s`;
    const ttft = run.ttftMs === null ? '' : ` · TTFT ${secs(run.ttftMs)}`;
    lines.push(`#${i + 1}: ${run.tokens} tok${ttft}${decode} · całość ${secs(run.totalMs)}`);
  });
  const warm = runs.length > 1 ? runs.slice(1) : runs;
  const rates = warm.map(run => run.decodeTokPerS).filter(Number.isFinite);
  const range = runs.length > 1 ? `przebiegi 2–${runs.length}` : 'jeden przebieg — pierwszy bywa zimny';
  const overall = warm.map(run => run.overallTokPerS).filter(Number.isFinite);
  if (rates.length) lines.push(`Ciepłe dekodowanie (mediana, ${range}): ${num(median(rates))} tok/s`);
  else if (overall.length) lines.push(`Bez strumieniowania: ${num(median(overall))} tok/s łącznie z prefill`);
  lines.push(`Opóźnienie odpowiedzi (mediana, ${range}): ${secs(median(warm.map(run => run.totalMs)))}`);
  lines.push(runs.every(run => run.measured)
    ? 'Tokeny policzone tokenizerem sesji (measureContextUsage/measureInputUsage).'
    : 'Tokeny ≈ szacunek (znaki/4) — ta przeglądarka nie wystawia tokenizera.');
  return lines.join('\n');
}

const DECISION_SCHEMA = {
  context: 'Comment box tone check: how will other readers perceive the comment the user is about to post?',
  questions: [
    { id: 'tone', type: 'choice', prompt: 'How will other readers perceive the tone of this comment?',
      options: [
        { label: 'positive', description: 'Friendly, appreciative, encouraging or supportive.' },
        { label: 'neutral', description: 'Factual, informational, or a calm question, with no strong emotion.' },
        { label: 'negative', description: 'Critical, dismissive, sarcastic, complaining or harsh, but without insults or slurs.' },
        { label: 'toxic', description: 'Contains insults, name-calling, slurs, threats, harassment or hateful language aimed at people.' },
      ] },
    { id: 'contains_pii', type: 'boolean',
      prompt: 'Does the comment contain personal contact info (email, phone, address), API keys or passwords?' },
  ],
};

const pct = value => typeof value === 'number' ? `${Math.round(value * 100)}%` : '?';

function formatDecision(result) {
  const { tone, contains_pii: pii } = result ?? {};
  // Explainer zwraca mapę { label: p }; polyfill WebAI — tablicę [{ label, probability }].
  const raw = tone?.probabilities ?? {};
  const entries = Array.isArray(raw) ? raw.map(item => [item?.label, item?.probability]) : Object.entries(raw);
  const probs = entries.map(([label, p]) => `${label} ${pct(p)}`).join(' · ');
  const lines = [`Ton: ${tone?.label ?? '?'} (pewność ${pct(tone?.confidence)})`];
  if (probs) lines.push(`  ${probs}`);
  lines.push(`Dane wrażliwe: ${pii?.label === 'true' ? 'tak' : pii?.label === 'false' ? 'nie' : '?'} (pewność ${pct(pii?.confidence)})`);
  return lines.join('\n');
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function formatSimilarity(base, others, result) {
  const vectors = (result?.embeddings ?? []).map(e => e?.values);
  const [baseVector, ...rest] = vectors;
  if (!baseVector?.length) return 'Model nie zwrócił wektora.';
  const rows = others
    .map((text, i) => ({ text, score: rest[i]?.length ? cosineSimilarity(baseVector, rest[i]) : NaN }))
    .sort((a, b) => (b.score || -2) - (a.score || -2))
    .map(({ text, score }) => `  ${Number.isFinite(score) ? score.toFixed(2) : '?'}  ${text}`);
  return [`Wektor: ${baseVector.length} wymiarów`, `Podobieństwo (cosinus) do: „${base}"`, ...rows].join('\n');
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
      <br><br>Na web parametr <code>samplingMode</code> pozostaje osobnym origin trial, przedłużonym do Chrome 159
      (Chrome Status wpisuje wydanie na Chrome 160 — bez potwierdzenia). Tryb rozumowania
      (<code>thinkingEffort</code>) jest dopiero na etapie Intent to Prototype.
      <br><br><strong>MTP (Multi-Token Prediction) dla Gemma 4 — developer trial w Chrome Canary (flagi są też w Chrome 156 Stable).</strong>
      Mały model-szkic proponuje kilka tokenów naraz, a Gemma 4 sprawdza je równolegle; Google podaje
      +20–30% szybsze ciepłe dekodowanie. Działa tylko w sesjach zachłannych, czyli
      z <code>samplingMode: 'most-predictable'</code> — demo poniżej ustawia je domyślnie.
      Porównanie przed/po: <code>chrome://flags/#on-device-model-speculative-decoding</code> włączone (MTP),
      a jako punkt odniesienia wyłączone przy włączonym <code>chrome://flags/#gemma4-for-built-in-ai</code>.
      Uwaga: w Chrome 156 Stable i 158 Canary bez tokenu origin trial przeglądarka pomija
      <code>samplingMode</code> bez błędu (także w rozszerzeniach) — odczytuje je dopiero
      z flagą MTP albo z <code>chrome://flags/#enable-experimental-web-platform-features</code>.
      Przy samym <code>#gemma4-for-built-in-ai</code> opcja jest pomijana, więc dla zachłannego punktu odniesienia
      włącz też <code>#enable-experimental-web-platform-features</code>. Pomiar w demo mówi,
      czy opcja została przyjęta, i podaje TTFT, tok/s ciepłego dekodowania (mediana bez pierwszego,
      zimnego przebiegu) oraz opóźnienie odpowiedzi.
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
  samplingMode: 'most-predictable', // zachłanne dekodowanie — wymagane przez MTP
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
        { type: 'select', id: 'sampling', label: 'Próbkowanie', value: 'most-predictable', options: [
          ['most-predictable', "most-predictable — zachłanne, MTP"],
          ['default', 'domyślne (bez MTP)'],
        ] },
        { type: 'select', id: 'runs', label: 'Liczba przebiegów (pomiar)', value: '3',
          options: [['1', '1'], ['3', '3'], ['5', '5']] },
      ],
      options: v => globalThis.LanguageModel ? {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        ...(v.sampling === 'most-predictable' ? { samplingMode: 'most-predictable' } : {}),
      } : {},
      run: async (v, report) => {
        report.status('Tworzę sesję…');
        const t0 = now();
        let probe;
        return runWithSession('prompt', v, report, async session => {
          const createMs = now() - t0;
          const total = Math.max(1, Number(v.runs) || 1);
          const runs = [];
          for (let i = 0; i < total; i++) {
            report.status(`Generuję odpowiedź (${i + 1}/${total})…`);
            // clone() zaczyna od czystego kontekstu, więc przebiegi są porównywalne
            const run = typeof session.clone === 'function' ? await session.clone() : session;
            try {
              runs.push(await measurePromptRun(run, v.text));
            } finally {
              if (run !== session) run.destroy?.();
            }
          }
          const metrics = formatPromptMetrics({ legacy: !globalThis.LanguageModel, samplingMode: 'samplingMode' in probe.options ? 'most-predictable' : null,
            samplingRead: probe.read(), createMs, runs });
          return `${runs.at(-1).output}\n\n${metrics}`;
        }, options => (probe = probeOption(options, 'samplingMode')).options);
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
        if (v.source === v.target) throw inputError('Wybierz dwa różne języki.');
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
      { v: 'Chrome 157', label: 'Android: Chrome Status planuje wydanie (status Proposed — bez potwierdzenia)', state: 'future' },
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
    status: 'deprecating',
    tagline: 'Generowanie nowych treści wg zadania.',
    description: `Tworzy nowy tekst zgodny z opisanym zadaniem — np. opis produktu, e-mail,
      post. Pozwala sterować tonem, formatem i długością.
      <br><br><strong>Chrome proponuje wycofanie i usunięcie Writer API</strong> (razem z Rewriter API).
      Origin trial Chrome 137–148 pokazał, że deweloperzy wolą pisać prompty bezpośrednio w Prompt API —
      Writer był w praktyce szablonem system promptu nad tym samym modelem Gemini Nano.
      Google udostępnia <a target="_blank" rel="noopener" href="https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/writer-rewriter-polyfills">polyfill</a>, który
      odtwarza <code>window.Writer</code> na <code>LanguageModel</code> z tymi samymi szablonami promptów.
      Propozycja nie jest ostateczna — konsultacja trwa do 23 października 2026.
      Comment Vibe nie używa Writer API, więc wycofanie go nie dotyczy.`,
    versions: [
      { v: 'Origin trial 137–148', label: 'Trial zakończony bez stabilnego wydania', state: 'past' },
      { v: 'Październik 2026', label: 'Propozycja wycofania i usunięcia; polyfill na Prompt API; konsultacja do 23.10.2026', state: 'now' },
      { v: 'Kolejne wersje', label: 'Usunięcie z Chrome — data niepotwierdzona', state: 'future' },
    ],
    links: [
      { label: 'Dokumentacja: Writer API', url: 'https://developer.chrome.com/docs/ai/writer-api' },
      { label: 'Polyfill Writer/Rewriter na Prompt API (Google)', url: 'https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/writer-rewriter-polyfills' },
      { label: 'Formularz konsultacji wycofania', url: 'https://docs.google.com/forms/d/e/1FAIpQLSeyCU1PmpB6t5JtNN0qR1xDVB2iPOKxZ9Tjh4bQwOKz5JsBJw/viewform' },
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
    status: 'deprecating',
    tagline: 'Przepisywanie i zmiana tonu istniejącego tekstu.',
    description: `Przeredagowuje istniejący tekst — zmienia ton, długość lub formę.
      <br><br><strong>Chrome proponuje wycofanie i usunięcie Rewriter API</strong> (razem z Writer API).
      Powód: przepisywanie daje te same lub lepsze wyniki przez własny prompt w Prompt API.
      Dokładnie tak działa Comment Vibe od początku — przyciski „Friendlier", „Shorter" itd. to prompty
      do <code>LanguageModel</code>, więc wycofanie nas nie dotyczy.
      Dla istniejącego kodu Google udostępnia <a target="_blank" rel="noopener" href="https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/writer-rewriter-polyfills">polyfill</a>
      <code>window.Rewriter</code> na Prompt API. Propozycja nie jest ostateczna — konsultacja trwa
      do 23 października 2026.`,
    versions: [
      { v: 'Origin trial 137–148', label: 'Trial zakończony bez stabilnego wydania', state: 'past' },
      { v: 'Październik 2026', label: 'Propozycja wycofania i usunięcia; polyfill na Prompt API; konsultacja do 23.10.2026', state: 'now' },
      { v: 'Kolejne wersje', label: 'Usunięcie z Chrome — data niepotwierdzona', state: 'future' },
    ],
    links: [
      { label: 'Dokumentacja: Rewriter API', url: 'https://developer.chrome.com/docs/ai/rewriter-api' },
      { label: 'Polyfill Writer/Rewriter na Prompt API (Google)', url: 'https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/writer-rewriter-polyfills' },
      { label: 'Formularz konsultacji wycofania', url: 'https://docs.google.com/forms/d/e/1FAIpQLSeyCU1PmpB6t5JtNN0qR1xDVB2iPOKxZ9Tjh4bQwOKz5JsBJw/viewform' },
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

  // ── Decisions API (developer trial) ────────────────────────────────────────────
  {
    id: 'decisions',
    name: 'Decisions API',
    globalName: 'DecisionModel',
    status: 'dev-trial',
    tagline: '„Semantyczny if": szybkie decyzje i klasyfikacja bez generowania tekstu.',
    description: `Lokalny model „System One" (w stylu Jev i Laya): dostaje tekst i z góry
      zdefiniowane pytania (<code>boolean</code>, <code>choice</code>, <code>score</code>), a w jednym
      przebiegu zwraca wybraną opcję, <strong>prawdopodobieństwa i pewność</strong>. Nie generuje tekstu,
      więc nie może zwrócić etykiety spoza listy. Google celuje w dziesiątki–setki milisekund na zwykłym
      laptopie. Comment Vibe już z niego korzysta: gdy <code>DecisionModel</code> jest dostępne, a model pobrany,
      pewny werdykt „positive”/„neutral” zastępuje wywołanie Prompt API (pytanie z trybu Fast mode, Jev, przenosi się 1:1).
      <code>create()</code> bez gestu użytkownika przy stanie „downloadable” zwraca <code>NotAllowedError</code>.
      <br><br><strong>Developer trial od Chrome 157</strong> za flagą <code>chrome://flags/#decisions-api</code>
      (backend EmbeddingGemma V1 albo Gemma 4 na CPU). Sprawdziliśmy w Chrome 158 Dev: z flagą
      pojawia się natywne <code>DecisionModel</code> z <code>availability()</code>, <code>create()</code>,
      <code>decide()</code> i <code>destroy()</code>; w Chrome 156 Stable go nie ma (nie ma też tej flagi). Bez dostępnego
      modelu (np. wyłączone <em>On-device AI</em> w <code>chrome://settings/ai</code>) zwraca „unavailable”.
      Demo zadziała też z <a target="_blank" rel="noopener" href="https://web-ai.studio/extension">rozszerzeniem
      WebAI</a>, które dodaje <code>DecisionModel</code> na stronach z lokalnym modelem Laya (~690 MB).
      W naszym teście na 10 komentarzach (EN+PL) Laya trafiła 8/10 (pomyliła sarkazm i polską obelgę),
      a Jev w chmurze 10/10. Kształt API może się jeszcze zmienić.`,
    versions: [
      { v: 'Październik 2026', label: 'Intent to Prototype na blink-dev + explainer WICG', state: 'past' },
      { v: 'Chrome 157', label: 'Developer trial za flagą #decisions-api (desktop)', state: 'now' },
      { v: 'Kolejne wersje', label: 'Origin trial / stable — brak potwierdzonej daty', state: 'future' },
    ],
    links: [
      { label: 'Explainer: Decisions API', url: 'https://github.com/explainers-by-googlers/decisions-api' },
      { label: 'Intent to Prototype (blink-dev)', url: 'https://groups.google.com/a/chromium.org/g/blink-dev/c/X_S9ryF9VYA' },
      { label: 'Playground Decisions w Web AI Studio', url: 'https://web-ai.studio/playgrounds/decisions' },
      { label: 'Rozszerzenie WebAI (polyfill z modelem Laya)', url: 'https://web-ai.studio/extension' },
    ],
    usage: `// Wymaga chrome://flags/#decisions-api (Chrome 157+) — API może się zmienić.
const schema = {
  context: 'Comment box tone check',
  questions: [
    { id: 'tone', type: 'choice', prompt: 'How will readers perceive the tone?',
      options: [
        { label: 'positive', description: 'Friendly or supportive' },
        { label: 'neutral',  description: 'Factual, no strong emotion' },
        { label: 'negative', description: 'Critical, sarcastic or harsh' },
        { label: 'toxic',    description: 'Insults, slurs or threats' },
      ] },
    { id: 'contains_pii', type: 'boolean',
      prompt: 'Does it contain an email, phone number, API key or password?' },
  ],
};

if (await DecisionModel.availability(schema) !== 'unavailable') {
  const model = await DecisionModel.create(schema);
  const { tone, contains_pii } = await model.decide(commentText);
  // tone → { label: 'negative', confidence: 0.76, probabilities: { … } }
  if (contains_pii.label === 'true' && contains_pii.confidence > 0.8) warn();
  model.destroy();
}`,
    demo: {
      fields: [
        { type: 'textarea', id: 'text', label: 'Komentarz do oceny', value: 'Oh great, another meeting that could have been an email.' },
      ],
      options: () => DECISION_SCHEMA,
      run: async (v, report) => {
        report.status('Tworzę model decyzji…');
        return runWithSession('decisions', v, report, async model => {
          report.status('Decyduję…');
          return formatDecision(await model.decide(v.text));
        });
      },
    },
  },

  // ── Semantic Embedder API (developer trial) ─────────────────────────────────────
  {
    id: 'embedder',
    name: 'Semantic Embedder API',
    globalName: 'SemanticEmbedder',
    status: 'dev-trial',
    tagline: 'Wektory znaczenia (embeddingi) tekstu, liczone lokalnie.',
    description: `Zamienia tekst na wektor liczb (<code>Float32Array</code>), który opisuje jego
      <strong>znaczenie</strong>. Teksty o podobnym sensie dają podobne wektory, nawet gdy nie mają
      wspólnych słów — to podstawa wyszukiwania semantycznego, grupowania, wykrywania duplikatów
      i lokalnego RAG. Nie generuje tekstu. Jedno wywołanie <code>embed()</code> przyjmuje tekst albo
      tablicę tekstów (batch); długie dokumenty trzeba samemu podzielić na fragmenty.
      <br><br><strong>Wczesna propozycja Google</strong> (explainer, bez zgody na wydanie). Od Chrome 155
      Stable działa za flagą <code>chrome://flags/#semantic-embedder-api</code> (w 156 Stable też jest) — sprawdziliśmy w 155:
      model pobrał się w ~10 s, wektor ma 768 wymiarów, a <code>embed()</code> trwa ~130–300 ms na CPU.
      Kształt wyniku i opcje mogą się jeszcze zmienić.`,
    versions: [
      { v: 'Explainer', label: 'Wczesny szkic zespołu Chrome Built-in AI — bez zgody na wydanie', state: 'past' },
      { v: 'Chrome 155', label: 'Developer trial za flagą #semantic-embedder-api', state: 'now' },
      { v: 'Kolejne wersje', label: 'Origin trial / stable — brak potwierdzonej daty', state: 'future' },
    ],
    links: [
      { label: 'Explainer: Semantic Embedder API', url: 'https://github.com/explainers-by-googlers/semantic-embedder-api' },
      { label: 'Dyskusja i zgłoszenia (GitHub issues)', url: 'https://github.com/explainers-by-googlers/semantic-embedder-api/issues' },
      { label: 'Playground Semantic Embedder w Web AI Studio', url: 'https://web-ai.studio/playgrounds/semantic-embedder' },
    ],
    usage: `// Wymaga chrome://flags/#semantic-embedder-api — API może się zmienić.
if (await SemanticEmbedder.availability() !== 'unavailable') {
  const embedder = await SemanticEmbedder.create();
  const { embeddings } = await embedder.embed([
    'The quick brown fox jumps over the lazy dog.',
    'A fast, dark-colored fox leaps over a resting hound.',
  ]);
  const [a, b] = embeddings.map(e => e.values); // Float32Array(768)
  console.log(cosineSimilarity(a, b));         // ~0.8 — podobny sens
  embedder.destroy();
}`,
    demo: {
      fields: [
        { type: 'textarea', rows: 2, id: 'base', label: 'Zdanie bazowe', value: 'The quick brown fox jumps over the lazy dog.' },
        { type: 'textarea', id: 'others', label: 'Zdania do porównania (jedno w wierszu)', rows: 4,
          value: 'A fast, dark-colored fox leaps over a resting hound.\nSzybki lis przeskakuje nad leniwym psem.\nQuarterly tax filing deadlines are approaching.' },
      ],
      run: async (v, report) => {
        const others = String(v.others ?? '').split('\n').map(line => line.trim()).filter(Boolean);
        if (!String(v.base ?? '').trim() || !others.length) throw inputError('Podaj zdanie bazowe i co najmniej jedno do porównania.');
        report.status('Tworzę embedder…');
        return runWithSession('embedder', v, report, async embedder => {
          report.status('Liczę wektory…');
          return formatSimilarity(v.base, others, await embedder.embed([v.base, ...others]));
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
      <strong>Chrome 156 jest stabilny, ale WebMCP nadal jest origin trial</strong> (przedłużonym do Chrome 162) — numer
      przeglądarki nie oznacza stabilności API. Wykrycie <code>registerTool</code> nie potwierdza
      obecności agenta. To wpis informacyjny, bez dema; agent może korzystać z usług sieciowych.`,
    versions: [
      { v: 'Chrome 149', label: 'Origin trial (od czerwca 2026) — wcześniej tylko za flagą', state: 'past' },
      { v: 'Chrome 150', label: 'navigator.modelContext wycofywane na rzecz document.modelContext', state: 'past' },
      { v: 'Chrome 153', label: 'Anulowanie przez execute(input, { signal }); wyrejestrowanie nie przerywa aktywnych wywołań.', state: 'past' },
      { v: 'Chrome 156', label: 'Origin trial przedłużony do Chrome 162. API nadal w trial.', state: 'now' },
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

// Zewnętrzne zasoby pokazywane w zakładce „Przegląd" (sekcja „Zasoby").
const RESOURCES = [
  { group: 'Google — dokumentacja', items: [
    { label: 'Built-in AI: status wszystkich API', url: 'https://developer.chrome.com/docs/ai/built-in-apis',
      note: 'Oficjalna tabela statusów i wersji.' },
    { label: 'Pierwsze kroki i wymagania sprzętowe', url: 'https://developer.chrome.com/docs/ai/get-started',
      note: 'Wymagania i pobieranie modeli. Przełącznik On-device AI: chrome://settings/ai.' },
    { label: 'Polyfille Writer/Rewriter', url: 'https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/writer-rewriter-polyfills',
      note: 'Writer i Rewriter zbudowane na Prompt API.' },
  ] },
  { group: 'Web AI Studio — Étienne Noël (zespół Chrome)', items: [
    { label: 'Web AI Studio', url: 'https://web-ai.studio/',
      note: 'Większy „brat" tego playgroundu: czat, tłumaczenia, pomoc w pisaniu, dema.' },
    { label: 'Playgroundy API', url: 'https://web-ai.studio/playgrounds/prompt',
      note: 'Wszystkie API, w tym Decisions, Semantic Embedder i Web Speech.' },
    { label: 'Analiza sprzętu konsumenckiego', url: 'https://web-ai.studio/dashboards/consumer-hardware-analysis',
      note: 'Jaki sprzęt uciągnie jaki rozmiar modelu i z jaką szybkością.' },
    { label: 'Best practices', url: 'https://web-ai.studio/best-practices',
      note: 'Sesje, streaming, structured output, wydajność, UX.' },
    { label: 'Rozszerzenie WebAI', url: 'https://web-ai.studio/extension',
      note: 'Panel DevTools i polyfill DecisionModel z lokalnym modelem Laya.' },
  ] },
];

// Krótkie wskazówki produkcyjne dla każdego API (zakładka API → „Wskazówki").
const TIPS = {
  prompt: [
    'Wywołuj <code>availability()</code> z tymi samymi opcjami (<code>expectedInputs</code>, języki), których użyjesz w <code>create()</code> — inaczej wynik może się nie zgadzać.',
    'Przygotuj sesję w dobrym momencie, np. gdy użytkownik wejdzie w pole tekstowe, a nie przy ładowaniu strony. Pobranie modelu wymaga gestu użytkownika.',
    'Instrukcje systemowe podaj w <code>initialPrompts</code> przy <code>create()</code>; przy wielu podobnych zapytaniach używaj <code>session.clone()</code> zamiast budować sesję od zera.',
    'Gdy potrzebujesz JSON-a, przekaż <code>responseConstraint</code> (JSON Schema) zamiast prosić o format w treści promptu.',
    'Długie odpowiedzi strumieniuj przez <code>promptStreaming()</code> i wstawiaj jako tekst (<code>textContent</code>), nie przez <code>innerHTML</code>.',
    'Przerywaj nieaktualne zapytania przez <code>AbortController</code> (<code>{ signal }</code>) i zwalniaj nieużywane sesje <code>destroy()</code>. Comment Vibe anuluje poprzednią analizę przy każdej zmianie tekstu.',
  ],
  summarizer: [
    'Wspólny kontekst (np. „artykuł techniczny dla programistów") podaj raz w <code>sharedContext</code>, a szczegóły per wywołanie w <code>context</code>.',
    '<code>type</code> (<code>key-points</code>, <code>tldr</code>, <code>teaser</code>, <code>headline</code>), <code>format</code> i <code>length</code> ustawiasz przy <code>create()</code> — zmiana wymaga nowej instancji.',
    'Długie dokumenty dziel na fragmenty i streszczaj streszczenia; rozmiar wejścia sprawdzisz <code>measureInputUsage()</code>.',
    'Przy dłuższych tekstach użyj <code>summarizeStreaming()</code>, żeby użytkownik od razu widział postęp.',
  ],
  translator: [
    'Dostępność i pobranie modelu zależą od <strong>pary języków</strong> — sprawdzaj <code>availability()</code> dla konkretnej pary, którą chcesz tłumaczyć.',
    'Gdy nie znasz języka źródłowego, najpierw użyj Language Detector API.',
    'Tłumacz akapitami albo przez <code>translateStreaming()</code> — krótsze fragmenty to szybsza pierwsza odpowiedź.',
  ],
  detector: [
    'Bardzo krótkie teksty (kilka słów) dają niską pewność — porównuj <code>confidence</code> z progiem, zamiast ślepo brać pierwszy wynik.',
    'Wynik to lista kandydatów posortowana od najbardziej prawdopodobnego; <code>und</code> oznacza język nieokreślony.',
    'Jeśli spodziewasz się konkretnych języków, podaj <code>expectedInputLanguages</code> przy <code>create()</code>.',
  ],
  writer: [
    'Chrome proponuje usunięcie Writer API — nowy kod pisz od razu na Prompt API albo na polyfillu Google.',
    'Wspólne tło zadania podaj w <code>sharedContext</code>, a szczegóły w <code>context</code> konkretnego wywołania.',
    'Pokazuj wygenerowany tekst jako propozycję, którą użytkownik może edytować lub odrzucić.',
  ],
  rewriter: [
    'Chrome proponuje usunięcie Rewriter API — przepisywanie zrób własnym promptem w Prompt API (jak Comment Vibe) albo polyfillem.',
    'Pokaż wersję przed i po oraz daj łatwe „cofnij" — przepisywanie zmienia tekst użytkownika.',
    'Przy dłuższych tekstach używaj <code>rewriteStreaming()</code>.',
  ],
  proofreader: [
    'Pokazuj <code>corrections</code> jako sugestie do zaakceptowania, zamiast od razu nadpisywać tekst użytkownika.',
    'Uruchamiaj korektę z opóźnieniem (debounce) po przerwie w pisaniu, a nie po każdym znaku.',
    'Podaj <code>expectedInputLanguages</code> i sprawdzaj <code>availability()</code> — obsługa języków może być ograniczona.',
  ],
  decisions: [
    'Patrz na <code>confidence</code>, nie tylko na <code>label</code>: przy niskiej pewności albo małej różnicy między dwiema pierwszymi opcjami pokaż stan neutralny zamiast pewnego werdyktu.',
    'Opisy opcji (<code>description</code>) to cała instrukcja dla modelu — pisz je krótko, konkretnie i tak, żeby się nie nakładały.',
    'Zadawaj kilka pytań w jednym schemacie: jedno <code>decide()</code> odpowiada na wszystkie (np. ton i dane wrażliwe naraz).',
    'API jest prototypem — zawsze rób feature detection i miej fallback (Prompt API albo prostsze reguły).',
  ],
  embedder: [
    'Wektory z różnych modeli (albo wersji modelu) nie są porównywalne — zapisuj, czym je policzono, i przelicz bazę po zmianie modelu.',
    'Wiele tekstów przekazuj jako tablicę w jednym <code>embed()</code>; batch jest szybszy niż osobne wywołania.',
    'API nie dzieli tekstu samo — długie dokumenty podziel na fragmenty (explainer podaje limit ok. 2048 tokenów).',
    'Próg podobieństwa dobierz na własnych danych. W naszym teście parafraza dała 0,80, inny temat 0,25, a polskie tłumaczenie tylko 0,51.',
  ],
  webmcp: [
    'Nazwa, opis i <code>inputSchema</code> narzędzia to jedyne, co widzi agent — opisuj je precyzyjnie i konkretnie.',
    'Przekazuj <code>signal</code> z <code>execute(input, { signal })</code> do <code>fetch()</code>, żeby anulowanie przerywało pracę w toku.',
    'Akcje nieodwracalne (zakup, usunięcie) potwierdzaj z użytkownikiem, zamiast wykonywać je od razu.',
  ],
};
for (const api of APIS) api.tips = TIPS[api.id] ?? [];

// Metadane statusów (z dokumentacji) i wyników live-check (z Twojej przeglądarki).
const STATUS_META = {
  'stable':       { label: 'Stabilne', cls: 'st-stable' },
  'stable-ext':   { label: 'Stabilne (rozszerzenia) · OT (web)', cls: 'st-stable' },
  'origin-trial': { label: 'Origin Trial', cls: 'st-ot' },
  'dev-trial':    { label: 'Developer Trial', cls: 'st-dev' },
  'epp':          { label: 'Early Preview Program', cls: 'st-epp' },
  'deprecating':  { label: 'Planowane wycofanie', cls: 'st-dev' },
  'prototype':    { label: 'Prototyp (Intent to Prototype)', cls: 'st-neutral' },
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

// Firefox: stan lokalnego AI (zakładka „Firefox"). Firefox nie ma tych API na
// stronach WWW — lokalne AI jest tylko dla rozszerzeń (browser.trial.ml), więc
// dema na żywo są w osobnym rozszerzeniu playground-firefox/.
const FIREFOX_STATUS = {
  verifiedAt: '2026-10-20',
  release: 158,
  beta: 159,
  nightly: 160,
  esr: '153.5.0esr',
  docs: 'https://firefox-source-docs.mozilla.org/toolkit/components/ml/extensions.html',
  playgroundUrl: 'https://github.com/dzienisz/comment-vibe/tree/main/playground-firefox',
  webApis: [
    { api: 'Prompt API (LanguageModel)', position: 'negative', issue: 1213 },
    { api: 'Translator', position: 'negative', issue: 1015 },
    { api: 'Summarizer, Writer, Rewriter', position: 'negative', issue: 1067 },
    { api: 'Language Detector', position: 'open', issue: 1219 },
    { api: 'WebNN (navigator.ml)', position: 'positive', issue: 1215 },
  ],
  tasks: [
    'text-classification', 'token-classification', 'question-answering', 'fill-mask',
    'summarization', 'translation', 'text2text-generation', 'text-generation',
    'zero-shot-classification', 'feature-extraction', 'image-to-text', 'image-classification',
    'image-segmentation', 'zero-shot-image-classification', 'object-detection',
    'zero-shot-object-detection', 'document-question-answering', 'image-to-image',
    'depth-estimation', 'image-feature-extraction', 'text-to-speech', 'text-to-audio',
  ],
};

const POSITION_META = {
  negative: { label: 'Mozilla: negatywne stanowisko', cls: 'av-no' },
  open:     { label: 'Mozilla: brak decyzji', cls: 'av-pending' },
  positive: { label: 'Mozilla: pozytywne, niewdrożone', cls: 'av-dl' },
};

// Edge: stan wbudowanego AI (zakładka „Edge"). Edge ma te same globalne obiekty
// co Chrome, więc dema z tego środowiska działają w Edge, gdy API jest włączone.
// Źródło: dokumentacja Microsoft Edge (web-platform) i noty wydań 147–156.
const EDGE_STATUS = {
  verifiedAt: '2026-10-20',
  stable: 155,
  beta: 156,
  nextStableDate: '2026-10-22',
  dev: 157,
  canary: 158,
  docs: 'https://learn.microsoft.com/microsoft-edge/web-platform/prompt-api',
  demos: 'https://microsoftedge.github.io/Demos/built-in-ai/',
  insider: 'https://www.microsoft.com/edge/download/insider',
  apis: [
    { id: 'prompt', state: 'preview', doc: 'prompt-api', note:
      'Canary/Dev 138+. Flaga <em>Prompt API for on-device language model</em> (wewnętrznie ' +
      '<code>edge-llm-prompt-api-for-phi-mini</code> w Stable 155, <code>edge-llm-prompt-api-for-default</code> w Dev 157). ' +
      'Origin trial był w notach Edge 149–150; <code>topK</code>/<code>temperature</code> mają osobny OT (155–156).' },
    { id: 'summarizer', state: 'insider', doc: 'writing-assistance-apis', note:
      'Włączone domyślnie w Canary/Dev od 138.0.3309.2 (developer preview); Microsoft nie opisuje Stable.' },
    { id: 'translator', state: 'default', doc: 'translator-api', note:
      'Od Edge 148, własny model tłumaczeń wbudowany w Edge (nie Phi-4-mini).' },
    { id: 'detector', state: 'default', doc: 'languagedetector-api', note:
      'Od Edge 148; od 151 rozróżnia <code>zh-Hant</code> i <code>zh-Hans</code>.' },
    { id: 'writer', state: 'preview', doc: 'writing-assistance-apis', note:
      'Canary/Dev 138+, flaga <em>Writer API for on-device language model</em> (do Edge 149: „… for Phi mini”). ' +
      'Origin trial wygasł 21.04.2026.' },
    { id: 'rewriter', state: 'preview', doc: 'writing-assistance-apis', note:
      'Canary/Dev 138+, flaga <em>Rewriter API for on-device language model</em>. Origin trial wygasł 21.04.2026.' },
    { id: 'proofreader', state: 'preview', doc: 'proofreader-api', note:
      'Canary/Dev 142+, flaga <em>Proofreader API for Phi mini</em>. Origin trial wygasł 19.05.2026.' },
    { id: 'decisions', state: 'none', note: 'Brak w dokumentacji i notach wydań Edge.' },
    { id: 'embedder', state: 'none', note: 'Brak w dokumentacji i notach wydań Edge.' },
    { id: 'webmcp', state: 'ot', note: 'Origin trial (noty wydań Edge 150–156).' },
  ],
};

const EDGE_STATE_META = {
  default: { label: '✅ Włączone domyślnie', cls: 'av-ok' },
  insider: { label: '✅ Domyślnie w Canary/Dev', cls: 'av-ok' },
  preview: { label: '🧪 Flaga, Canary/Dev', cls: 'av-dl' },
  ot:      { label: 'Origin Trial', cls: 'av-pending' },
  none:    { label: '🚫 Brak w Edge', cls: 'av-no' },
};
