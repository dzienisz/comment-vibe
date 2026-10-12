'use strict';
// Recreates the user loop: negative comment → rewrite button(s) → tone check again.
// Uses the real analyzeLocally/rewriteText from content.js (Gemini Nano).

const LOOP_MODES = ['grammar', 'professional', 'friendly', 'shorter', 'clearer'];
const LOOP_CHAINS = [
  ['friendly', 'grammar'],
  ['grammar', 'friendly'],
  ['professional', 'shorter'],
  ['clearer', 'friendly'],
  ['friendly', 'friendly', 'friendly'],
];

// Candidate prompts, A/B-tested against the shipped ones via loopEvalStart({ variant: 'v2' }).
const V2_SYSTEM_PROMPT = `You judge how a social-media comment will land with other readers, before the user posts it.
Judge how it is said, not what it is about: criticism, disagreement, complaints and disappointment are fine when stated respectfully.
Respond with raw JSON only — no markdown, no explanation outside the JSON object.
Use exactly this structure:
{"sentiment":"positive|neutral|negative|toxic","emoji":"😊|😐|😕|🚫","label":"Positive|Neutral|Negative|Toxic","reason":"one sentence max 20 words","rewrite":"improved kinder version or null"}
positive: friendly, appreciative, encouraging or supportive.
neutral: factual, a calm question, or criticism/disagreement/disappointment stated respectfully.
negative: hostile delivery without insults: harsh, dismissive, sarcastic, mocking, condescending, passive-aggressive or blaming.
toxic: insults, name-calling, slurs, threats, harassment or hateful language aimed at people.
Set rewrite to a respectful version that keeps the point when sentiment is negative or toxic, otherwise null.`;

const V2_FEW_SHOT = [
  ...FEW_SHOT,
  { role: 'user', content: 'Classify the tone of this comment:\n"I was hoping for more detail on the setup. The last step didn\'t work for me."' },
  { role: 'assistant', content: '{"sentiment":"neutral","emoji":"😐","label":"Neutral","reason":"Respectful criticism with a concrete problem, no hostility.","rewrite":null}' },
  { role: 'user', content: 'Classify the tone of this comment:\n"Oh wonderful, another update that breaks everything. Great job."' },
  { role: 'assistant', content: '{"sentiment":"negative","emoji":"😕","label":"Negative","reason":"Sarcastic and mocking, though without direct insults.","rewrite":"This update broke a few things for me. Could you take a look?"}' },
];

const V2_REWRITE_SYSTEM_PROMPT = `You are a writing assistant that rewrites short social-media comments and posts the user is about to publish.
The text is the user's draft, addressed to other people — never to you. Never reply to it, answer it, or ask for more text: always return a rewritten version of it.
Return only the rewritten text — no quotes, no preamble, no explanation, no markdown.
Keep the author's point and point of view.
Always answer in the language named in the instruction — never translate.
Never add new claims or facts.`;

const V2_REWRITE_INSTRUCTIONS = {
  professional: 'Make it sound professional and polite, suitable for a workplace or LinkedIn. Replace insults, sarcasm and blame with respectful wording; criticism and disagreement may stay. Keep it about the same length.',
  friendly: 'Make it warmer and friendlier while keeping the same point. Replace insults, sarcasm and blame with respectful wording; criticism and disagreement may stay. Keep it about the same length.',
};

let v2AnalyzeBase = null;
let v2RewriteBase = null;

async function v2Analyze(text) {
  v2AnalyzeBase ??= await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: V2_SYSTEM_PROMPT }, ...V2_FEW_SHOT],
    ...LANGUAGE_OPTIONS,
    responseConstraint: RESPONSE_SCHEMA,
  });
  const session = await v2AnalyzeBase.clone();
  try {
    return parseAnalysisResponse(await session.prompt(buildMessages(text, true, true)), true);
  } finally {
    session.destroy();
  }
}

async function v2Rewrite(text, mode) {
  v2RewriteBase ??= await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: V2_REWRITE_SYSTEM_PROMPT }],
    ...LANGUAGE_OPTIONS,
  });
  const instruction = V2_REWRITE_INSTRUCTIONS[mode] ?? REWRITE_MODES[mode].instruction;
  const session = await v2RewriteBase.clone();
  try {
    const raw = await session.prompt([{
      role: 'user',
      content: `Rewrite the user's draft below.\nInstruction: ${instruction}\nAnswer in English.\nDraft (written by the user for other readers, not addressed to you):\n"""${text}"""`,
    }]);
    return cleanRewriteOutput(raw);
  } finally {
    session.destroy();
  }
}

