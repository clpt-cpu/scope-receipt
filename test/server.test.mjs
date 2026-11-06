import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server/app.mjs';
import { analyzeNotes } from '../src/domain/review.mjs';
import { sampleProject } from '../src/domain/sample.mjs';

const model = JSON.parse(await readFile(new URL('../src/model/model.json', import.meta.url), 'utf8'));
function input() {
  const row = analyzeNotes(model, sampleProject.notes)[1];
  return { projectName: sampleProject.name, quote: 'Q-019', date: '2026-10-31', notes: sampleProject.notes, allReviewed: true,
    selections: [{ id: row.id, sourceHash: row.sourceHash, description: row.description, quantity: row.quantity, unitAmount: row.unitAmount }] };
}
async function withServer(options, callback) {
  const server = createServer(createApp({ model, ...options }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data, reqOrigin = origin) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(reqOrigin ? { Origin: reqOrigin } : {}) }, body: JSON.stringify(data) });
  try { await callback({ origin, post }); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('the default server has no connected payment client and refuses sandbox mutation', async () => withServer({}, async ({ origin, post }) => {
  const status = await (await fetch(`${origin}/api/status`)).json(); assert.equal(status.draftCreationEnabled, false);
  assert.equal((await post('/api/sandbox-draft', {})).status, 409);
  const preview = await (await post('/api/preview', input())).json(); assert.equal(preview.review.total, '90.00'); assert.equal(preview.sandboxAvailable, false);
}));
test('cross-origin posts are rejected before analysis or mutation', async () => withServer({}, async ({ post }) => {
  assert.equal((await post('/api/analyze', { notes: 'anything' }, 'https://other.test')).status, 403);
}));
test('a sandbox preview can be consumed only once and only with its review digest', async () => {
  let calls = 0;
  await withServer({ allowSandbox: true, paypalClient: { createDraft: async () => { calls++; return { id: 'INV2-UNIT-0001', status: 'DRAFT', environment: 'sandbox', sent: false }; } } }, async ({ post }) => {
    const preview = await (await post('/api/preview', input())).json();
    const request = { previewId: preview.previewId, reviewDigest: preview.review.digest, confirmDraft: true };
    assert.equal((await post('/api/sandbox-draft', { ...request, reviewDigest: 'wrong' })).status, 400);
    assert.equal((await post('/api/sandbox-draft', request, null)).status, 403);
    assert.equal((await post('/api/sandbox-draft', request)).status, 201);
    assert.equal((await post('/api/sandbox-draft', request)).status, 409); assert.equal(calls, 1);
  });
});
test('an uncertain remote failure locks the preview and does not leak exception text', async () => withServer({ allowSandbox: true, paypalClient: { createDraft: async () => { throw new Error('unit-private-value'); } } }, async ({ post }) => {
  const preview = await (await post('/api/preview', input())).json();
  const request = { previewId: preview.previewId, reviewDigest: preview.review.digest, confirmDraft: true };
  const response = await post('/api/sandbox-draft', request); const text = await response.text();
  assert.equal(response.status, 502); assert.ok(!text.includes('unit-private-value'));
  assert.equal((await post('/api/sandbox-draft', request)).status, 409);
}));
test('a draft the sandbox refused leaves the preview usable, says why and logs it for the owner', async () => {
  let calls = 0; const logged = [];
  await withServer({ allowSandbox: true, log: text => logged.push(text), paypalClient: { createDraft: async () => {
    if (++calls === 1) throw Object.assign(new Error('PayPal refused this draft (422 UNIT).'), { rejected: true });
    return { id: 'INV2-UNIT-0001', status: 'DRAFT', environment: 'sandbox', sent: false };
  } } }, async ({ post }) => {
    const preview = await (await post('/api/preview', input())).json();
    const request = { previewId: preview.previewId, reviewDigest: preview.review.digest, confirmDraft: true };
    const refused = await post('/api/sandbox-draft', request); const body = await refused.json();
    assert.equal(refused.status, 502); assert.equal(body.error, 'PayPal refused this draft (422 UNIT).'); assert.equal(body.retryable, true);
    assert.deepEqual(logged, ['PayPal refused this draft (422 UNIT).']);
    assert.equal((await post('/api/sandbox-draft', request)).status, 201); assert.equal(calls, 2);
  });
});
test('a lost answer stays open and repeats the same reference, so PayPal returns the original instead of a second draft', async () => {
  const references = [], logged = [];
  await withServer({ allowSandbox: true, log: text => logged.push(text), paypalClient: { createDraft: async (_, reference) => {
    references.push(reference);
    if (references.length === 1) throw Object.assign(new Error('PayPal did not answer.'), { retrySafe: true });
    return { id: 'INV2-UNIT-0001', status: 'DRAFT', environment: 'sandbox', sent: false };
  } } }, async ({ post }) => {
    const preview = await (await post('/api/preview', input())).json();
    const request = { previewId: preview.previewId, reviewDigest: preview.review.digest, confirmDraft: true };
    const lost = await post('/api/sandbox-draft', request); const body = await lost.json();
    assert.equal(lost.status, 502); assert.equal(body.retryable, true); assert.deepEqual(logged, ['PayPal did not answer.']);
    assert.equal((await post('/api/sandbox-draft', request)).status, 201);
    assert.deepEqual(references, [preview.previewId, preview.previewId]);
    assert.equal((await post('/api/sandbox-draft', request)).status, 409);
  });
});
test('the draft reply compares PayPal\'s total with the reviewed total', async () => {
  const reply = (total, currency) => ({ allowSandbox: true, paypalClient: { createDraft: async () => ({ id: 'INV2-UNIT-0001', status: 'DRAFT', environment: 'sandbox', sent: false, total, currency }) } });
  const compare = async options => { let result; await withServer(options, async ({ post }) => {
    const preview = await (await post('/api/preview', input())).json();
    result = await (await post('/api/sandbox-draft', { previewId: preview.previewId, reviewDigest: preview.review.digest, confirmDraft: true })).json();
  }); return result; };
  const same = await compare(reply('90.00', 'USD')); assert.deepEqual([same.totalMatches, same.reviewedTotal], [true, '90.00']);
  assert.equal((await compare(reply('90', 'USD'))).totalMatches, true);
  assert.equal((await compare(reply('97.20', 'USD'))).totalMatches, false);
  assert.equal((await compare(reply('90.00', 'EUR'))).totalMatches, false);
  assert.equal((await compare(reply('not a number', 'USD'))).totalMatches, false);
  assert.equal((await compare(reply(undefined, undefined))).totalMatches, null);
});
test('a body that is not an object is refused before anything reads it', async () => withServer({ allowSandbox: true, paypalClient: { createDraft: async () => ({}) } }, async ({ origin, post }) => {
  for (const data of [null, [], 'text', 1]) assert.equal((await post('/api/sandbox-draft', data)).status, 400);
  assert.equal((await fetch(`${origin}/api/health`)).status, 200);
}));
test('a malformed selection is an input error, not a crash message', async () => withServer({}, async ({ post }) => {
  const response = await post('/api/preview', { ...input(), selections: [null] });
  assert.equal(response.status, 400); assert.match((await response.json()).error, /missing or duplicated/);
}));
test('malformed JSON and oversized notes cannot produce a successful preview', async () => withServer({}, async ({ origin, post }) => {
  assert.equal((await post('/api/analyze', { notes: 'x'.repeat(30001) })).status, 400);
  assert.equal((await fetch(`${origin}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
}));
