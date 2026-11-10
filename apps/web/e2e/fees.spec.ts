import { expect, test, type Page } from '@playwright/test';

/** E2E-09 fee desk (doc 11 §2.1 "later releases add their own critical flows (e.g. R2 fee collection)"). Synthetic data; re-runnable. */
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
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function api(page: Page, method: 'GET' | 'POST', path: string, data?: object) {
  const res = await page.request.fetch(`${WEB}/api/v1${path}`, { method, data, headers: { Origin: WEB, 'X-Requested-With': 'edunex', ...(data ? { 'Content-Type': 'application/json' } : {}) } });
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()).data;
}

test.describe('E2E-09 fee desk', () => {
  test('bill an instalment → collect part-payment → balance updates → receipt PDF → reversal request', async ({ page }) => {
    page.on('dialog', (d) => void d.accept());
    const r = run();
    await login(page, 'owner@alpha.test');

    // setup through the API (setup screens are covered by API tests; this flow is about the fee desk)
    const sessions = await api(page, 'GET', '/academics/sessions');
    const session = sessions.find((s: { status: string }) => s.status === 'active');
    const classes = await api(page, 'GET', '/classes');
    const cat = await api(page, 'POST', '/fees/categories', { key: `t_${r}`, name: `Tuition ${r}`, kind: 'tuition' });
    const st = await api(page, 'POST', '/fees/structures', { sessionId: session.id, classId: classes[0].id, name: `E2E ${r}`, items: [{ categoryId: cat.id, installments: [{ label: 'Term 1', dueDate: addDays(today(), -5), amountPaise: 1_200_000 }] }] });
    await api(page, 'POST', `/fees/structures/${st.id}/publish`, {});

    // 1. bill from the Invoices screen
    await page.goto('/app/fees/invoices');
    await page.getByTestId('generate-invoices').click();
    await page.getByLabel('Fee structure', { exact: true }).selectOption({ label: `${classes[0].name} · E2E ${r} (v1)` });
    await page.getByLabel('Instalment', { exact: true }).selectOption('Term 1');
    const sectionA = (await api(page, 'GET', '/sections')).find((s: { name: string; classId: string }) => s.name === 'A' && s.classId === classes[0].id);
    await page.getByLabel('Section (optional)', { exact: true }).selectOption(sectionA.id);
    await page.getByTestId('generate-confirm').click();
    await expect(page.getByTestId('generate-result')).toContainText('3 invoices created');
    await page.getByRole('button', { name: 'Done' }).click();

    // 2. collect ₹5,000 of the ₹12,000 from Asha1
    await page.goto('/app/fees/collect');
    await page.getByTestId('fee-student-search').fill('alpha-A1');
    await page.getByTestId('pick-alpha-A1').click();
    await expect(page.getByTestId('fee-student-name')).toHaveText('Asha1 Rao');
    const balanceBefore = await page.getByTestId('fee-balance').innerText();
    await page.getByTestId('fee-amount').fill('5000');
    await page.getByTestId('fee-mode').selectOption('upi');
    await page.getByTestId('fee-review').click();
    await expect(page.getByTestId('confirm-amount')).toHaveText('₹5,000.00');
    await page.getByTestId('fee-confirm').click();
    await expect(page.getByTestId('payment-done')).toBeVisible();
    const receiptNo = await page.getByTestId('receipt-no').innerText();
    expect(receiptNo).toMatch(/^ALPHA\/\d{4}-\d{2}\/\d{6}$/);
    expect(await noHorizontalScroll(page)).toBe(true);

    // 3. the receipt opens as a real PDF
    const [popup, pdfRes] = await Promise.all([
      page.waitForEvent('popup'),
      page.waitForResponse((res) => /\/fees\/payments\/[a-f0-9]{24}\/receipt\.pdf$/.test(res.url())),
      page.getByTestId('print-receipt').click(),
    ]);
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()['content-type']).toBe('application/pdf');
    // same URL, same cookies, same Next.js proxy path — Playwright cannot always capture a body the page consumed as a blob
    const again = await page.request.get(pdfRes.url(), { headers: { 'X-Requested-With': 'edunex' } });
    const pdfBody = await again.body();
    expect(pdfBody.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfBody.length).toBeGreaterThan(5_000);
    await popup.waitForURL(/^blob:/); // the new tab shows the PDF
    await popup.close();

    // 4. balance went down by exactly ₹5,000 (the student also has older invoices from other runs, so compare deltas)
    await page.getByRole('button', { name: 'Collect from another student' }).click();
    await page.getByTestId('fee-student-search').fill('alpha-A1');
    await page.getByTestId('pick-alpha-A1').click();
    const toPaise = (s: string) => Math.round(Number(s.replace(/[₹,]/g, '')) * 100);
    await expect.poll(async () => toPaise(await page.getByTestId('fee-balance').innerText())).toBe(toPaise(balanceBefore) - 500_000);

    // 5. request a reversal from the Payments screen; it shows under Approvals as the owner's own request
    await page.goto('/app/fees/payments');
    const row = page.getByTestId('payments-table').locator('tr', { hasText: receiptNo });
    await row.getByRole('button', { name: 'Reverse…' }).click();
    await page.getByLabel('Reason (e.g. cheque bounced, wrong student)').fill('E2E wrong amount');
    await page.getByRole('button', { name: 'Request reversal' }).click();
    await expect(page.getByText('Reversal requested.')).toBeVisible();
    await page.goto('/app/fees/approvals');
    const pending = page.getByTestId('pending-requests').locator('tr', { hasText: receiptNo });
    await expect(pending).toContainText('your request'); // separation of duties: no approve button for the requester
    await expect(pending.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  test('fee screens are hidden from teachers and refused by the API', async ({ page }) => {
    await login(page, 'tina@alpha.test');
    const burger = page.getByRole('button', { name: 'Open menu' });
    if (await burger.isVisible()) await burger.click();
    await expect(page.getByRole('link', { name: 'Collect fee', exact: true })).toHaveCount(0);
    const res = await page.request.get(`${WEB}/api/v1/fees/invoices`, { headers: { 'X-Requested-With': 'edunex' } });
    expect(res.status()).toBe(403);
  });
});
