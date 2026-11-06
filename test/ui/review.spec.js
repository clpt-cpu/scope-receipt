import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Keep generated images inside this project, including when it is copied for judging.
const previewDir = resolve('test-results/previews');
test('read notes, review USD 260 and download a real source-linked draft', async ({ page }) => {
  const errors = [], remote = []; page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:4318') && !req.url().startsWith('data:')) remote.push(req.url()); });
  await page.goto('/'); await expect(page.locator('#note-count')).toHaveText('8 NOTES');
  await expect(page.locator('#extra-count')).toHaveText('3'); await expect(page.locator('#prepare')).toBeDisabled();
  await mkdir(previewDir, { recursive: true }); await page.screenshot({ path: resolve(previewDir, 'scope-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Select extra requests' }).click();
  await expect(page.locator('#selection-count')).toHaveText('3 items selected'); await expect(page.locator('#selected-total')).toHaveText('$260.00');
  await page.locator('#review-confirm').check(); await page.getByRole('button', { name: /Review invoice draft/ }).click();
  await expect(page.locator('#preview-total')).toHaveText('USD 260.00'); await expect(page.locator('#preview-lines .preview-line')).toHaveCount(3);
  await expect(page.locator('#sandbox-draft')).toBeDisabled();
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download PayPal draft JSON' }).click();
  const download = await wait; const payload = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(payload.items.map(i => i.unit_amount.value)).toEqual(['45.00', '80.00', '30.00']);
  expect(payload.items.every(i => i.description.startsWith('Source N-'))).toBe(true);
  await page.screenshot({ path: resolve(previewDir, 'scope-draft.png'), fullPage: true });
  expect(errors).toEqual([]); expect(remote).toEqual([]);
});
test('editing a source after review invalidates the draft', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#note-count')).toHaveText('8 NOTES');
  await page.getByRole('button', { name: 'Select extra requests' }).click(); await page.locator('#review-confirm').check();
  await page.locator('#notes').fill('Client requested 1 extra page, at $55.');
  await expect(page.locator('#prepare')).toBeDisabled();
  await page.locator('#review-confirm').check(); await expect(page.locator('#message')).toContainText('source notes changed');
  await expect(page.locator('#prepare')).toBeDisabled();
});
test('grid category filter and source inspection work without changing the original note', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#note-count')).toHaveText('8 NOTES');
  await page.getByRole('button', { name: /^Extra requests/ }).click();
  await expect(page.getByRole('row').filter({ has: page.getByRole('gridcell', { name: 'Extra request', exact: true }) })).toHaveCount(3);
  await page.getByRole('gridcell', { name: 'Client added 1 extra window sign, at $80. N-04', exact: true }).click();
  await expect(page.locator('#source-inspector')).toContainText('Client added 1 extra window sign, at $80.');
});
test('project details reach the payload and editing a quantity invalidates review', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#note-count')).toHaveText('8 NOTES');
  await page.getByRole('button', { name: 'Edit project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Sample signage project');
  await page.getByRole('textbox', { name: 'Quote reference' }).fill('Q-020');
  await page.getByRole('button', { name: 'Save project' }).click();
  await page.getByRole('button', { name: 'Select extra requests' }).click();
  await page.locator('#review-confirm').check();
  const row = page.getByRole('row').filter({ has: page.getByRole('gridcell', { name: 'Client requested 2 additional poster layouts outside the quote, at $45 each. N-02', exact: true }) });
  await row.getByRole('gridcell', { name: '2', exact: true }).dblclick();
  await row.getByRole('textbox').fill('3'); await row.getByRole('textbox').press('Enter');
  await expect(page.locator('#selected-total')).toHaveText('$305.00'); await expect(page.locator('#review-confirm')).not.toBeChecked();
  await page.locator('#review-confirm').check(); await page.getByRole('button', { name: /Review invoice draft/ }).click();
  await expect(page.locator('#preview-meta')).toContainText('Q-020'); await expect(page.locator('#preview-total')).toHaveText('USD 305.00');
});
test('an unclear price shows why it was left blank and blocks the draft until it is entered', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#note-count')).toHaveText('8 NOTES');
  await page.locator('#notes').fill('Client added 2 extra posters at $40 each plus $15 delivery.\nClient asked for one extra poster for $1,200.');
  await page.getByRole('button', { name: /Read the notes/ }).click(); await expect(page.locator('#note-count')).toHaveText('2 NOTES');
  await expect(page.locator('#source-inspector')).toContainText('more than one amount');
  await page.getByRole('button', { name: 'Select extra requests' }).click();
  await expect(page.locator('#selected-total')).toHaveText('$1,200.00');
  await page.locator('#review-confirm').check(); await expect(page.locator('#prepare')).toBeDisabled();
});
test.describe('east of UTC', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });
  test('the invoice date is the operator\'s calendar date', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-01T16:30:00Z'));
    await page.goto('/'); await expect(page.locator('#invoice-date')).toHaveValue('2026-11-02');
  });
});
test('mobile review can create a draft without document-level horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await expect(page.locator('#note-count')).toHaveText('8 NOTES');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Select extra requests' }).click(); await page.locator('#review-confirm').check();
  await page.getByRole('button', { name: /Review invoice draft/ }).click(); await expect(page.locator('#preview-total')).toHaveText('USD 260.00');
  await page.screenshot({ path: resolve(previewDir, 'scope-mobile.png'), fullPage: true });
});
