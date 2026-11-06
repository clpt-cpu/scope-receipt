import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeNotes, buildReviewedInvoice, moneyToCents, receiptMarkdown } from '../src/domain/review.mjs';
import { sampleProject } from '../src/domain/sample.mjs';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'";

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data));
}
async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new Error('Use application/json.');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 128_000) throw new Error('Request is too large.'); chunks.push(chunk); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('The request is not valid JSON.'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('The request must be a JSON object.');
  return body;
}
function totalMatches(receipt, review) {
  if (receipt.total === undefined) return null;
  try { return receipt.currency === review.currency && moneyToCents(receipt.total) === review.totalCents; } catch { return false; }
}
function permittedOrigin(req, required = false) {
  const origin = req.headers.origin, port = req.socket.localPort;
  return (!origin && !required) || [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin);
}

export function createApp({ model, paypalClient = null, allowSandbox = false, devMiddleware = null, now = () => Date.now(), log = console.error }) {
  const previews = new Map();
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { error: 'Invalid request URL.' }); }
    if (url.pathname.startsWith('/api/')) {
      if (!permittedOrigin(req)) return json(res, 403, { error: 'Use the application from its own local origin.' });
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, application: 'scope-receipt' });
      if (req.method === 'GET' && url.pathname === '/api/sample') return json(res, 200, sampleProject);
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { environment: 'sandbox', configured: Boolean(paypalClient), draftCreationEnabled: Boolean(paypalClient && allowSandbox), model: { method: model.method, trainingExamples: Object.values(model.documentCounts).reduce((a, b) => a + b, 0), data: model.provenance, realClientAccuracy: 'not measured' } });
      if (req.method !== 'POST') return json(res, 404, { error: 'Endpoint not found.' });
      let body;
      try { body = await readJson(req); } catch (error) { return json(res, 400, { error: error.message }); }
      if (url.pathname === '/api/analyze') {
        try { return json(res, 200, { rows: analyzeNotes(model, body.notes) }); }
        catch (error) { return json(res, 400, { error: error.message }); }
      }
      if (url.pathname === '/api/preview') {
        for (const [id, item] of previews) if (item.expiresAt <= now()) previews.delete(id);
        if (previews.size >= 50) return json(res, 429, { error: 'Too many previews are open. Try again in ten minutes.' });
        try {
          const review = buildReviewedInvoice(body, model), previewId = randomUUID();
          previews.set(previewId, { review, state: 'ready', expiresAt: now() + 10 * 60_000 });
          return json(res, 200, { previewId, review, markdown: receiptMarkdown(review), sandboxAvailable: Boolean(paypalClient && allowSandbox) });
        } catch (error) { return json(res, 400, { error: error instanceof RangeError ? 'Choose a valid invoice date.' : error.message }); }
      }
      if (url.pathname === '/api/sandbox-draft') {
        if (!allowSandbox || !paypalClient) return json(res, 409, { error: 'Sandbox draft creation is disabled. The owner must configure and approve sandbox testing first.' });
        if (!permittedOrigin(req, true)) return json(res, 403, { error: 'Sandbox drafts must be requested from the local application.' });
        const item = previews.get(body.previewId);
        if (!item || item.expiresAt <= now()) return json(res, 409, { error: 'This preview expired. Prepare and review a new one.' });
        if (body.confirmDraft !== true || body.reviewDigest !== item.review.digest) return json(res, 400, { error: 'Confirm this exact reviewed draft before creating it in the sandbox.' });
        if (item.state !== 'ready') return json(res, 409, { error: 'This preview has already been used. Check the sandbox dashboard before making another draft.' });
        item.state = 'in-flight';
        try {
          const receipt = await paypalClient.createDraft(item.review.payload, body.previewId);
          item.state = 'created'; item.receipt = receipt;
          return json(res, 201, { ...receipt, reviewedTotal: item.review.total, totalMatches: totalMatches(receipt, item.review) });
        } catch (error) {
          if (error.rejected || error.retrySafe) { item.state = 'ready'; log(error.message); return json(res, 502, { error: error.message, retryable: true }); }
          item.state = 'needs-checking';
          return json(res, 502, { error: 'The sandbox draft could not be confirmed. Check the sandbox dashboard. This preview is locked to prevent a duplicate.' });
        }
      }
      return json(res, 404, { error: 'Endpoint not found.' });
    }
    if (devMiddleware) return devMiddleware(req, res, () => json(res, 404, { error: 'Not found.' }));
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
    res.setHeader('Content-Security-Policy', CSP);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Invalid path.' }); }
    let target = resolve(DIST, `.${pathname === '/' ? '/index.html' : pathname}`);
    const rel = relative(DIST, target);
    if (rel.startsWith('..') || rel.includes(':') || pathname.includes('\\')) return json(res, 403, { error: 'Path is outside this application.' });
    try {
      let data;
      try { data = await readFile(target); } catch (error) {
        if (error.code === 'ENOENT' && !extname(pathname)) { target = resolve(DIST, 'index.html'); data = await readFile(target); } else throw error;
      }
      res.writeHead(200, { 'Content-Type': TYPES[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { return json(res, 404, { error: 'Build the application with npm run build before starting this server.' }); }
  };
}
