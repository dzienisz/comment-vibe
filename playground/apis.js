'use strict';

// ── Dane wszystkich wbudowanych API AI w Chrome ───────────────────────────────
// Stan na czerwiec 2026. Źródło: https://developer.chrome.com/docs/ai/built-in-apis
//
// Każdy wpis opisuje jedno API: status z dokumentacji, historię wersji, linki,
// przykład użycia oraz konfigurację interaktywnego demo (pola + funkcja `run`).
// `run(values, report)` jest wywoływane po kliknięciu „Uruchom":
//   report.status(text)     – komunikat o postępie
//   report.progress(0..1)   – postęp pobierania modelu
// i zwraca tekst do wyświetlenia (lub rzuca błąd, który zostanie pokazany).

// Helper: podpina podgląd pobierania modelu do opcji create({ monitor }).
const dl = report => m =>
  m.addEventListener('downloadprogress', e => report.progress(e.loaded));

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
      Możliwości multimodalne (obraz / dźwięk na wejściu) są na razie dostępne tylko dla uczestników
      Early Preview Program.`,
    versions: [
      { v: 'Chrome 127', label: 'Pierwsze wydanie za flagą (wczesny dostęp / origin trial)', state: 'past' },
      { v: 'Chrome 138', label: 'Stabilne dla rozszerzeń', state: 'past' },
      { v: 'Chrome 148', label: 'Stabilne także dla otwartego web (bez flag/tokenu)', state: 'now' },
    ],
    links: [
      { label: 'Dokumentacja: Prompt API', url: 'https://developer.chrome.com/docs/ai/prompt-api' },
      { label: 'Pierwsze kroki z wbudowanym AI', url: 'https://developer.chrome.com/docs/ai/get-started' },
    ],
    usage: `const session = await LanguageModel.create({
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
        { type: 'textarea', id: 'text', label: 'Twój prompt',
          value: 'Napisz krótkie, miłe powitanie dla widzów mojego kanału na YouTube.' },
      ],
      run: async (v, report) => {
        report.status('Tworzę sesję…');
        const session = await LanguageModel.create({ monitor: dl(report) });
        report.status('Generuję odpowiedź…');
        const out = await session.prompt(v.text);
        session.destroy?.();
        return out;
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
      Działa wyłącznie w trybie tekst → tekst.`,
    versions: [
      { v: 'Chrome 138', label: 'Stabilne (web + rozszerzenia)', state: 'now' },
    ],
    links: [
      { label: 'Dokumentacja: Summarizer API', url: 'https://developer.chrome.com/docs/ai/summarizer-api' },
    ],
    usage: `const summarizer = await Summarizer.create({
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
          value: 'Wbudowane w Chrome API AI pozwalają uruchamiać model Gemini Nano bezpośrednio w przeglądarce, bez wysyłania danych na serwer. Dzięki temu deweloperzy mogą budować funkcje oparte na AI z zachowaniem prywatności użytkownika, niższym kosztem i działające także offline. Część API jest już stabilna, część wciąż w fazie testów.' },
      ],
      run: async (v, report) => {
        report.status('Tworzę summarizer…');
        const s = await Summarizer.create({ type: v.type, length: v.length, monitor: dl(report) });
        report.status('Streszczam…');
        const out = await s.summarize(v.text);
        s.destroy?.();
        return out;
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
      run: async (v, report) => {
        if (v.source === v.target) throw new Error('Wybierz dwa różne języki.');
        report.status('Tworzę tłumacza…');
        const t = await Translator.create({ sourceLanguage: v.source, targetLanguage: v.target, monitor: dl(report) });
        report.status('Tłumaczę…');
        const out = await t.translate(v.text);
        t.destroy?.();
        return out;
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
        const d = await LanguageDetector.create({ monitor: dl(report) });
        report.status('Wykrywam język…');
        const res = await d.detect(v.text);
        d.destroy?.();
        return res.slice(0, 5)
          .map(r => `${r.detectedLanguage.padEnd(8)} ${(r.confidence * 100).toFixed(1)}%`)
          .join('\n');
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
      Preview Program, dlatego w Comment Vibe go nie używam.`,
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
      run: async (v, report) => {
        report.status('Tworzę writer…');
        const w = await Writer.create({ tone: v.tone, monitor: dl(report) });
        report.status('Piszę…');
        const out = await w.write(v.text);
        w.destroy?.();
        return out;
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
      <strong>Na razie developer trial</strong>, więc czekam aż się ustabilizuje, zanim na nim oprę produkcyjną funkcję.`,
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
      run: async (v, report) => {
        report.status('Tworzę rewriter…');
        const r = await Rewriter.create({ tone: v.tone, monitor: dl(report) });
        report.status('Przepisuję…');
        const out = await r.rewrite(v.text);
        r.destroy?.();
        return out;
      },
    },
  },

  // ── Proofreader API ────────────────────────────────────────────────────────────
  {
    id: 'proofreader',
    name: 'Proofreader API',
    globalName: 'Proofreader',
    status: 'origin-trial',
    tagline: 'Korekta gramatyki, ortografii i interpunkcji.',
    description: `Interaktywna korekta tekstu — zwraca poprawioną wersję oraz listę konkretnych
      poprawek. Świetne jako warstwa „gramatyczna" nad analizą tonu. <strong>W trakcie origin
      trial</strong>, więc dostępność zależy od wersji Chrome i ewentualnego tokenu OT.`,
    versions: [
      { v: 'Origin trial 141–145', label: 'Trial zakończony; dalej w fazie testów (EPP) — brak stabilnego wydania', state: 'trial' },
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
        const p = await Proofreader.create({ monitor: dl(report) });
        report.status('Sprawdzam…');
        const res = await p.proofread(v.text);
        p.destroy?.();
        const corrected = res.correctedInput ?? res.corrected ?? '(brak pola correctedInput)';
        let out = `Poprawiony tekst:\n${corrected}`;
        const corrections = res.corrections ?? [];
        if (corrections.length) {
          out += `\n\nPoprawki (${corrections.length}):\n` +
            corrections.map((c, i) => `${i + 1}. ${JSON.stringify(c)}`).join('\n');
        }
        return out;
      },
    },
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
  'available':    { label: '✅ Dostępne i gotowe', cls: 'av-ok' },
  'downloadable': { label: '⬇️ Dostępne — model do pobrania', cls: 'av-dl' },
  'downloading':  { label: '⏳ Model się pobiera…', cls: 'av-dl' },
  'unavailable':  { label: '❌ Niedostępne na tym urządzeniu', cls: 'av-no' },
  'no-api':       { label: '🚫 Brak tego API w przeglądarce', cls: 'av-no' },
  'error':        { label: '⚠️ Błąd sprawdzania (zobacz konsolę)', cls: 'av-no' },
};
