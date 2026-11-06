import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server/app.mjs';
import { PayPalSandboxClient } from '../server/paypal.mjs';
import { analyzeNotes, buildReviewedInvoice, compareReadback } from '../src/domain/review.mjs';
import { sampleProject } from '../src/domain/sample.mjs';

const model = JSON.parse(await readFile(new URL('../src/model/model.json', import.meta.url), 'utf8'));
function input() {
  const rows = analyzeNotes(model, sampleProject.notes).filter(row => row.prediction.label === 'extra');
  return { projectName: sampleProject.name, quote: 'Q-019', date: '2026-11-07', notes: sampleProject.notes, allReviewed: true,
    selections: rows.map(({ id, sourceHash, description, quantity, unitAmount }) => ({ id, sourceHash, description, quantity, unitAmount })) };
}
const stored = review => ({ id: 'INV2-TEST-0001', status: 'DRAFT', currency: 'USD', total: review.total,
  items: review.payload.items.map(item => ({ name: item.name, quantity: item.quantity, unitAmount: item.unit_amount.value, currency: 'USD', description: item.description })) });

test('a readback matches only when PayPal stored every reviewed line, the total and a DRAFT status', () => {
  const review = buildReviewedInvoice(input(), model);
  assert.equal(review.total, '260.00');
  const same = compareReadback(review, 'INV2-TEST-0001', stored(review));
  assert.equal(same.allMatch, true); assert.equal(same.lines.length, 3); assert.ok(same.lines.every(line => line.matches));
  const changed = stored(review); changed.items[1] = { ...changed.items[1], quantity: '2' };
  const result = compareReadback(review, 'INV2-TEST-0001', changed);
  assert.equal(result.allMatch, false); assert.equal(result.lines[1].matches, false); assert.equal(result.lines[0].matches, true);
  const missing = stored(review); missing.items.pop();
  assert.equal(compareReadback(review, 'INV2-TEST-0001', missing).lines[2].paypal, null);
  assert.equal(compareReadback(review, 'INV2-TEST-0001', { ...stored(review), status: 'SENT' }).checks.status, false);
  assert.equal(compareReadback(review, 'INV2-TEST-0001', { ...stored(review), total: '261.00' }).checks.total, false);
  assert.equal(compareReadback(review, 'INV2-OTHER-0001', stored(review)).checks.id, false);
});

test('the PayPal client reads a draft with GET and never sends a body', async () => {
  const calls = [];
  const client = new PayPalSandboxClient({ clientId: 'fake-client', clientSecret: 'fake-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'fake-access', expires_in: 3600 });
    if (url.endsWith('INV2-MISSING-0001')) return Response.json({ name: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    return Response.json({ id: 'INV2-TEST-0001', status: 'DRAFT', amount: { currency_code: 'USD', value: '90.00' }, items: [{ name: 'Poster layout', quantity: '2', unit_amount: { currency_code: 'USD', value: '45.00' }, description: 'Source N-02 · abc' }] });
  } });
  const readback = await client.getInvoice('INV2-TEST-0001');
  assert.deepEqual(readback, { id: 'INV2-TEST-0001', status: 'DRAFT', currency: 'USD', total: '90.00', items: [{ name: 'Poster layout', quantity: '2', unitAmount: '45.00', currency: 'USD', description: 'Source N-02 · abc' }] });
  const get = calls.at(-1);
  assert.equal(get.url, 'https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-TEST-0001');
  assert.equal(get.options.method, 'GET'); assert.equal(get.options.body, undefined); assert.equal(get.options.headers.Authorization, 'Bearer fake-access');
  await assert.rejects(client.getInvoice('INV2-MISSING-0001'), /returned 404 for the readback/);
  await assert.rejects(client.getInvoice('../v1/oauth2/token'), /Invalid invoice reference/);
});

test('the readback endpoint works only after this preview created its draft', async () => {
  let reads = 0;
  const paypalClient = {
    createDraft: async () => ({ id: 'INV2-TEST-0001', status: 'DRAFT', environment: 'sandbox', sent: false, total: '260.00', currency: 'USD' }),
    getInvoice: async id => { reads++; return { ...stored(buildReviewedInvoice(input(), model)), id }; },
  };
  const server = createServer(createApp({ model, paypalClient, allowSandbox: true, log: () => {} }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data, from = origin) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from }, body: JSON.stringify(data) });
  try {
    const preview = await (await post('/api/preview', input())).json();
    assert.equal((await post('/api/sandbox-readback', { previewId: preview.previewId })).status, 409);
    assert.equal((await post('/api/sandbox-draft', { previewId: preview.previewId, reviewDigest: preview.review.digest, confirmDraft: true })).status, 201);
    assert.equal((await post('/api/sandbox-readback', { previewId: preview.previewId }, 'https://other.test')).status, 403);
    const response = await post('/api/sandbox-readback', { previewId: preview.previewId });
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.allMatch, true); assert.equal(body.id, 'INV2-TEST-0001'); assert.equal(reads, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
