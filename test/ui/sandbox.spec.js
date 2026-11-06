import { test, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:4319';
const received = async request => (await request.get(`${origin}/fake/received`)).json();
test.beforeEach(({ request }) => request.post(`${origin}/fake/reset`));

async function prepare(page) {
  await page.goto(`${origin}/`); await expect(page.locator('#note-count')).toHaveText('8 NOTES');
  await page.getByRole('button', { name: 'Select extra requests' }).click();
  await page.locator('#review-confirm').check(); await page.getByRole('button', { name: /Review invoice draft/ }).click();
  await expect(page.locator('#preview-total')).toHaveText('USD 260.00');
  await expect(page.locator('#sandbox-draft')).toBeEnabled();
}

test('the reviewed draft reaches PayPal once, exactly as shown, and the button cannot send it twice', async ({ page, request }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.getByRole('button', { name: 'Create sandbox draft' }).click();
  await expect(page.locator('#sandbox-status')).toHaveText('Sandbox draft INV2-FAKE-0001 created. PayPal\'s total, USD 260.00, matches this review. Its status is DRAFT. No invoice was sent.');
  await expect(page.locator('#sandbox-draft')).toBeDisabled();
  await expect(page.locator('#sandbox-readback')).toContainText('All 3 lines match the review');
  await expect(page.locator('#sandbox-readback')).toContainText('INV2-FAKE-0001 · status DRAFT · USD 260.00');
  await expect(page.locator('#sandbox-readback .readback-line.ok')).toHaveCount(3);
  const [call, ...others] = await received(request);
  expect(others).toEqual([]);
  expect(call.url).toBe('https://api-m.sandbox.paypal.com/v2/invoicing/invoices');
  expect(call.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(call.body.items.map(item => [item.quantity, item.unit_amount.value])).toEqual([['2', '45.00'], ['1', '80.00'], ['3', '30.00']]);
  expect(errors).toEqual([]);
});

test('a total that differs from the review is called out, not reported as a clean draft', async ({ page, request }) => {
  await request.post(`${origin}/fake/answer`, { data: { status: 201, body: { id: 'INV2-FAKE-0002', status: 'DRAFT', amount: { currency_code: 'USD', value: '283.40' } } } });
  await prepare(page);
  await page.getByRole('button', { name: 'Create sandbox draft' }).click();
  await expect(page.locator('#sandbox-status')).toHaveText('Sandbox draft INV2-FAKE-0002 created, but PayPal shows USD 283.40 and this review says USD 260.00. Check it in the sandbox before using it. No invoice was sent.');
  await expect(page.locator('#sandbox-status')).toHaveClass(/caution/);
});

test('a reply with no total says so instead of implying it was compared', async ({ page, request }) => {
  await request.post(`${origin}/fake/answer`, { data: { status: 201, body: { id: 'INV2-FAKE-0003', status: 'DRAFT' } } });
  await prepare(page);
  await page.getByRole('button', { name: 'Create sandbox draft' }).click();
  await expect(page.locator('#sandbox-status')).toHaveText('Sandbox draft INV2-FAKE-0003 created. PayPal did not return a total to compare. Its status is DRAFT. No invoice was sent.');
});

test('a refused draft shows PayPal\'s reason and can be tried again with the same reference', async ({ page, request }) => {
  await request.post(`${origin}/fake/answer`, { data: { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', debug_id: 'fake-debug-1', details: [{ field: '/detail/invoice_date', issue: 'INVALID_DATE' }] } } });
  await prepare(page);
  await page.getByRole('button', { name: 'Create sandbox draft' }).click();
  await expect(page.locator('#sandbox-status')).toContainText('PayPal refused this draft (422 UNPROCESSABLE_ENTITY). Nothing was created. Issues: /detail/invoice_date INVALID_DATE. Reference: fake-debug-1.');
  await expect(page.locator('#sandbox-draft')).toBeEnabled();
  await page.getByRole('button', { name: 'Create sandbox draft' }).click();
  await expect(page.locator('#sandbox-status')).toContainText('INV2-FAKE-0001');
  const calls = await received(request);
  expect(calls).toHaveLength(2); expect(calls[0].requestId).toBe(calls[1].requestId);
});

test('a lost answer can be asked for again, and PayPal sees the same reference both times', async ({ page, request }) => {
  await request.post(`${origin}/fake/answer`, { data: { status: 500, body: {} } });
  await prepare(page);
  await page.getByRole('button', { name: 'Create sandbox draft' }).click();
  await expect(page.locator('#sandbox-status')).toContainText('PayPal returned 500, so this draft may or may not exist.');
  await expect(page.locator('#sandbox-draft')).toBeEnabled();
  await page.getByRole('button', { name: 'Create sandbox draft' }).click();
  await expect(page.locator('#sandbox-status')).toContainText('INV2-FAKE-0001');
  const calls = await received(request);
  expect(calls).toHaveLength(2); expect(calls[0].requestId).toBe(calls[1].requestId);
});

test('an answer that makes no sense locks the draft so it is checked by hand', async ({ page, request }) => {
  await request.post(`${origin}/fake/answer`, { data: { status: 201, body: { id: 'INV2-FAKE-0004', status: 'SENT' } } });
  await prepare(page);
  await page.getByRole('button', { name: 'Create sandbox draft' }).click();
  await expect(page.locator('#sandbox-status')).toContainText('could not be confirmed');
  await expect(page.locator('#sandbox-draft')).toBeDisabled();
  expect(await received(request)).toHaveLength(1);
});
