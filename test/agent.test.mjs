import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server/app.mjs';
import { OllamaAgent, AGENT_SCHEMA } from '../server/agent.mjs';
import { reconcileAgentItems } from '../src/domain/agent-review.mjs';
import { buildReviewedInvoice, receiptMarkdown } from '../src/domain/review.mjs';
import { sampleProject } from '../src/domain/sample.mjs';

const model = JSON.parse(await readFile(new URL('../src/model/model.json', import.meta.url), 'utf8'));
const notes = sampleProject.thread;
// gemma4:12b-it-qat's answer for the sample thread, recorded from a local Ollama run on 2026-11-07.
const { items: recorded } = JSON.parse(await readFile(new URL('./fixtures/gemma4-sample-thread.json', import.meta.url), 'utf8'));
const byId = rows => Object.fromEntries(rows.map(row => [row.id, row]));

test('a recorded model answer becomes review rows, split per request and checked against the notes', () => {
  const { rows, ignored } = reconcileAgentItems(model, notes, recorded);
  assert.equal(ignored, 0);
  assert.deepEqual(rows.map(row => row.id), ['N-01', 'N-02', 'N-03', 'N-04a', 'N-04b', 'N-05', 'N-06', 'N-07', 'N-08']);
  const r = byId(rows);
  assert.equal(r['N-02'].prediction.label, 'extra'); assert.equal(r['N-02'].quantity, '2'); assert.equal(r['N-02'].unitAmount, '45.00');
  assert.equal(r['N-02'].amountFromSource, true); assert.equal(r['N-02'].caution, '');
  assert.equal(r['N-02'].text.slice(r['N-02'].evidence.start, r['N-02'].evidence.end), '2 poster layouts for the front window');
  // The note calls $80 a budget, so the rules refuse to turn it into a price even though the model proposed it.
  assert.equal(r['N-04a'].prediction.label, 'extra'); assert.equal(r['N-04a'].unitAmount, '0.00'); assert.match(r['N-04a'].caution, /budget/);
  assert.equal(r['N-04b'].prediction.label, 'included'); assert.equal(r['N-04a'].sourceHash, r['N-04b'].sourceHash);
  assert.equal(r['N-08'].quantity, '3'); assert.equal(r['N-08'].unitAmount, '30.00'); assert.equal(r['N-08'].quantityFromSource, false); assert.match(r['N-08'].caution, /counted 3/);
  assert.equal(r['N-07'].reader, 'agent'); assert.match(r['N-07'].reason, /revision round/);
});

test('quotes, prices and counts the notes do not support are not carried into line items', () => {
  const lines = ['Client asked for 2 extra posters, $45 each.', 'Client wants 2 banners for $90.', 'Client asked for a flyer.', 'Sent files.'].join('\n');
  const { rows, ignored } = reconcileAgentItems(model, lines, [
    { note: 1, category: 'extra', evidence: 'three glossy posters', description: 'Poster', quantity: 2, unit_price: '45', reason: '' },
    { note: 2, category: 'extra', evidence: '2 banners for $90', description: 'Banner', quantity: 2, unit_price: '90', reason: '' },
    { note: 3, category: 'extra', evidence: 'a flyer', description: 'Flyer', quantity: 1, unit_price: '60', reason: '' },
    { note: 9, category: 'extra', evidence: 'x', description: 'Ghost', quantity: 1, unit_price: '1', reason: '' },
  ]);
  const r = byId(rows);
  assert.equal(ignored, 1);
  assert.equal(r['N-01'].prediction.label, 'uncertain'); assert.equal(r['N-01'].evidence, null); assert.equal(r['N-01'].unitAmount, '0.00'); assert.match(r['N-01'].caution, /not in this note/);
  assert.equal(r['N-02'].unitAmount, '0.00'); assert.match(r['N-02'].caution, /total rather than a unit price/);
  assert.equal(r['N-03'].unitAmount, '0.00'); assert.match(r['N-03'].caution, /does not state/);
  assert.equal(r['N-04'].reader, 'classifier'); assert.match(r['N-04'].caution, /skipped this note/);
});

test('a note cannot be split into more than six rows, and malformed answers are refused', () => {
  const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india'];
  const many = words.map(word => ({ note: 1, category: 'admin', evidence: word, description: word, quantity: 1, unit_price: '', reason: '' }));
  const { rows, ignored } = reconcileAgentItems(model, words.join(' '), many);
  assert.deepEqual(rows.map(row => row.id), ['N-01a', 'N-01b', 'N-01c', 'N-01d', 'N-01e', 'N-01f']); assert.equal(ignored, 3);
  assert.throws(() => reconcileAgentItems(model, 'Sent files.', null), /could not be read/);
});

test('one request listed twice is never billed twice', () => {
  const note = 'Client (Mon): Could you also do 2 poster layouts for the front window? $45 each is fine. And 2 poster layouts for the door, $45 each.';
  const poster = { note: 1, category: 'extra', description: 'Poster layout', quantity: 2, unit_price: '45', reason: '' };
  const { rows, duplicates } = reconcileAgentItems(model, note, [
    { ...poster, evidence: '2 poster layouts for the front window' },
    { ...poster, evidence: 'poster layouts for the front window? $45 each' },
    { ...poster, evidence: '2 poster layouts for the door' },
  ]);
  assert.equal(duplicates, 2); assert.deepEqual(rows.map(row => row.id), ['N-01']);
  assert.equal(rows[0].prediction.label, 'extra'); assert.equal(rows[0].quantity, '2'); assert.equal(rows[0].unitAmount, '45.00');
  assert.match(rows[0].caution, /in 2 parts, so they were combined/);
});