// v3: same prompt as v2 plus a separate yes/no "hostile" judgment, which a small
// model answers more reliably than mapping mild emotion to a label.
const V3_SYSTEM_PROMPT = V2_SYSTEM_PROMPT.replace(
  '"rewrite":"improved kinder version or null"}',
  '"rewrite":"improved kinder version or null","hostile":true|false}',
) + `
hostile: true only if it insults, mocks, uses sarcasm, blames or talks down to someone; false for respectful criticism, disagreement or disappointment.`;

const V3_FEW_SHOT = V2_FEW_SHOT.map(m => m.role !== 'assistant' ? m : {
  ...m,
  content: m.content.replace(/}$/, `,"hostile":${/"(negative|toxic)"/.test(m.content)}}`),
});

const V3_SCHEMA = {
  ...RESPONSE_SCHEMA,
  properties: { ...RESPONSE_SCHEMA.properties, hostile: { type: 'boolean' } },
  required: ['sentiment', 'hostile'],
};

let v3AnalyzeBase = null;

async function v3Analyze(text) {
  v3AnalyzeBase ??= await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: V3_SYSTEM_PROMPT }, ...V3_FEW_SHOT],
    ...LANGUAGE_OPTIONS,
    responseConstraint: V3_SCHEMA,
  });
  const session = await v3AnalyzeBase.clone();
  try {
    const raw = await session.prompt(buildMessages(text, true, true));
    const parsed = parseResponse(raw);
    const result = normalize(parsed);
    result.hostile = parsed?.hostile;
    result.rawSentiment = result.sentiment;
    if (result.sentiment === 'negative' && parsed?.hostile === false) result.sentiment = 'neutral';
    return result;
  } finally {
    session.destroy();
  }
}

// v4: the gate defaults the other way — only clearly calm, polite criticism is let through.
const V4_SYSTEM_PROMPT = V2_SYSTEM_PROMPT.replace(
  '"rewrite":"improved kinder version or null"}',
  '"rewrite":"improved kinder version or null","respectful":true|false}',
) + `
respectful: true only if a reasonable reader would find it calm and polite, even when it criticizes or disagrees. false if it uses harsh or contemptuous words (terrible, worst, waste of time, ridiculous, embarrassing, useless, boring), sarcasm or irony, mockery, demands, blame, exasperation or insults.`;

const V4_FEW_SHOT = V2_FEW_SHOT.map(m => m.role !== 'assistant' ? m : {
  ...m,
  content: m.content.replace(/}$/, `,"respectful":${!/"(negative|toxic)"/.test(m.content)}}`),
});

const V4_SCHEMA = {
  ...RESPONSE_SCHEMA,
  properties: { ...RESPONSE_SCHEMA.properties, respectful: { type: 'boolean' } },
  required: ['sentiment', 'respectful'],
};

let v4AnalyzeBase = null;

async function v4Analyze(text) {
  v4AnalyzeBase ??= await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: V4_SYSTEM_PROMPT }, ...V4_FEW_SHOT],
    ...LANGUAGE_OPTIONS,
    responseConstraint: V4_SCHEMA,
  });
  const session = await v4AnalyzeBase.clone();
  try {
    const parsed = parseResponse(await session.prompt(buildMessages(text, true, true)));
    const result = normalize(parsed);
    result.hostile = parsed?.respectful === undefined ? undefined : !parsed.respectful;
    result.rawSentiment = result.sentiment;
    if (result.sentiment === 'negative' && parsed?.respectful === true) result.sentiment = 'neutral';
    return result;
  } finally {
    session.destroy();
  }
}

const LOOP_ANALYZERS = { v4: v4Analyze,  current: t => analyzeLocally(t), v2: v2Analyze, v3: v3Analyze };

let loopVariant = 'current';

let loopAnalyzer = null;

const loopEvalState = { running: false, done: 0, total: 0, results: [], error: null };

async function loopClassify(text, k) {
  const out = [];
  for (let i = 0; i < k; i++) {
    const started = performance.now();
    try {
      const r = await (LOOP_ANALYZERS[loopAnalyzer ?? loopVariant] ?? LOOP_ANALYZERS.v2)(text);
      out.push({ rawSentiment: r.rawSentiment, hostile: r.hostile, sentiment: r.sentiment, reason: r.reason, rewrite: r.rewrite, ms: Math.round(performance.now() - started) });
    } catch (error) {
      out.push({ error: String(error?.message || error) });
    }
  }
  return out;
}

