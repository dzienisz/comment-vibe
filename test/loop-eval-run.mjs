// Drives test/loop-eval.html in a real Chrome with Gemini Nano and writes results JSON.
// 1. Launch Chrome Stable with a profile that has Nano downloaded:
//    chrome --user-data-dir=<profile> --remote-debugging-port=9333 --enable-unsafe-extension-debugging
// 2. node test/loop-eval-run.mjs <out.json> [k=3] [kRewrite=2] [ids,comma,separated|''] [current|v2] [chains JSON]
// No dependencies: Node 22+ built-in WebSocket.
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.CDP_PORT || 9333);
const [out = 'loop-eval-results.json', k = '3', kRewrite = '2', ids = '', variant = 'current', chains = ''] = process.argv.slice(2);
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (!msg.id) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  };
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    close: () => ws.close(),
  };
}

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const browser = await connect(version.webSocketDebuggerUrl);
const { id: extId } = await browser.send('Extensions.loadUnpacked', { path: repo });
const url = `chrome-extension://${extId}/test/loop-eval.html`;
await browser.send('Target.createTarget', { url });
await new Promise(r => setTimeout(r, 3000));
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = await connect(targets.find(t => t.url === url).webSocketDebuggerUrl);
const evaluate = async expression => (await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

console.log('availability:', await evaluate('LanguageModel.availability()'));
// chains: JSON array of mode arrays, e.g. '[["friendly","friendly"]]'; empty keeps the defaults.
// GUARD=1 re-checks professional/friendly rewrites and retries once if still negative/toxic.
// ANALYZER=<current|v2|v3|v4> overrides the tone checker independently of the rewrite variant.
const opts = { k: Number(k), kRewrite: Number(kRewrite), ids: ids ? ids.split(',') : null, variant, analyzer: process.env.ANALYZER || null, guard: process.env.GUARD === '1', ...(chains ? { chains: JSON.parse(chains) } : {}) };
// RECLASSIFY=<items.json> re-labels existing texts ([{ key, text }]) with analyzer `variant` instead.
const start = process.env.RECLASSIFY
  ? `loopReclassifyStart(${fs.readFileSync(process.env.RECLASSIFY, 'utf8')}, ${JSON.stringify({ analyzer: variant, k: Number(k) })})`
  : `loopEvalStart(${JSON.stringify(opts)})`;
await evaluate(`${start}; 'started'`);
for (;;) {
  await new Promise(r => setTimeout(r, 15000));
  const state = JSON.parse(await evaluate('JSON.stringify(loopEvalState)'));
  fs.writeFileSync(out, JSON.stringify(state, null, 2));
  console.log(`${new Date().toISOString()} ${state.done}/${state.total}${state.error ? ' ERROR ' + state.error : ''}`);
  if (!state.running) break;
}
page.close();
browser.close();
