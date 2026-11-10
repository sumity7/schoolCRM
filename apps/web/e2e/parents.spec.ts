import { expect, test, type Page } from '@playwright/test';

/** E2E-10 parent portal + notices (R3). Synthetic data; re-runnable (notice titles are run-unique). */
const PASSWORD = 'Correct-Horse-9';
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('identifier').fill(email);
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/(app|select-school)/);
}
const run = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test.describe('E2E-10 parent portal & notices', () => {
  test('owner publishes a section notice; the parent sees their child, attendance and the notice — and nothing else', async ({ browser, page }) => {
    const r = run();
    // staff side
    const staffCtx = await browser.newContext({ baseURL: 'http://localhost:3100' });
    const staff = await staffCtx.newPage();
    await login(staff, 'owner@alpha.test');
    await staff.goto('/app/notices');
    await staff.getByTestId('new-notice').click();
    await staff.getByLabel('Title').fill(`Sports day ${r}`);
    await staff.getByLabel('Message').fill('Sports day is on Friday. White uniform.');
    await staff.getByLabel('Who should see it').selectOption('sections');
    await staff.getByRole('checkbox', { name: /Class 5 A$/ }).check();
    await staff.getByTestId('publish-notice').click();
    await expect(staff.getByTestId('notices-list')).toContainText(`Sports day ${r}`);
    await staffCtx.close();

    // parent side (uses the test's viewport project: desktop or 360 px)
    await login(page, 'parent@alpha.test');
    await expect(page.getByTestId('child-alpha-A1')).toBeVisible();
    await expect(page.getByTestId('child-alpha-A2')).toHaveCount(0); // classmate is not my child
    await expect(page.getByTestId('unread-notices')).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);

    await page.getByTestId('child-alpha-A1').click();
    await expect(page.getByRole('heading', { name: 'Asha1 Rao' })).toBeVisible();
    await expect(page.getByTestId('child-attendance-pct')).toBeVisible();

    const burger = page.getByRole('button', { name: 'Open menu' });
    if (await burger.isVisible()) await burger.click();
    for (const hidden of ['Students', 'Attendance', 'Collect fee', 'Audit log']) await expect(page.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Notices', exact: true }).click();
    const notice = page.getByRole('button', { name: new RegExp(`Sports day ${r}`) });
    await notice.click();
    await expect(page.getByText('Sports day is on Friday. White uniform.')).toBeVisible();
    await page.reload();
    const card = page.getByTestId('notices-list').getByRole('button', { name: new RegExp(`Sports day ${r}`) });
    await expect(card.getByLabel('unread')).toHaveCount(0); // read receipt stored
    // the staff screens and APIs stay closed
    const res = await page.request.get('/api/v1/students', { headers: { 'X-Requested-With': 'edunex' } });
    expect(res.status()).toBe(403);
  });
});
