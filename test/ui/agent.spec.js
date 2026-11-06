import { test, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:4321';

test('the AI reader splits a message, highlights its quote and leaves a budget for the operator to price', async ({ page }) => {
  await page.goto(`${origin}/`);
  await expect(page.locator('input[name=reader][value=agent]')).toBeChecked();
  await expect(page.locator('#agent-label')).toHaveText('gemma4:12b-it-qat via local Ollama');
  await expect(page.locator('#notes')).toHaveValue(/sidewalk sign/);
  await page.getByRole('button', { name: /Read the notes/ }).click();
  await expect(page.locator('#note-count')).toHaveText('8 NOTES · 9 REQUESTS');
  await expect(page.locator('#extra-count')).toHaveText('3');
  await page.getByRole('row').filter({ hasText: 'N-04a' }).locator('[col-id=description]').click();
  await expect(page.locator('#source-inspector mark')).toHaveText('sidewalk sign');
  await expect(page.locator('#source-inspector')).toContainText('Price left for you to enter');
  await expect(page.locator('#source-inspector')).toContainText('reads as a budget');
  await page.getByRole('button', { name: 'Select extra requests' }).click();
  await expect(page.locator('#selected-total')).toHaveText('$180.00');
  await page.locator('#review-confirm').check();
  await expect(page.locator('#prepare')).toBeDisabled();
  const sign = page.getByRole('row').filter({ hasText: 'N-04a' });
  await sign.locator('[col-id=unitAmount]').dblclick();
  await sign.getByRole('spinbutton').fill('80'); await sign.getByRole('spinbutton').press('Enter');
  await expect(page.locator('#selected-total')).toHaveText('$260.00');
  await expect(page.locator('.ag-row.row-total')).toContainText('Selected work · 3 requests');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#selected-total')).toHaveText('$180.00');
  await page.keyboard.press('Control+y');
  await expect(page.locator('#selected-total')).toHaveText('$260.00');
  await page.locator('#review-confirm').check(); await page.getByRole('button', { name: /Review invoice draft/ }).click();
  await expect(page.locator('#preview-total')).toHaveText('USD 260.00');
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download scope receipt' }).click();
  const receipt = await (await wait).createReadStream(); let text = ''; for await (const chunk of receipt) text += chunk;
  expect(text).toContain('| Sidewalk sign | 1 | 80.00 | 80.00 | N-04a |');
  expect(text).toContain('local language model');
});

test('an operator can correct a category, and the review table exports to CSV without running formulas', async ({ page }) => {
  await page.goto(`${origin}/`);
  await page.getByRole('button', { name: /Read the notes/ }).click();
  await expect(page.locator('#note-count')).toHaveText('8 NOTES · 9 REQUESTS');
  // Found by row id: while a description is being edited, the row no longer shows its N-07 label.
  const row = page.locator('.ag-row[row-id="N-07"]');
  await row.locator('[col-id=category]').dblclick();
  await row.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Check meaning' }).click();
  await expect(row.locator('.category-badge')).toHaveText('Check meaning');
  await expect(row.locator('.category-badge')).toHaveClass(/overridden/);
  await page.locator('#grid-search').fill('Korean');
  await expect(page.locator('.ag-row:not(.row-total)')).toHaveCount(1);
  await page.locator('#grid-search').fill('');
  await row.locator('[col-id=description]').dblclick();
  await row.getByRole('textbox').fill('=1+1'); await row.getByRole('textbox').press('Enter');
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV' }).click();
  const stream = await (await wait).createReadStream(); let csv = ''; for await (const chunk of stream) csv += chunk;
  expect(csv).toContain(`"'=1+1","Check meaning"`);
  expect(csv).toContain('"Poster layout","Extra request","2","45.00","90.00"');
});
