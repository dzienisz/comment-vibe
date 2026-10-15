'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { API_ROOT, certificationNotes, operationIdFrom, publishToEdge } = require('../scripts/publish-edge.js');

const PRODUCT = 'd34f98f5-f9b7-42b1-bebb-98707202b21d';
const product = `${API_ROOT}/v1/products/${PRODUCT}`;

const accepted = (operationId) => ({
  status: 202,
  ok: true,
  headers: { get: (name) => (name.toLowerCase() === 'location' ? operationId : null) },
  text: async () => '',
});
const status = (body) => ({ status: 200, ok: true, json: async () => body });

function fakeApi(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, ...init });
    const queue = routes[`${init.method || 'GET'} ${url}`];
    if (!queue || queue.length === 0) throw new Error(`unexpected ${init.method || 'GET'} ${url}`);
    return queue.shift();
  };
  return { fetchImpl, calls };
}

const run = (fetchImpl, extra = {}) =>
  publishToEdge({
    productId: PRODUCT,
    clientId: 'client-id',
    apiKey: 'api-key',
    zip: Buffer.from('zip'),
    notes: 'v1.7.0',
    fetchImpl,
    sleep: async () => {},
    log: () => {},
    ...extra,
  });

const happyRoutes = () => ({
  [`POST ${product}/submissions/draft/package`]: [accepted('up-1')],
  [`GET ${product}/submissions/draft/package/operations/up-1`]: [
    status({ status: 'InProgress' }),
    status({ status: 'Succeeded' }),
  ],
  [`POST ${product}/submissions`]: [accepted(`/v1/products/${PRODUCT}/submissions/operations/pub-1`)],
  [`GET ${product}/submissions/operations/pub-1`]: [status({ status: 'Succeeded', message: 'Submitted' })],
});

test('operationIdFrom accepts a bare id or a URL path', () => {
  assert.equal(operationIdFrom('abc'), 'abc');
  assert.equal(operationIdFrom('/v1/products/p/submissions/operations/abc/'), 'abc');
  assert.throws(() => operationIdFrom(null), /no operation id/);
});

test('uploads the zip, waits for validation, then submits and waits for the publish operation', async () => {
  const { fetchImpl, calls } = fakeApi(happyRoutes());
  const result = await run(fetchImpl);
  assert.deepEqual(result, { uploadOperation: 'up-1', publishOperation: 'pub-1', message: 'Submitted' });

  const upload = calls[0];
  assert.equal(upload.headers.Authorization, 'ApiKey api-key');
  assert.equal(upload.headers['X-ClientID'], 'client-id');
  assert.equal(upload.headers['Content-Type'], 'application/zip');
  assert.equal(upload.body.toString(), 'zip');

  const submit = calls.find((c) => c.method === 'POST' && c.url === `${product}/submissions`);
  assert.deepEqual(JSON.parse(submit.body), { notes: 'v1.7.0' });
  for (const call of calls) assert.ok(call.signal instanceof AbortSignal);
});

test('requires all three credentials', async () => {
  await assert.rejects(run(async () => {}, { apiKey: '' }), /are all required/);
});

test('reports a rejected upload with its HTTP status', async () => {
  const { fetchImpl } = fakeApi({
    [`POST ${product}/submissions/draft/package`]: [
      { status: 401, ok: false, headers: { get: () => null }, text: async () => 'Unauthorized' },
    ],
  });
  await assert.rejects(run(fetchImpl), /upload request returned HTTP 401: Unauthorized/);
});

test('surfaces validation errors from a failed upload', async () => {
  const routes = happyRoutes();
  routes[`GET ${product}/submissions/draft/package/operations/up-1`] = [
    status({ status: 'Failed', errorCode: 'InvalidPackage', message: 'Bad zip', errors: [{ message: 'manifest.json missing' }] }),
  ];
  const { fetchImpl } = fakeApi(routes);
  await assert.rejects(run(fetchImpl), /Edge upload failed \[InvalidPackage\]: Bad zip\n {2}manifest.json missing/);
});

test('gives up after maxPolls instead of waiting forever', async () => {
  const routes = happyRoutes();
  routes[`GET ${product}/submissions/draft/package/operations/up-1`] = [
    status({ status: 'InProgress' }),
    status({ status: 'InProgress' }),
  ];
  const { fetchImpl } = fakeApi(routes);
  await assert.rejects(run(fetchImpl, { maxPolls: 2 }), /still in progress after 2 checks/);
});

test('times out a request that never answers', async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  await assert.rejects(run(fetchImpl, { timeoutMs: 20 }), /Edge upload request timed out after 0.02s/);
});

test('certificationNotes puts reviewer notes before the release link', () => {
  assert.equal(certificationNotes('Release v1.8.0', ' Test steps \n'), 'Test steps\n\nRelease v1.8.0');
  assert.equal(certificationNotes('Release v1.8.0', undefined), 'Release v1.8.0');
  assert.equal(certificationNotes('', ''), '');
});
