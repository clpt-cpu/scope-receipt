import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { trainClassifier, classify } from '../src/model/classifier.mjs';
import { trainingExamples, evaluationExamples, challengeExamples } from '../src/model/training.mjs';
import { analyzeNotes, buildReviewedInvoice, centsToMoney, moneyToCents, receiptMarkdown } from '../src/domain/review.mjs';
import { sampleProject } from '../src/domain/sample.mjs';

const model = JSON.parse(await readFile(new URL('../src/model/model.json', import.meta.url), 'utf8'));
export function inputForSelected() {
  const rows = analyzeNotes(model, sampleProject.notes);
  return { projectName: sampleProject.name, quote: sampleProject.quote, date: '2026-10-31', notes: sampleProject.notes, allReviewed: true,
    selections: rows.filter(row => ['N-02', 'N-04', 'N-08'].includes(row.id)).map(({ id, sourceHash, description, quantity, unitAmount }) => ({ id, sourceHash, description, quantity, unitAmount })) };
}
test('model is reproducible from its authored examples with disjoint holdout', () => {
  assert.deepEqual(trainClassifier(trainingExamples), model);
  const texts = new Set(trainingExamples.map(([, text]) => text));
  assert.ok(evaluationExamples.every(([, text]) => !texts.has(text)));
});
test('sample proposals distinguish extra work and never select work automatically', () => {
  const rows = analyzeNotes(model, sampleProject.notes);
  assert.deepEqual(rows.filter(r => r.prediction.label === 'extra').map(r => r.id), ['N-02', 'N-04', 'N-08']);
  assert.ok(rows.every(row => !row.selected && !row.reviewed));
  assert.equal(rows[6].prediction.label, 'uncertain');
});
test('unknown and non-English input abstains', () => {
  assert.equal(classify(model, 'xyzzy').label, 'uncertain');
  assert.equal(classify(model, '追加の作業をお願いします').label, 'uncertain');
});
test('negated extra fee is not treated as a billable request', () => {
  assert.equal(classify(model, 'There is no extra fee for the spelling correction.').label, 'included');
});
test('a stated absence of a charge is not read as a charge, and a stated absence from the quote is', () => {
  assert.equal(classify(model, 'We will not charge extra for the color fix.').label, 'included');
  assert.equal(classify(model, 'Not in the quote, so this new banner needs an extra charge.').label, 'extra');
});
test('free or covered work in the harder wording is never proposed as billable', () => {
  const wrong = challengeExamples.filter(([label, text]) => label !== 'extra' && classify(model, text).label === 'extra').map(([, text]) => text);
  assert.deepEqual(wrong, []);
});
test('vague feedback goes to the operator instead of being proposed as billable', () => {
  for (const text of ['Make it pop a bit more.', 'Please make the logo feel less busy.', 'I think we need more contrast.']) assert.equal(classify(model, text).label, 'uncertain', text);
});
test('money arithmetic keeps decimal cents exact', () => {
  assert.equal(moneyToCents('0.10') * 3, 30); assert.equal(centsToMoney(30), '0.30');
  assert.equal(moneyToCents('123.4'), 12340);
  for (const value of ['-1', '1e3', 'NaN', '1.005', 'Infinity', '1,000', ' 2.00', '.50']) assert.throws(() => moneyToCents(value));
});
test('reviewed sample creates USD 260.00 from three source-linked requests', () => {
  const review = buildReviewedInvoice(inputForSelected(), model);
  assert.equal(review.total, '260.00'); assert.equal(review.payload.items.length, 3);
  assert.deepEqual(review.lines.map(l => l.lineAmount), ['90.00', '80.00', '90.00']);
  assert.equal(review.payload.detail.currency_code, 'USD');
  // PayPal refuses an invoicer alongside this flag, so the two must never travel together.
  assert.equal(review.payload.configuration.auto_populate_invoicer, true); assert.equal('invoicer' in review.payload, false);
});
test('human confirmation and unchanged source hashes are required', () => {
  const input = inputForSelected(); input.allReviewed = false; assert.throws(() => buildReviewedInvoice(input, model), /Confirm/);
  input.allReviewed = true; input.notes = input.notes.replace('$45 each', '$55 each');
  assert.throws(() => buildReviewedInvoice(input, model), /source note changed/);
});
test('duplicate source, missing price, negative quantity and invalid date fail', () => {
  const duplicate = inputForSelected(); duplicate.selections.push(duplicate.selections[0]); assert.throws(() => buildReviewedInvoice(duplicate, model), /duplicated/);
  const free = inputForSelected(); free.selections[0].unitAmount = '0.00'; assert.throws(() => buildReviewedInvoice(free, model), /greater than zero/);
  const quantity = inputForSelected(); quantity.selections[0].quantity = '-2'; assert.throws(() => buildReviewedInvoice(quantity, model), /Quantity/);
  const date = inputForSelected(); date.date = '2026-02-30'; assert.throws(() => buildReviewedInvoice(date, model), /valid invoice date/);
});
test('ambiguous quantities and prices require manual amounts instead of invented prices', () => {
  const [row] = analyzeNotes(model, 'The client requested additional work outside the quote.');
  assert.equal(row.unitAmount, '0.00'); assert.equal(row.amountFromSource, false); assert.equal(row.quantityFromSource, false);
});
test('a price for multiple items is not assumed to be a per-item price', () => {
  const [row] = analyzeNotes(model, 'Client added 2 extra posters for $90 total.');
  assert.equal(row.quantity, '2'); assert.equal(row.unitAmount, '0.00'); assert.equal(row.amountFromSource, false);
});
const read = text => analyzeNotes(model, text)[0];
test('a thousands separator is read as the whole amount, never as the digits before it', () => {
  assert.equal(read('Client asked for one extra poster for $1,200.').unitAmount, '1200.00');
  assert.equal(read('Client asked for an extra banner at $1,250.50.').unitAmount, '1250.50');
  assert.equal(read('Client wants an extra poster for US$40.').unitAmount, '40.00');
});
test('spelled-out and dozen quantities multiply the unit price', () => {
  const two = read('Client added two extra posters at $40 each.');
  assert.deepEqual([two.quantity, two.unitAmount, two.quantityFromSource], ['2', '40.00', true]);
  assert.equal(read('Client asked for three more layouts at $25 per layout.').quantity, '3');
  assert.equal(read('Client wants a dozen extra posters at $5 each.').quantity, '12');
});
test('rates written with a slash or a word count as per-unit prices', () => {
  for (const text of ['Client added 3 hours at $50/hour.', 'Client added 3 hours at $50 an hour.', 'Client added 3 extra hours at $50 per hour.']) assert.deepEqual([read(text).quantity, read(text).unitAmount], ['3', '50.00'], text);
});
test('a quantity above the invoice limit is left for the operator instead of billed as one', () => {
  const row = read('Client wants 100 extra posters at $5 each.');
  assert.deepEqual([row.quantity, row.unitAmount, row.quantityFromSource, row.amountFromSource], ['1', '0.00', false, false]);
  assert.match(row.caution, /quantity/i);
});
test('several amounts in one note are left for the operator', () => {
  for (const text of ['Client wants a rush fee of $15 on top of the $40 poster.', 'Client asked for 2 extra posters at $40 each plus $15 delivery.', 'Client asked for the extra window sign, $40 was quoted, then $55 agreed.']) {
    const row = read(text);
    assert.deepEqual([row.unitAmount, row.amountFromSource], ['0.00', false], text);
    assert.match(row.caution, /more than one amount/i, text);
  }
  assert.equal(read('Client wants a rush fee of $15 on top of the $40 poster.').quantity, '1');
});
test('the same amount written twice is still one price', () => {
  assert.equal(read('Client added 1 extra window sign at $80, confirmed $80 by email.').unitAmount, '80.00');
});
test('a budget, a limit, a discount or a refund is not a price for the work', () => {
  for (const text of ['Client asked for a poster, budget under $100.', 'Client asked for an extra poster, no more than $100.', 'Client asked for a discount of $20 on the banner.', 'Client wants a refund of $30.', 'Client paid a $50 deposit for the extra poster.']) {
    const row = read(text);
    assert.deepEqual([row.unitAmount, row.amountFromSource], ['0.00', false], text);
    assert.ok(row.caution, text);
  }
});
test('an amount with too many decimals is left for the operator', () => {
  assert.deepEqual([read('Client wants an extra poster at $45.999.').unitAmount, read('Client wants an extra poster at $45.999.').amountFromSource], ['0.00', false]);
});
test('a version number is not a quantity', () => {
  const row = read('Client asked for version 2 poster for $80.');
  assert.deepEqual([row.quantity, row.quantityFromSource, row.unitAmount], ['1', false, '80.00']);
});
test('the sample and its worded prices keep reading as before', () => {
  assert.deepEqual(analyzeNotes(model, sampleProject.notes).filter(r => r.amountFromSource).map(r => [r.id, r.quantity, r.unitAmount, r.caution]), [['N-02', '2', '45.00', ''], ['N-04', '1', '80.00', ''], ['N-08', '3', '30.00', '']]);
});
test('receipts preserve original notes and escape markup', () => {
  const input = inputForSelected(); input.projectName = '<script> | test';
  const receipt = receiptMarkdown(buildReviewedInvoice(input, model));
  assert.ok(receipt.includes('\\<script\\>')); assert.ok(receipt.includes('N-02')); assert.ok(receipt.includes('SHA-256:'));
  assert.ok(receipt.includes('No invoice has been sent.'));
});
