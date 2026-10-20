'use strict';

// ── Zadania Firefox WebExtensions AI API (browser.trial.ml) ───────────────────
// Stan zweryfikowano: FIREFOX_INFO.verifiedAt. Źródło:
// https://firefox-source-docs.mozilla.org/toolkit/components/ml/extensions.html
//
// Każde zadanie to potok Transformers.js. createEngine(engine) pobiera model,
// runEngine({ args, options }) wywołuje pipeline(args..., options), a format()
// zamienia surowy wynik w czytelny tekst. Firefox pozwala pobierać modele tylko
// z własnego huba Mozilli oraz z organizacji Mozilla i Xenova na Hugging Face.

const FIREFOX_INFO = {
  verifiedAt: '2026-10-20',
  release: 158,
  beta: 159,
  nightly: 160,
  esr: '153.5.0esr',
  docs: 'https://firefox-source-docs.mozilla.org/toolkit/components/ml/extensions.html',
  examples: 'https://github.com/firefox-ai',
};

const TASKS = [
  {
    id: 'zero-shot',
    name: 'Zero-shot classification',
    taskName: 'zero-shot-classification',
    tagline: 'Dopasowanie tekstu do Twoich etykiet bez trenowania — tego używa Comment Vibe.',
    models: [
      ['Xenova/distilbert-base-uncased-mnli', 'distilbert-mnli (domyślny, angielski, mały)'],
      ['Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7', 'mDeBERTa-v3 XNLI (Comment Vibe, ~100 języków, ~340 MB)'],
    ],
    fields: [
      { id: 'text', label: 'Tekst', type: 'textarea', value: 'Thanks for the quick fix, this works great now!' },
      { id: 'labels', label: 'Etykiety (po przecinku)', type: 'text',
        value: 'friendly and appreciative, a neutral factual statement, critical or dismissive, insulting or hateful' },
      { id: 'template', label: 'Szablon hipotezy', type: 'text', value: 'This comment is {}.' },
    ],
    args: v => [v.text, splitList(v.labels)],
    options: v => ({ hypothesis_template: v.template }),
    format: out => {
      const r = Array.isArray(out) ? out[0] : out;
      return (r?.labels || []).map((label, i) => `${pct(r.scores?.[i])}  ${label}`).join('\n');
    },
  },
  {
    id: 'sentiment',
    name: 'Text classification',
    taskName: 'text-classification',
    tagline: 'Klasyfikacja tekstu, np. sentyment POSITIVE / NEGATIVE.',
    models: [['Xenova/distilbert-base-uncased-finetuned-sst-2-english', 'distilbert SST-2 (domyślny, angielski)']],
    fields: [{ id: 'text', label: 'Tekst', type: 'textarea', value: 'I was skeptical, but this update is genuinely useful.' }],
    args: v => [v.text],
    options: () => ({}),
    format: out => [].concat(out).map(r => `${pct(r?.score)}  ${r?.label}`).join('\n'),
  },
  {
    id: 'ner',
    name: 'Token classification (NER)',
    taskName: 'token-classification',
    tagline: 'Rozpoznawanie nazw własnych: osoby, organizacje, miejsca — wielojęzycznie.',
    models: [['Xenova/bert-base-multilingual-cased-ner-hrl', 'mBERT NER HRL (domyślny, wielojęzyczny)']],
    fields: [{ id: 'text', label: 'Tekst', type: 'textarea', value: 'Kamil z Warszawy testuje Firefoksa od Mozilli.' }],
    args: v => [v.text],
    options: () => ({}),
    format: out => [].concat(out).map(t => `${t?.entity ?? t?.entity_group}  ${t?.word}  ${pct(t?.score)}`).join('\n'),
  },
  {
    id: 'qa',
    name: 'Question answering',
    taskName: 'question-answering',
    tagline: 'Odpowiedź wycięta z podanego kontekstu (extractive QA).',
    models: [['Xenova/distilbert-base-cased-distilled-squad', 'distilbert SQuAD (domyślny, angielski)']],
    fields: [
      { id: 'question', label: 'Pytanie', type: 'text', value: 'Where does the inference run?' },
      { id: 'context', label: 'Kontekst', type: 'textarea', rows: 4,
        value: 'Firefox runs extension models in a separate inference process on your device. Models download once and are cached.' },
    ],
    args: v => [v.question, v.context],
    options: () => ({}),
    format: out => { const r = Array.isArray(out) ? out[0] : out; return `${r?.answer}  (${pct(r?.score)})`; },
  },
  {
    id: 'fill-mask',
    name: 'Fill mask',
    taskName: 'fill-mask',
    tagline: 'Model zgaduje słowo w miejscu [MASK].',
    models: [['Xenova/bert-base-uncased', 'BERT base uncased (domyślny)']],
    fields: [{ id: 'text', label: 'Tekst z [MASK]', type: 'text', value: 'Firefox is a web [MASK].' }],
    args: v => [v.text],
    options: () => ({}),
    format: out => [].concat(out).map(r => `${pct(r?.score)}  ${r?.sequence ?? r?.token_str}`).join('\n'),
  },
  {
    id: 'summarization',
    name: 'Summarization',
    taskName: 'summarization',
    tagline: 'Streszczenie dłuższego tekstu (angielski).',
    models: [['Xenova/distilbart-cnn-6-6', 'distilBART CNN 6-6 (domyślny)']],
    fields: [{ id: 'text', label: 'Tekst', type: 'textarea', rows: 6, value:
      'The tower is 324 metres (1,063 ft) tall, about the same height as an 81-storey building, and the tallest ' +
      'structure in Paris. Its base is square, measuring 125 metres (410 ft) on each side. During its construction, ' +
      'the Eiffel Tower surpassed the Washington Monument to become the tallest man-made structure in the world, ' +
      'a title it held for 41 years until the Chrysler Building in New York City was finished in 1930.' }],
    args: v => [v.text],
    options: () => ({ max_new_tokens: 80 }),
    format: out => [].concat(out).map(r => r?.summary_text).join('\n'),
  },
  {
    id: 'translation',
    name: 'Translation',
    taskName: 'translation',
    tagline: 'Tłumaczenie T5: prefiks „translate English to German/French/Romanian:".',
    models: [['Xenova/t5-small', 't5-small (domyślny; EN → DE/FR/RO)']],
    fields: [{ id: 'text', label: 'Tekst z prefiksem zadania', type: 'textarea',
      value: 'translate English to German: The model runs on your device.' }],
    args: v => [v.text],
    options: () => ({ max_new_tokens: 60 }),
    format: out => [].concat(out).map(r => r?.translation_text ?? r?.generated_text).join('\n'),
  },
  {
    id: 'text2text',
    name: 'Text2text generation',
    taskName: 'text2text-generation',
    tagline: 'Małe instrukcje dla Flan-T5 — nie czat, ale krótkie polecenia działają.',
    models: [['Xenova/flan-t5-small', 'Flan-T5 small (domyślny)']],
    fields: [{ id: 'text', label: 'Polecenie', type: 'textarea', value: 'Answer the question: what is the capital of Poland?' }],
    args: v => [v.text],
    options: () => ({ max_new_tokens: 40 }),
    format: out => [].concat(out).map(r => r?.generated_text).join('\n'),
  },
  {
    id: 'text-generation',
    name: 'Text generation',
    taskName: 'text-generation',
    tagline: 'Dopisywanie tekstu małym GPT-2 — pokazuje granice, nie jakość czatu.',
    models: [['Xenova/distilgpt2', 'distilGPT-2 (Xenova)']],
    fields: [{ id: 'text', label: 'Początek tekstu', type: 'textarea', value: 'On-device AI in the browser means' }],
    args: v => [v.text],
    options: () => ({ max_new_tokens: 30 }),
    format: out => [].concat(out).map(r => r?.generated_text).join('\n'),
  },
  {
    id: 'embeddings',
    name: 'Feature extraction (embeddings)',
    taskName: 'feature-extraction',
    tagline: 'Wektory zdań i ich podobieństwo kosinusowe.',
    models: [['Xenova/all-MiniLM-L6-v2', 'all-MiniLM-L6-v2 (domyślny, angielski)']],
    fields: [
      { id: 'a', label: 'Zdanie A', type: 'text', value: 'The extension runs the model locally.' },
      { id: 'b', label: 'Zdanie B', type: 'text', value: 'Inference happens on the device.' },
    ],
    args: v => [[v.a, v.b]],
    options: () => ({ pooling: 'mean', normalize: true }),
    format: out => {
      const [a, b] = tensorRows(out);
      if (!a || !b) return '';
      return `Podobieństwo kosinusowe: ${cosine(a, b).toFixed(3).replace('.', ',')} · wymiar wektora: ${a.length}`;
    },
  },
];

