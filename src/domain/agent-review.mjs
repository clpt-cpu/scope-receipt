import { classify } from '../model/classifier.mjs';
import { PER_UNIT, centsToMoney, moneyToCents, noteLines, readPrice, sourceDigest } from './review.mjs';

const CATEGORY = { extra: 'extra', included: 'included', admin: 'admin', unclear: 'uncertain' };
const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const SUFFIX = 'abcdef';
// Curly quotes become straight ones, character for character, so positions in the note stay valid for highlighting.
const fold = text => String(text).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();

function locate(text, evidence) {
  const wanted = String(evidence ?? '').trim().replace(/^["']|["'.]$/g, '').trim();
  if (wanted.length < 3) return null;
  const start = fold(text).indexOf(fold(wanted));
  return start < 0 ? null : { start, end: start + wanted.length };
}

function stated(evidence, quantity) {
  const n = Number(quantity);
  return new RegExp(`(?<![\\d$.,])${n}(?![\\d.,]\\d)`).test(evidence) || (n < NUMBER_WORDS.length && new RegExp(`\\b${NUMBER_WORDS[n]}\\b`, 'i').test(evidence));
}

function classifierRow(model, text, id, sourceHash, caution) {
  const prediction = classify(model, text);
  return { id, text, sourceHash, prediction, description: text.length > 110 ? `${text.slice(0, 107)}…` : text, quantity: '1', unitAmount: '0.00',
    selected: false, reviewed: false, quantityFromSource: false, amountFromSource: false, caution, reader: 'classifier', evidence: null, reason: '' };
}

// The model proposes; these rules decide what may reach the review table. A quote that is not in the note, a price that the
// note does not state, or an amount that reads as a budget or a total is never carried into a line item.
export function reconcileAgentItems(model, notes, items) {
  const lines = noteLines(notes);
  if (!Array.isArray(items)) throw new Error('The AI reader returned an answer that could not be read. Try again, or use the built-in classifier.');
  const byNote = new Map();
  let ignored = 0;
  for (const item of items.slice(0, 300)) {
    const index = Number(item?.note) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= lines.length || item === null || typeof item !== 'object') { ignored++; continue; }
    if (!byNote.has(index)) byNote.set(index, []);
    if (byNote.get(index).length < SUFFIX.length) byNote.get(index).push(item); else ignored++;
  }
  const rows = [];
  let duplicates = 0;
  lines.forEach((text, index) => {
    const base = `N-${String(index + 1).padStart(2, '0')}`, sourceHash = sourceDigest(text);
    // Listing one request twice would bill it twice. An item that quotes the same words as an earlier one is dropped, and items
    // with the same line name are combined into one line, which the operator is asked to check.
    const kept = [];
    for (const item of byNote.get(index) || []) {
      const span = locate(text, item.evidence), name = String(item.description ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (kept.some(other => span && other.span && span.start < other.span.end && other.span.start < span.end)) { duplicates++; continue; }
      const twin = name ? kept.find(other => other.name === name) : undefined;
      if (twin) { twin.parts.push({ item, span }); duplicates++; continue; }
      kept.push({ item, span, name, parts: [{ item, span }] });
    }
    const found = kept.map(({ item, parts }) => {
      if (parts.length === 1) return item;
      const counts = parts.map(part => part.item.quantity).filter(n => Number.isInteger(n) && n >= 1 && n <= 99);
      const located = parts.filter(part => part.span).sort((a, b) => (b.span.end - b.span.start) - (a.span.end - a.span.start));
      return { ...item, category: parts.some(part => part.item.category === 'extra') ? 'extra' : item.category,
        quantity: counts.length ? Math.max(...counts) : item.quantity, evidence: located.length ? located[0].item.evidence : item.evidence,
        unit_price: parts.map(part => String(part.item.unit_price ?? '').trim()).find(Boolean) ?? '', combined: parts.length };
    });
    if (!found.length) { rows.push(classifierRow(model, text, base, sourceHash, 'The AI reader skipped this note, so the built-in classifier suggested its category. Read it yourself.')); return; }
    const notePrice = readPrice(text);
    found.forEach((item, k) => {
      const span = locate(text, item.evidence), cautions = [];
      let label = CATEGORY[item.category] || 'uncertain';
      if (!span) { label = 'uncertain'; cautions.push('The AI quoted words that are not in this note. Read the note yourself.'); }
      const evidence = span ? text.slice(span.start, span.end) : '';
      const quantity = Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99 ? String(item.quantity) : '1';
      const quantityFromSource = Boolean(span) && (quantity === '1' || stated(evidence, quantity) || stated(text, quantity));
      if (span && !quantityFromSource) cautions.push(`The AI counted ${quantity} from the wording. Check the quantity.`);
      let proposed = null;
      try { proposed = String(item.unit_price ?? '').trim() ? moneyToCents(String(item.unit_price).trim().replace(/^\$/, '')) : null; } catch { proposed = -1; }
      let unitAmount = '0.00', amountFromSource = false;
      if (proposed !== null && span) {
        if (notePrice.caution) cautions.push(notePrice.caution);
        else if (notePrice.cents !== proposed) cautions.push('The AI suggested a price that this note does not state. Enter the agreed price yourself.');
        else if (quantity !== '1' && !PER_UNIT.test(text)) cautions.push('The amount in this note may be a total rather than a unit price. Enter the agreed unit price yourself.');
        else { unitAmount = centsToMoney(proposed); amountFromSource = true; }
      } else if (label === 'extra') cautions.push('No price is stated for this request. Enter the agreed price yourself.');
      if (item.combined) cautions.unshift(`The AI listed this request in ${item.combined} parts, so they were combined into one line. Check that the client asked for it only once.`);
      const description = String(item.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 110) || (text.length > 110 ? `${text.slice(0, 107)}…` : text);
      rows.push({
        id: found.length > 1 ? `${base}${SUFFIX[k]}` : base, text, sourceHash,
        prediction: { label, modelLabel: String(item.category ?? ''), signals: [], needsReview: true },
        description, quantity, unitAmount, selected: false, reviewed: false, quantityFromSource, amountFromSource,
        caution: cautions.join(' '), reader: 'agent', evidence: span ? { ...span, text: evidence } : null,
        reason: String(item.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
      });
    });
  });
  return { rows, ignored, duplicates };
}
