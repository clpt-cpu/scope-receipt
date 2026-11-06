import { createHash } from 'node:crypto';
import { classify } from '../model/classifier.mjs';

export function sourceDigest(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }

export function moneyToCents(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a non-negative USD amount with up to two decimals.');
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function centsToMoney(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid money value.');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

const COUNT_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, 'a dozen': 12 };
const UNITS = 'item|poster|layout|window|sign|language|variant|page|revision|hour|export|print';
const QUANTITY = new RegExp(`(?<![$\\d.,])(?<!(?:\\bversion|\\bround|\\bphase|\\bpage|\\bitem|\\bnumber|\\bno\\.?|#)\\s*)\\b(\\d{1,3}(?:,\\d{3})*|${Object.keys(COUNT_WORDS).join('|')})\\s+(?:(?:additional|extra|more|new)\\s+)?(?:${UNITS})`, 'i');
export const PER_UNIT = new RegExp(`\\beach\\b|\\b(?:per|an?)\\s+(?:${UNITS})\\b|/\\s*(?:${UNITS})\\b`, 'i');
const AMOUNT = /(?<![\w.,])(?:US)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?!,\d)/gi;
const LIMIT_BEFORE = /\b(?:under|over|below|above|up to|at most|at least|no more than|not more than|less than|more than|maximum(?: of)?|max|minimum(?: of)?|min|around|about|roughly|approximately|approx\.?)\s*$/i;
const NOT_A_PRICE = /\b(?:budget|discount|refund|credit|deposit|estimate[ds]?)\b/i;

function readQuantity(text) {
  const match = text.match(QUANTITY);
  if (!match) return { quantity: '1', found: false, overLimit: false };
  const written = match[1].toLowerCase(), count = COUNT_WORDS[written] ?? Number(written.replaceAll(',', ''));
  if (count >= 1 && count <= 99) return { quantity: String(count), found: true, overLimit: false };
  return { quantity: '1', found: false, overLimit: true };
}
// A wrong price on an invoice is worse than an empty one, so anything short of a single clear price goes to the operator.
export function readPrice(text) {
  const found = [...text.matchAll(AMOUNT)];
  if (!found.length) return { cents: null, caution: '' };
  const cautions = {
    several: 'This note has more than one amount. Enter the agreed price yourself.',
    limit: 'This amount reads as a budget, limit, discount or payment, not a price for the work. Enter the agreed price yourself.',
    format: 'An amount in this note could not be read as dollars and cents. Enter the agreed price yourself.',
  };
  const values = [];
  for (const match of found) {
    try { values.push(moneyToCents(`${match[1].replaceAll(',', '')}${match[2] || ''}`)); } catch { return { cents: null, caution: cautions.format }; }
    if (LIMIT_BEFORE.test(text.slice(0, match.index))) return { cents: null, caution: cautions.limit };
    if (/^\s*off\b/i.test(text.slice(match.index + match[0].length))) return { cents: null, caution: cautions.limit };
  }
  if (NOT_A_PRICE.test(text)) return { cents: null, caution: cautions.limit };
  if (new Set(values).size > 1) return { cents: null, caution: cautions.several };
  return { cents: values[0], caution: '' };
}

export function noteLines(notes) {
  if (typeof notes !== 'string' || !notes.trim() || notes.length > 30000) throw new Error('Add between 1 and 30,000 characters of work notes.');
  const lines = notes.split(/\r?\n/).map(text => text.trim()).filter(Boolean);
  if (lines.length > 100) throw new Error('Review up to 100 notes at a time.');
  return lines;
}

export function analyzeNotes(model, notes) {
  return noteLines(notes).map((text, index) => {
    const prediction = classify(model, text);
    const { quantity, found: quantityFromSource, overLimit } = readQuantity(text);
    const price = readPrice(text);
    const explicitUnitPrice = price.cents !== null && !overLimit && (quantity === '1' || PER_UNIT.test(text));
    const caution = overLimit ? 'The quantity in this note is outside 1 to 99, which one line here can hold. Enter the agreed quantity and price yourself.' : price.caution;
    return {
      id: `N-${String(index + 1).padStart(2, '0')}`, text, sourceHash: sourceDigest(text), prediction,
      description: text.length > 110 ? `${text.slice(0, 107)}…` : text,
      quantity,
      unitAmount: explicitUnitPrice ? centsToMoney(price.cents) : '0.00', selected: false, reviewed: false,
      quantityFromSource, amountFromSource: explicitUnitPrice, caution,
    };
  });
}

const CATEGORIES = ['extra', 'included', 'admin', 'uncertain'];

