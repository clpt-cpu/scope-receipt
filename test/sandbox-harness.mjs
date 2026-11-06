// The real application and the real adapter, with only PayPal's side of the network replaced.
// /fake/* belongs to this harness, so a browser check can script PayPal's answers and read what reached it.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server/app.mjs';
import { PayPalSandboxClient } from '../server/paypal.mjs';

const model = JSON.parse(await readFile(new URL('../src/model/model.json', import.meta.url), 'utf8'));
const received = [], answers = [], created = new Map();
const fetchImpl = async (url, options) => {
  if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'fake-access', expires_in: 3600 });
  // A readback returns what this fake PayPal stored for the draft: the posted items, with the total it answered.
  if (options.method === 'GET') {
    const id = decodeURIComponent(url.split('/').at(-1)), draft = created.get(id);
    return draft ? Response.json({ id, status: 'DRAFT', amount: draft.amount, items: draft.items }) : Response.json({ name: 'RESOURCE_NOT_FOUND' }, { status: 404 });
  }
  const body = JSON.parse(options.body);
  received.push({ url, requestId: options.headers['PayPal-Request-Id'], body });
  const answer = answers.shift() || { status: 201, body: { id: 'INV2-FAKE-0001', status: 'DRAFT', amount: { currency_code: 'USD', value: '260.00' } } };
  if (answer.status === 201 && answer.body?.id) created.set(answer.body.id, { amount: answer.body.amount, items: body.items });
  return Response.json(answer.body, { status: answer.status });
};
const app = createApp({ model, allowSandbox: true, paypalClient: new PayPalSandboxClient({ clientId: 'fake-client', clientSecret: 'fake-secret', fetchImpl }), log: () => {} });
const server = createServer(async (req, res) => {
  if (req.url === '/fake/received') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(received)); }
  if (req.url === '/fake/reset') { received.length = 0; answers.length = 0; created.clear(); res.writeHead(204); return res.end(); }
  if (req.url === '/fake/answer') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    answers.push(JSON.parse(Buffer.concat(chunks).toString('utf8'))); res.writeHead(204); return res.end();
  }
  return app(req, res);
});
server.listen(4319, '127.0.0.1', () => console.log('Sandbox harness on 4319'));
