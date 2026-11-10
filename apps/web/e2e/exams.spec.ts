import { expect, test, type Browser, type Page } from '@playwright/test';

/** E2E-11 exams & results (R4). Re-runnable: scale and exam names are run-unique. */
const PASSWORD = 'Correct-Horse-9';
const WEB = 'http://localhost:3100';
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('identifier').fill(email);
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/(app|select-school)/);
}
const run = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
async function asUser(browser: Browser, email: string) {
  const ctx = await browser.newContext({ baseURL: WEB });
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  await login(page, email);
  return { ctx, page };
}
async function enterMarks(page: Page, sectionLabel: string, values: Record<string, string>) {
  await page.getByTestId('marks-section').selectOption({ label: sectionLabel });
  for (const [adm, v] of Object.entries(values)) await page.getByTestId(`marks-${adm}`).fill(v);
  await page.getByTestId('save-marks').click();
  await expect(page.getByTestId('marks-saved')).toContainText('Saved marks');
}

test.describe('E2E-11 exams & results', () => {
  test('scale → exam → teacher enters marks → lock → compute → publish → parent sees result and report card', async ({ browser, page }) => {
    test.setTimeout(240_000);
    const r = run();
    const owner = await asUser(browser, 'owner@alpha.test');
    const o = owner.page;
    await o.goto('/app/exams');
    await o.getByRole('tab', { name: 'Grading scales' }).click();
    await o.getByTestId('new-scale').click();
    await o.getByLabel('Name').fill(`Scale ${r}`);
    await o.getByRole('button', { name: 'Save draft' }).click();
    await o.locator('div', { hasText: `Scale ${r}` }).getByTestId('publish-scale').last().click();
    await o.getByRole('tab', { name: 'Exams' }).click();
    await o.getByTestId('new-exam').click();
    await o.getByLabel('Name').fill(`Term ${r}`);
    await o.getByLabel('Grading scale').selectOption({ label: `Scale ${r} v1` });
    await o.getByRole('checkbox', { name: 'Class 5' }).check();
    await o.getByTestId('create-exam').click();
    await o.waitForURL(/\/app\/exams\/[a-f0-9]{24}$/);
    const examUrl = o.url();
    await o.getByTestId('add-exam-subject').click(); // default: first subject (Mathematics), 100 / 33
    await o.getByTestId('save-exam-subjects').click();
    await expect(o.getByText('Saved.')).toBeVisible();
    await o.getByTestId('open-marks').click();
    await expect(o.getByTestId('lock-marks')).toBeVisible();

    // teacher Tina (assigned to 5A maths) enters marks for her section only
    const teacher = await asUser(browser, 'tina@alpha.test');
    await teacher.page.goto(`${examUrl}/marks`);
    await expect(teacher.page.getByTestId('marks-section').locator('option')).toHaveCount(1); // only 5A
    await enterMarks(teacher.page, 'Class 5 A', { 'alpha-A1': '92', 'alpha-A2': '74.5', 'alpha-A3': '30' });
    await teacher.ctx.close();

    // owner completes section B, locks, computes, publishes
    await o.goto(`${examUrl}/marks`);
    await enterMarks(o, 'Class 5 B', { 'alpha-B1': '60', 'alpha-B2': '55', 'alpha-B3': '40' });
    await o.goto(examUrl);
    await o.getByTestId('lock-marks').click();
    await o.getByTestId('compute-results').click();
    await expect(o.getByText(/Computed \d+ results/)).toBeVisible();
    await o.getByRole('combobox', { name: 'Section' }).selectOption({ label: 'Class 5 A' });
    const rows = o.getByTestId('results-table');
    await expect(rows).toContainText('Asha1 Rao');
    await expect(rows.locator('tbody tr').first()).toContainText('92'); // rank 1
    await expect(rows).toContainText('fail'); // 30 < 33
    await o.getByTestId('publish-results').click();
    await expect(o.getByText(/Published/).first()).toBeVisible();
    await owner.ctx.close();

    // parent of Asha1 (project viewport) sees the published result and downloads the report card
    await login(page, 'parent@alpha.test');
    await page.getByTestId('child-alpha-A1').click();
    await page.getByRole('tab', { name: 'results' }).click();
    const card = page.getByTestId('child-result').filter({ hasText: `Term ${r}` });
    await expect(card).toContainText('92%');
    const [pdfRes] = await Promise.all([
      page.waitForResponse((res) => /\/results\/[a-f0-9]{24}\/report-card\.pdf$/.test(res.url())),
      card.getByRole('button', { name: 'Report card' }).click(),
    ]);
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()['content-type']).toBe('application/pdf');
  });
});