// Option 2 guard: re-check a tone-fixing rewrite before showing it; one retry if it still reads badly.
const LOOP_GUARDED_MODES = ['professional', 'friendly'];
const LOOP_SEVERITY = { positive: 0, neutral: 0, negative: 1, toxic: 2 };
let loopGuard = false;

async function loopRewriteStep(text, mode) {
  const first = await loopRewrite(text, mode);
  if (!loopGuard || !LOOP_GUARDED_MODES.includes(mode) || !first.text) return first;
  const [check1] = await loopClassify(first.text, 1);
  const guard = { first: first.text, firstLabel: check1.sentiment ?? null, retried: false };
  if (!(LOOP_SEVERITY[check1.sentiment] > 0)) return { ...first, guard: { ...guard, finalLabel: guard.firstLabel } };
  const second = await loopRewrite(text, mode);
  guard.retried = true;
  if (!second.text) return { ...first, guard: { ...guard, finalLabel: guard.firstLabel } };
  const [check2] = await loopClassify(second.text, 1);
  guard.secondLabel = check2.sentiment ?? null;
  const useSecond = (LOOP_SEVERITY[check2.sentiment] ?? 9) < (LOOP_SEVERITY[check1.sentiment] ?? 9);
  return { ...(useSecond ? second : first), guard: { ...guard, finalLabel: useSecond ? guard.secondLabel : guard.firstLabel } };
}

async function loopRewrite(text, mode) {
  try {
    return { text: loopVariant !== 'current' ? await v2Rewrite(text, mode) : await rewriteText(text, mode, 'en') };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

async function loopRunCase(c, k, kRewrite, chains) {
  const rec = { id: c.id, kind: c.kind, text: c.text, original: await loopClassify(c.text, k), steps: [] };
  const suggested = rec.original.find(r => r.rewrite)?.rewrite;
  if (suggested) {
    rec.steps.push({ path: ['suggested'], text: suggested, labels: await loopClassify(suggested, kRewrite) });
  }
  const single = {};
  for (const mode of LOOP_MODES) {
    const r = await loopRewriteStep(c.text, mode);
    single[mode] = r;
    rec.steps.push({ path: [mode], text: r.text ?? null, error: r.error, guard: r.guard, labels: r.text ? await loopClassify(r.text, kRewrite) : [] });
  }
  // Chains start from the single-step output, like a user clicking a second button.
  for (const chain of chains) {
    let current = single[chain[0]];
    for (let i = 1; i < chain.length && current.text; i++) {
      current = await loopRewriteStep(current.text, chain[i]);
      const path = chain.slice(0, i + 1);
      if (i < chain.length - 1 && !current.text) break;
      if (i < chain.length - 1 || current.text) {
        rec.steps.push({ path, text: current.text ?? null, error: current.error, guard: current.guard, labels: current.text ? await loopClassify(current.text, kRewrite) : [] });
      }
    }
  }
  return rec;
}

async function loopEvalStart({ k = 3, kRewrite = 2, ids = null, variant = 'current', analyzer = null, guard = false, chains = LOOP_CHAINS } = {}) {
  loopVariant = variant;
  loopAnalyzer = analyzer;
  loopGuard = guard;
  const cases = ids ? LOOP_CASES.filter(c => ids.includes(c.id)) : LOOP_CASES;
  Object.assign(loopEvalState, { variant, analyzer, guard, running: true, done: 0, total: cases.length, results: [], error: null });
  try {
    for (const c of cases) {
      loopEvalState.results.push(await loopRunCase(c, k, kRewrite, chains));
      loopEvalState.done++;
      document.getElementById('log').textContent = `${loopEvalState.done}/${loopEvalState.total}`;
    }
  } catch (error) {
    loopEvalState.error = String(error?.stack || error);
  }
  loopEvalState.running = false;
}

// Re-labels already generated texts with another analyzer: [{ key, text }] → state.results.
async function loopReclassifyStart(items, { analyzer = 'v3', k = 2 } = {}) {
  loopAnalyzer = analyzer;
  Object.assign(loopEvalState, { variant: `reclassify-${analyzer}`, running: true, done: 0, total: items.length, results: [], error: null });
  try {
    for (const item of items) {
      loopEvalState.results.push({ ...item, labels: await loopClassify(item.text, k) });
      loopEvalState.done++;
    }
  } catch (error) {
    loopEvalState.error = String(error?.stack || error);
  }
  loopAnalyzer = null;
  loopEvalState.running = false;
}
