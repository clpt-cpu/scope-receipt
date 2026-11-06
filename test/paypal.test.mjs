import test from 'node:test';
import assert from 'node:assert/strict';
import { PayPalSandboxClient } from '../server/paypal.mjs';

test('adapter authenticates and creates drafts only at the sandbox host', async () => {
  const calls = [];
  const client = new PayPalSandboxClient({ clientId: 'unit-client', clientSecret: 'unit-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.endsWith('/token') ? { access_token: 'unit-access', expires_in: 3600 } : { id: 'INV2-UNIT-0001', status: 'DRAFT' }, { status: url.endsWith('/token') ? 200 : 201 });
  } });
  assert.equal((await client.createDraft({ items: [] }, 'request-1')).sent, false);
  await client.createDraft({ items: [] }, 'request-2');
  assert.equal(calls.filter(c => c.url.endsWith('/token')).length, 1);
  assert.ok(calls.every(c => new URL(c.url).origin === 'https://api-m.sandbox.paypal.com'));
  assert.ok(calls.every(c => c.options.redirect === 'error'));
  assert.ok(calls.every(c => !c.url.includes('/send')));
  assert.equal(calls[1].options.headers['PayPal-Request-Id'], 'request-1');
});
test('authentication errors do not expose remote bodies or credential values', async () => {
  const client = new PayPalSandboxClient({ clientId: 'unit-client', clientSecret: 'unit-secret', fetchImpl: async () => Response.json({ secret: 'unit-secret' }, { status: 401 }) });
  await assert.rejects(() => client.createDraft({}, 'request-1'), error => /401/.test(error.message) && !/unit-secret/.test(error.message));
});
test('network failure after authentication stays uncertain and can be asked again with the same reference', async () => {
  const client = new PayPalSandboxClient({ clientId: 'unit-client', clientSecret: 'unit-secret', fetchImpl: async url => {
    if (url.endsWith('/token')) return Response.json({ access_token: 'unit-access', expires_in: 3600 });
    throw new Error('remote sensitive error text');
  } });
  await assert.rejects(() => client.createDraft({}, 'request-1'), error => error.retrySafe === true && !error.rejected && /may or may not exist/.test(error.message) && !/sensitive/.test(error.message));
});
const signedIn = respond => new PayPalSandboxClient({ clientId: 'unit-client', clientSecret: 'unit-secret', fetchImpl: async (url, options) => url.endsWith('/token') ? Response.json({ access_token: 'unit-access', expires_in: 3600 }) : respond(url, options) });
test('a refused draft names the reason and reference, and leaves out everything else PayPal sent', async () => {
  const client = signedIn(() => Response.json({ name: 'UNPROCESSABLE_ENTITY', message: 'unit-free-text', debug_id: 'unit-debug-1', details: [{ field: '/items/0/name', value: 'unit-private-value', issue: 'MISSING_REQUIRED_PARAMETER' }] }, { status: 422 }));
  await assert.rejects(() => client.createDraft({}, 'request-1'), error => {
    assert.equal(error.rejected, true);
    for (const part of ['422', 'UNPROCESSABLE_ENTITY', 'unit-debug-1', '/items/0/name', 'MISSING_REQUIRED_PARAMETER']) assert.ok(error.message.includes(part), part);
    assert.ok(!error.message.includes('unit-private-value')); assert.ok(!error.message.includes('unit-free-text'));
    return true;
  });
});
test('a refusal with no usable body is still a refusal', async () => {
  const client = signedIn(() => new Response('not json', { status: 403 }));
  await assert.rejects(() => client.createDraft({}, 'request-1'), error => error.rejected === true && /403/.test(error.message));
});
test('a server failure stays uncertain, because the draft may exist, and is not called a refusal', async () => {
  for (const status of [408, 409, 429, 500, 503]) {
    const client = signedIn(() => Response.json({ name: 'INTERNAL_SERVER_ERROR' }, { status }));
    await assert.rejects(() => client.createDraft({}, 'request-1'), error => error.retrySafe === true && !error.rejected && error.message.includes(String(status)) && /may or may not exist/.test(error.message), String(status));
  }
});
test('a success reply that cannot be read is an uncertain answer too', async () => {
  const client = signedIn(() => new Response('not json', { status: 201 }));
  await assert.rejects(() => client.createDraft({}, 'request-1'), error => error.retrySafe === true && !error.rejected);
});
test('nothing is created when signing in fails, so that is a refusal and not an unknown', async () => {
  const wrongKeys = new PayPalSandboxClient({ clientId: 'unit-client', clientSecret: 'unit-secret', fetchImpl: async () => Response.json({ error: 'invalid_client' }, { status: 401 }) });
  await assert.rejects(() => wrongKeys.createDraft({}, 'request-1'), error => error.rejected === true && /client ID and secret/.test(error.message));
  const offline = new PayPalSandboxClient({ clientId: 'unit-client', clientSecret: 'unit-secret', fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(() => offline.createDraft({}, 'request-1'), error => error.rejected === true);
});
test('a token the sandbox stopped accepting is dropped and the next draft signs in again', async () => {
  let tokens = 0, drafts = 0;
  const client = new PayPalSandboxClient({ clientId: 'unit-client', clientSecret: 'unit-secret', fetchImpl: async url => {
    if (url.endsWith('/token')) { tokens++; return Response.json({ access_token: 'unit-access', expires_in: 3600 }); }
    return ++drafts === 1 ? new Response('', { status: 401 }) : Response.json({ id: 'INV2-UNIT-0001', status: 'DRAFT' }, { status: 201 });
  } });
  await assert.rejects(() => client.createDraft({}, 'request-1'), error => error.rejected === true);
  assert.equal((await client.createDraft({}, 'request-1')).id, 'INV2-UNIT-0001'); assert.equal(tokens, 2);
});
test('the short reply that carries only a link still identifies the draft, on the sandbox host only', async () => {
  const reply = href => signedIn(() => Response.json({ rel: 'self', href, method: 'GET' }, { status: 201 }));
  assert.equal((await reply('https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-UNIT-0001').createDraft({}, 'request-1')).id, 'INV2-UNIT-0001');
  await assert.rejects(() => reply('https://other.test/v2/invoicing/invoices/INV2-UNIT-0001').createDraft({}, 'request-1'), /needs checking/);
});
test('the total PayPal computed comes back with the draft', async () => {
  const client = signedIn(() => Response.json({ id: 'INV2-UNIT-0001', status: 'DRAFT', amount: { currency_code: 'USD', value: '260.00' } }, { status: 201 }));
  const receipt = await client.createDraft({}, 'request-1');
  assert.deepEqual([receipt.total, receipt.currency], ['260.00', 'USD']);
});
test('adapter refuses invalid request references and unexpected invoice states', async () => {
  let requests = 0;
  const client = new PayPalSandboxClient({ clientId: 'unit-client', clientSecret: 'unit-secret', fetchImpl: async url => {
    requests++; return Response.json(url.endsWith('/token') ? { access_token: 'unit-access', expires_in: 3600 } : { id: 'INV2-UNIT-0001', status: 'SENT' });
  } });
  await assert.rejects(() => client.createDraft({}, 'bad/id'), /Invalid/); assert.equal(requests, 0);
  await assert.rejects(() => client.createDraft({}, 'request-1'), error => /needs checking/.test(error.message) && !error.retrySafe && !error.rejected);
});
