// Re-checks every text in a loop-eval results file with the Fast mode providers.
// node test/loop-eval-cloud.mjs <results.json>   (reads SUBQ_API_KEY / TYPESAFE_API_KEY)
import fs from 'node:fs';
import { createRequire } from 'node:module';

const { jevAnalyze } = createRequire(import.meta.url)('../jev.js');
const file = process.argv[2];
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const providers = [['subq', process.env.SUBQ_API_KEY], ['typesafe', process.env.TYPESAFE_API_KEY]]
  .filter(([, key]) => key);

const texts = new Set();
for (const r of state.results) {
  texts.add(r.text);
  for (const s of r.steps) if (s.text) texts.add(s.text);
}

const cloud = state.cloud ?? {};
for (const text of texts) {
  cloud[text] ??= {};
  for (const [provider, key] of providers) {
    if (cloud[text][provider]?.sentiment) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await jevAnalyze(text, key, fetch, provider);
        cloud[text][provider] = { sentiment: r.sentiment, confidence: r.confidence };
        break;
      } catch (error) {
        cloud[text][provider] = { error: String(error?.message || error) };
        await new Promise(res => setTimeout(res, 1000));
      }
    }
  }
}
state.cloud = cloud;
fs.writeFileSync(file, JSON.stringify(state, null, 2));
console.log(`checked ${texts.size} texts with ${providers.map(p => p[0]).join(', ')}`);