// ── Helpery ──────────────────────────────────────────────────────────────────

function splitList(text) {
  return String(text).split(',').map(s => s.trim()).filter(Boolean);
}

function pct(score) {
  return typeof score === 'number' ? `${Math.round(score * 100)}%`.padStart(4) : '  ? ';
}

// Opcje createEngine dla wybranego modelu.
function engineOptions(task, modelId = task.models[0][0]) {
  return { taskName: task.taskName, modelHub: 'huggingface', modelId };
}

function engineKey(options) {
  return `${options.taskName}|${options.modelId}`;
}

// Tensor po klonowaniu strukturalnym: { dims, data } albo zagnieżdżone tablice.
function tensorRows(out) {
  const t = Array.isArray(out) && !Array.isArray(out[0]) && out[0]?.data ? out[0] : out;
  if (t?.dims && t?.data) {
    const data = Array.from(t.data);
    const width = t.dims[t.dims.length - 1];
    const rows = [];
    for (let i = 0; i < data.length; i += width) rows.push(data.slice(i, i + width));
    return rows;
  }
  if (Array.isArray(t) && Array.isArray(t[0])) return t.map(row => Array.from(row));
  return [];
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// onProgress: { progress } (0–1 albo 0–100) lub { totalLoaded, total } — kształt zależy od wersji.
function progressPercent(data) {
  if (typeof data?.progress === 'number') {
    return Math.round(data.progress <= 1 ? data.progress * 100 : data.progress);
  }
  if (typeof data?.totalLoaded === 'number' && typeof data?.total === 'number' && data.total > 0) {
    return Math.round((data.totalLoaded / data.total) * 100);
  }
  return null;
}

function usageSnippet(task, values, modelId) {
  return `// manifest.json: "optional_permissions": ["trialML"]
await browser.permissions.request({ permissions: ['trialML'] }); // z kliknięcia

browser.trial.ml.onProgress.addListener(data => console.log(data));

await browser.trial.ml.createEngine(${JSON.stringify(engineOptions(task, modelId), null, 2)});

const output = await browser.trial.ml.runEngine({
  args: ${JSON.stringify(task.args(values))},
  options: ${JSON.stringify(task.options(values))},
});`;
}

// Firefox odrzuca drugie createEngine w tym samym uruchomieniu rozszerzenia.
function isAlreadyCreated(error) {
  return /already created/i.test(error?.message || '');
}

function isDisabled(error) {
  return /trial ml api is disabled/i.test(error?.message || '');
}