test('a request the model split into the item and its count becomes one priced line', () => {
  const note = 'Client: Loved the boards. Can we get a table tent card design as well? We need 4, $25 each.';
  const { rows } = reconcileAgentItems(model, note, [
    { note: 1, category: 'extra', evidence: 'table tent card design', description: 'Table tent card design', quantity: 1, unit_price: '', reason: '' },
    { note: 1, category: 'extra', evidence: '4', description: 'Table tent card design', quantity: 4, unit_price: '25', reason: '' },
  ]);
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 'N-01');
  assert.equal(rows[0].quantity, '4'); assert.equal(rows[0].unitAmount, '25.00'); assert.equal(rows[0].quantityFromSource, true);
  assert.equal(rows[0].evidence.text, 'table tent card design');
});

test('split rows are accepted only from the AI reader, and only while the note is unchanged', () => {
  const r = byId(reconcileAgentItems(model, notes, recorded).rows);
  const pick = (row, extra = {}) => ({ id: row.id, sourceHash: row.sourceHash, description: row.description, quantity: row.quantity, unitAmount: '80.00', category: row.prediction.label, ...extra });
  const base = { projectName: sampleProject.name, quote: 'Q-019', date: '2026-11-07', notes, allReviewed: true };
  const review = buildReviewedInvoice({ ...base, reader: 'agent', selections: [pick(r['N-04a'])] }, model);
  assert.equal(review.total, '80.00'); assert.equal(review.lines[0].id, 'N-04a'); assert.equal(review.lines[0].predictedCategory, 'extra');
  assert.match(review.payload.items[0].description, /^Source N-04a · /);
  assert.match(receiptMarkdown(review), /local language model/);
  assert.throws(() => buildReviewedInvoice({ ...base, selections: [pick(r['N-04a'])] }, model), /missing or duplicated/);
  assert.throws(() => buildReviewedInvoice({ ...base, reader: 'agent', selections: [pick(r['N-04a'], { sourceHash: r['N-02'].sourceHash })] }, model), /changed after review/);
  assert.throws(() => buildReviewedInvoice({ ...base, reader: 'agent', selections: [pick(r['N-04a']), pick(r['N-04a'])] }, model), /duplicated/);
  assert.throws(() => buildReviewedInvoice({ ...base, reader: 'robot', selections: [pick(r['N-04a'])] }, model), /Unknown note reader/);
});

async function withServer(options, callback) {
  const server = createServer(createApp({ model, log: () => {}, ...options }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data, reqOrigin = origin) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: reqOrigin }, body: JSON.stringify(data) });
  try { await callback({ origin, post }); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const fakeAgent = (read = async () => recorded) => ({ label: () => 'fake model via local Ollama', available: async () => true, read });

test('the AI reader endpoint returns checked rows, and is off unless the operator enables it', async () => {
  await withServer({}, async ({ origin, post }) => {
    assert.deepEqual((await (await fetch(`${origin}/api/status`)).json()).agent, { enabled: false });
    assert.equal((await post('/api/agent-read', { notes })).status, 409);
  });
  let seen;
  await withServer({ agent: fakeAgent(async input => { seen = input; return recorded; }) }, async ({ origin, post }) => {
    assert.deepEqual((await (await fetch(`${origin}/api/status`)).json()).agent, { enabled: true, label: 'fake model via local Ollama', ready: true });
    const response = await post('/api/agent-read', { notes, projectName: 'P', quote: 'Q-019', scope: sampleProject.quoteSummary });
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.rows.length, 9); assert.equal(body.reader, 'fake model via local Ollama');
    assert.equal(seen.lines.length, 8); assert.equal(seen.scope, sampleProject.quoteSummary);
    assert.equal((await post('/api/agent-read', { notes }, 'https://other.test')).status, 403);
    assert.equal((await post('/api/agent-read', { notes: '' })).status, 400);
  });
  await withServer({ agent: fakeAgent(async () => { throw new Error('The local AI reader could not be reached.'); }) }, async ({ post }) => {
    const response = await post('/api/agent-read', { notes });
    assert.equal(response.status, 502); assert.match((await response.json()).error, /could not be reached/);
  });
});

test('the Ollama client stays on this computer and asks for schema-constrained JSON without thinking', async () => {
  assert.throws(() => new OllamaAgent({ model: 'm', host: 'https://ollama.example.com' }), /only connects to Ollama on this computer/);
  const calls = [];
  const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const agent = new OllamaAgent({ model: 'gemma4:12b-it-qat', fetchImpl: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return calls.length === 1 ? reply(400, { error: 'model does not support thinking' }) : reply(200, { message: { content: JSON.stringify({ items: recorded }) } });
  } });
  const items = await agent.read({ projectName: 'P', quote: 'Q', scope: 'S', lines: ['a', 'b'] });
  assert.equal(items.length, 9);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/chat');
  assert.deepEqual(calls[0].body.format, AGENT_SCHEMA); assert.equal(calls[0].body.stream, false); assert.equal(calls[0].body.think, false);
  assert.equal('think' in calls[1].body, false);
  assert.match(calls[0].body.messages[1].content, /Agreed scope: S\n\nNotes:\n1\. a\n2\. b$/);
  const broken = new OllamaAgent({ model: 'm', fetchImpl: async () => reply(200, { message: { content: 'not json' } }) });
  await assert.rejects(broken.read({ lines: ['a'] }), /could not be read/);
  const down = new OllamaAgent({ model: 'm', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down.read({ lines: ['a'] }), /could not be reached/);
  assert.equal(await down.available(), false);
});