export function buildReviewedInvoice({ projectName, quote = '', notes, selections, allReviewed, date, reader = 'classifier' }, model) {
  if (allReviewed !== true) throw new Error('Confirm that the selected work and prices were checked against the source notes.');
  if (!['classifier', 'agent'].includes(reader)) throw new Error('Unknown note reader.');
  if (typeof projectName !== 'string' || !projectName.trim() || projectName.length > 200) throw new Error('Enter a project name of up to 200 characters.');
  if (typeof quote !== 'string' || quote.length > 100) throw new Error('Invalid quote reference.');
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 100) throw new Error('Select between 1 and 100 line items.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid invoice date.');
  const sources = noteLines(notes);
  const used = new Set();
  const lines = selections.map(selection => {
    // The AI reader may split one note into several requests (N-04a, N-04b). Each one still points at its whole source note.
    const match = /^N-(\d{2})([a-f])?$/.exec(typeof selection?.id === 'string' ? selection.id : '');
    const text = match && (reader === 'agent' || !match[2]) ? sources[Number(match[1]) - 1] : undefined;
    if (text === undefined || used.has(selection.id)) throw new Error('A selected source is missing or duplicated.');
    used.add(selection.id);
    const row = { id: selection.id, text, sourceHash: sourceDigest(text) };
    if (selection.sourceHash !== row.sourceHash) throw new Error('A source note changed after review. Analyze and review the current notes again.');
    if (typeof selection.description !== 'string' || !selection.description.trim() || selection.description.length > 200) throw new Error('Each line needs a description of up to 200 characters.');
    const quantity = String(selection.quantity);
    if (!/^[1-9]\d?$/.test(quantity)) throw new Error('Quantity must be a whole number from 1 to 99.');
    const cents = moneyToCents(selection.unitAmount);
    if (cents === 0) throw new Error('Set a price greater than zero for every selected line.');
    const lineCents = cents * Number(quantity);
    return { id: row.id, sourceHash: row.sourceHash, sourceText: row.text, description: selection.description.trim(),
      quantity, unitAmount: centsToMoney(cents), lineAmount: centsToMoney(lineCents), lineCents,
      predictedCategory: reader === 'agent' ? (CATEGORIES.includes(selection.category) ? selection.category : 'uncertain') : classify(model, text).label, reviewed: true };
  });
  const totalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents > 100_000_000) throw new Error('This prototype supports a total up to USD 1,000,000.00.');
  const detail = { currency_code: 'USD', invoice_date: date, note: `${projectName.trim()}${quote ? ` · ${quote}` : ''}. Extra work reviewed against source notes.`, payment_term: { term_type: 'NET_15' } };
  // PayPal fills the invoicer in from the signed-in business account, and refuses a request that also sends one.
  const payload = { detail, items: lines.map(line => ({ name: line.description, quantity: line.quantity, unit_amount: { currency_code: 'USD', value: line.unitAmount }, description: `Source ${line.id} · ${line.sourceHash.slice(0, 12)}` })), configuration: { auto_populate_invoicer: true } };
  const review = { projectName: projectName.trim(), quote, date, currency: 'USD', reader, lines, total: centsToMoney(totalCents), totalCents, payload };
  review.digest = sourceDigest(JSON.stringify({ project: review.projectName, quote, date, lines: lines.map(({ id, sourceHash, description, quantity, unitAmount }) => ({ id, sourceHash, description, quantity, unitAmount })) }));
  return review;
}

// Compares a draft as PayPal stored it with the reviewed lines, matching each PayPal item to its source by the reference in its description.
export function compareReadback(review, receiptId, readback) {
  const cents = value => { try { return moneyToCents(String(value)); } catch { return null; } };
  const lines = review.lines.map(line => {
    const item = readback.items.find(entry => entry.description.startsWith(`Source ${line.id} · `));
    const checks = item ? { name: item.name === line.description, quantity: Number(item.quantity) === Number(line.quantity), unitAmount: item.currency === 'USD' && cents(item.unitAmount) === cents(line.unitAmount) } : null;
    return { id: line.id, description: line.description, quantity: line.quantity, unitAmount: line.unitAmount, paypal: item ? { name: item.name, quantity: item.quantity, unitAmount: item.unitAmount } : null, matches: Boolean(checks && Object.values(checks).every(Boolean)) };
  });
  const checks = {
    id: readback.id === receiptId, status: readback.status === 'DRAFT', currency: readback.currency === 'USD',
    total: cents(readback.total) === review.totalCents, lineCount: readback.items.length === review.lines.length, lines: lines.every(line => line.matches),
  };
  return { id: readback.id, status: readback.status, currency: readback.currency, total: readback.total, lines, checks, allMatch: Object.values(checks).every(Boolean) };
}

export function receiptMarkdown(review) {
  const safe = value => String(value).replace(/[\r\n]/g, ' ').replace(/([\\`*_[\]<>#|])/g, '\\$1');
  return [
    `# ${safe(review.projectName)} — scope receipt`, '', `Quote: ${safe(review.quote || 'Not supplied')}`, `Review date: ${review.date}`, `Selected extra work: USD ${review.total}`, '',
    'Draft only. Tax and discounts have not been calculated. No invoice has been sent.', '',
    '| Work | Quantity | Unit price (USD) | Line amount (USD) | Source |', '|---|---:|---:|---:|---|',
    ...review.lines.map(line => `| ${safe(line.description)} | ${line.quantity} | ${line.unitAmount} | ${line.lineAmount} | ${line.id} |`), '',
    '## Source notes', ...review.lines.flatMap(line => ['', `### ${line.id}`, safe(line.sourceText), `SHA-256: ${line.sourceHash}`]), '',
    `Review digest: ${review.digest}`, '',
    review.reader === 'agent'
      ? 'Requests were proposed by a local language model, and its quoted evidence and prices were checked against the source notes by rules. Inclusion and pricing were confirmed by the operator.'
      : 'Classification was proposed by a model trained on authored synthetic English examples. Inclusion and pricing were confirmed by the operator.',
  ].join('\n');
}
