const SANDBOX = 'https://api-m.sandbox.paypal.com';
// These statuses mean PayPal decided before creating anything. Everything else may have left a draft behind.
const REFUSED = new Set([400, 401, 403, 404, 405, 415, 422]);

function refusal(message) { return Object.assign(new Error(message), { rejected: true }); }
// PayPal answers a repeated PayPal-Request-Id with the original result instead of a second invoice, so a lost answer can be asked for again.
function lostAnswer(what) { return Object.assign(new Error(`${what}, so this draft may or may not exist. Try again: the same reference returns the original result instead of a second draft.`), { retrySafe: true }); }
async function describeRefusal(response) {
  let data = {};
  try { data = await response.json(); } catch { /* The status alone still says it was refused. */ }
  const text = value => typeof value === 'string' && value ? value.slice(0, 120) : '';
  // Only PayPal's codes and field paths: `value` and free text can repeat what was submitted.
  const issues = Array.isArray(data?.details) ? data.details.slice(0, 5).map(item => [text(item?.field), text(item?.issue)].filter(Boolean).join(' ')).filter(Boolean) : [];
  const reference = text(data?.debug_id);
  return [`PayPal refused this draft (${[response.status, text(data?.name)].filter(Boolean).join(' ')}). Nothing was created.`, issues.length ? `Issues: ${issues.join('; ')}.` : '', reference ? `Reference: ${reference}.` : ''].filter(Boolean).join(' ');
}

export class PayPalSandboxClient {
  #clientId; #secret; #fetch; #token = null; #expiresAt = 0;
  constructor({ clientId, clientSecret, fetchImpl = globalThis.fetch }) {
    if (!clientId || !clientSecret) throw new Error('PayPal sandbox credentials are not configured.');
    this.#clientId = clientId; this.#secret = clientSecret; this.#fetch = fetchImpl;
  }
  async #accessToken() {
    if (this.#token && this.#expiresAt > Date.now() + 30000) return this.#token;
    let response;
    try {
      response = await this.#fetch(`${SANDBOX}/v1/oauth2/token`, {
        method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${this.#clientId}:${this.#secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials', redirect: 'error', signal: AbortSignal.timeout(15000),
      });
    } catch { throw refusal('The PayPal sandbox could not be reached to sign in. Nothing was created.'); }
    if (!response.ok) throw refusal(`Sandbox sign-in failed (${response.status}). Check the client ID and secret. Nothing was created.`);
    let data;
    try { data = await response.json(); } catch { throw refusal('Sandbox sign-in returned an invalid response. Nothing was created.'); }
    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw refusal('Sandbox sign-in returned an invalid response. Nothing was created.');
    this.#token = data.access_token; this.#expiresAt = Date.now() + data.expires_in * 1000;
    return this.#token;
  }
  async createDraft(invoice, requestId) {
    if (!/^[a-zA-Z0-9-]{1,38}$/.test(requestId)) throw new Error('Invalid draft request reference.');
    const token = await this.#accessToken();
    let response;
    try {
      response = await this.#fetch(`${SANDBOX}/v2/invoicing/invoices`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': requestId, Prefer: 'return=representation' },
        body: JSON.stringify(invoice), redirect: 'error', signal: AbortSignal.timeout(20000),
      });
    } catch { throw lostAnswer('PayPal did not answer'); }
    if (response.status === 401) { this.#token = null; this.#expiresAt = 0; }
    if (REFUSED.has(response.status)) throw refusal(await describeRefusal(response));
    if (!response.ok) throw lostAnswer(`PayPal returned ${response.status}`);
    let data;
    try { data = await response.json(); } catch { throw lostAnswer('PayPal\'s answer could not be read'); }
    let id = data.id;
    if (!id) {
      const href = typeof data.href === 'string' ? data.href : Array.isArray(data.links) ? data.links.find(link => link.rel === 'self')?.href : undefined;
      try { const url = new URL(href); if (url.origin === SANDBOX && url.pathname.startsWith('/v2/invoicing/invoices/')) id = url.pathname.split('/').at(-1); } catch { /* Do not follow returned links. */ }
    }
    if (typeof id !== 'string' || !/^INV[0-9A-Z-]{4,100}$/.test(id) || (data.status && data.status !== 'DRAFT')) throw new Error('Sandbox draft outcome needs checking in the sandbox dashboard.');
    return { id, status: 'DRAFT', environment: 'sandbox', sent: false, total: data.amount?.value, currency: data.amount?.currency_code };
  }
  // Reads a draft back so the operator can compare what PayPal stored with what was reviewed. It never changes the draft.
  async getInvoice(id) {
    if (typeof id !== 'string' || !/^INV[0-9A-Z-]{4,100}$/.test(id)) throw new Error('Invalid invoice reference.');
    let token;
    try { token = await this.#accessToken(); } catch { throw new Error('Sandbox sign-in failed, so the draft could not be read back. The draft itself is unchanged.'); }
    let response;
    try {
      response = await this.#fetch(`${SANDBOX}/v2/invoicing/invoices/${encodeURIComponent(id)}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('PayPal did not answer the readback. The draft itself is unchanged.'); }
    if (response.status === 401) { this.#token = null; this.#expiresAt = 0; }
    if (!response.ok) throw new Error(`PayPal returned ${response.status} for the readback. The draft itself is unchanged.`);
    let data;
    try { data = await response.json(); } catch { throw new Error('PayPal\'s readback could not be read. The draft itself is unchanged.'); }
    const text = value => typeof value === 'string' ? value.slice(0, 200) : '';
    return {
      id: text(data.id), status: text(data.status), currency: text(data.amount?.currency_code || data.detail?.currency_code), total: text(data.amount?.value),
      items: (Array.isArray(data.items) ? data.items.slice(0, 100) : []).map(item => ({ name: text(item?.name), quantity: text(String(item?.quantity ?? '')), unitAmount: text(item?.unit_amount?.value), currency: text(item?.unit_amount?.currency_code), description: text(item?.description) })),
    };
  }
}
