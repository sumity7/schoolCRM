import { expect, test, type Page } from '@playwright/test';
import { WEB_ORIGIN } from './env';

/**
 * E2E-14 student activation journey and E2E-15 parent child switching (Phase A). Synthetic data only; re-runnable
 * (activating again simply re-issues access, which resets the previous password).
 */
const PASSWORD = 'Correct-Horse-9';
const HDR = { 'X-Requested-With': 'edunex' };
async function login(page: Page, id: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByTestId('identifier').fill(id);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/(app|select-school)/);
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const pathOf = (url: string) => { const u = new URL(url); return u.pathname + u.search; };

test.describe('E2E-14 student activation journey', () => {
  test('staff issue a one-time link; the student sets their own password, signs in and sees only their dashboard; the link cannot be reused', async ({ browser, page }) => {
    page.on('dialog', (d) => void d.accept());
    await login(page, 'owner@alpha.test');
    const list = await page.request.get('/api/v1/students?limit=100', { headers: HDR });
    const row = (await list.json()).data.find((s: { admissionNo: string }) => s.admissionNo === 'alpha-A3');
    await page.goto(`/app/students/${row.id}`);
    await page.getByTestId('issue-student-access').click();
    const url = (await page.getByTestId('activation-url').textContent())!.trim();
    expect(url).toMatch(/\/accept-invite\?token=/);
    await expect(page.getByTestId('student-login-card')).toContainText('alpha-a3@alpha.student');
    await expect(page.getByTestId('student-login-card')).toContainText('waiting for activation');

    // the student (a different browser, nobody signed in) cannot sign in before activating
    const ctx = await browser.newContext({ baseURL: WEB_ORIGIN, viewport: page.viewportSize() ?? undefined });
    const stu = await ctx.newPage();
    await stu.goto('/login');
    await stu.getByTestId('identifier').fill('alpha-a3@alpha.student');
    await stu.getByTestId('password').fill('Whatever-123');
    await stu.getByTestId('login-submit').click();
    await expect(stu.getByRole('alert').filter({ hasText: 'Invalid credentials' })).toBeVisible();

    // activation: a weak password is refused client-side, then a valid one works
    await stu.goto(pathOf(url));
    await stu.getByTestId('password').fill('short');
    await stu.getByTestId('accept-submit').click();
    await expect(stu.getByText(/at least 10 characters/)).toBeVisible();
    await stu.getByTestId('password').fill('Student-Own-Pass-1');
    await stu.getByTestId('accept-submit').click();
    await expect(stu.getByTestId('accept-done')).toBeVisible();

    await login(stu, 'alpha-a3@alpha.student', 'Student-Own-Pass-1');
    await expect(stu).toHaveURL(/\/app$/);
    await expect(stu.getByTestId('student-home')).toBeVisible();
    await expect(stu.getByRole('heading', { level: 1 })).toContainText('Asha3 Rao');
    expect(await noHorizontalScroll(stu)).toBe(true);
    // staff areas are closed to them
    expect((await stu.request.get('/api/v1/students', { headers: HDR })).status()).toBe(403);
    expect((await stu.request.get('/api/v1/parent/children', { headers: HDR })).status()).toBe(403);
    await ctx.close();

    // the same link is single-use
    const ctx2 = await browser.newContext({ baseURL: WEB_ORIGIN });
    const again = await ctx2.newPage();
    await again.goto(pathOf(url));
    await again.getByTestId('password').fill('Another-Pass-77');
    await again.getByTestId('accept-submit').click();
    await expect(again.getByRole('alert').filter({ hasText: 'invalid or has expired' })).toBeVisible();
    await ctx2.close();
  });
});

test.describe('E2E-15 parent child switching', () => {
  test('a parent with two children switches between them; each view shows that child; profile + school contact; no other child is reachable', async ({ page }) => {
    await login(page, 'twins@alpha.test');
    await expect(page.getByTestId('child-alpha-A2')).toBeVisible();
    await expect(page.getByTestId('child-alpha-A3')).toBeVisible();
    await expect(page.getByTestId('child-alpha-A1')).toHaveCount(0); // not this parent's child
    expect(await noHorizontalScroll(page)).toBe(true);

    await page.getByTestId('child-alpha-A2').click();
    await expect(page.getByRole('heading', { name: 'Asha2 Rao' })).toBeVisible();
    await expect(page.getByTestId('child-switcher')).toBeVisible();
    await page.getByRole('tab', { name: 'profile' }).click();
    await expect(page.getByTestId('child-profile')).toContainText('alpha-A2');
    await expect(page.getByTestId('school-contact')).toBeVisible();

    await page.getByTestId('switch-alpha-A3').click(); // switch child — the profile tab stays, content follows the child
    await expect(page.getByRole('heading', { name: 'Asha3 Rao' })).toBeVisible();
    await expect(page.getByTestId('child-profile')).toContainText('alpha-A3');
    await expect(page.getByTestId('child-profile')).not.toContainText('alpha-A2');
    await expect(page.getByTestId('switch-alpha-A3')).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/\/app\/children\/[a-f0-9]{24}\?tab=profile$/); // the tab lives in the URL
    await page.reload();
    await expect(page.getByTestId('child-profile')).toContainText('alpha-A3'); // reload keeps child AND tab
    await page.getByTestId('switch-alpha-A2').click();
    await expect(page.getByTestId('child-profile')).toContainText('alpha-A2');
    await expect(page.getByTestId('child-profile')).not.toContainText('alpha-A3');
    // only allow-listed tab values are honoured; anything else falls back to attendance
    const base = page.url().split('?')[0]!;
    await page.goto(`${base}?tab=%3Cscript%3E`);
    await expect(page.getByRole('tab', { name: 'attendance' })).toHaveAttribute('aria-selected', 'true');
    await page.goto(`${base}?tab=profile`);
    await page.getByTestId('switch-alpha-A3').click();
    expect(await noHorizontalScroll(page)).toBe(true);

    // URL manipulation to a child that is not linked: the server answers 404 and the page shows nothing about them
    const kids = await page.request.get('/api/v1/parent/children', { headers: HDR });
    expect((await kids.json()).data).toHaveLength(2);
    const stranger = '0123456789abcdef01234567';
    expect((await page.request.get(`/api/v1/parent/children/${stranger}/profile`, { headers: HDR })).status()).toBe(404);
    await page.goto(`/app/children/${stranger}`);
    await expect(page.getByText('Child not found.')).toBeVisible();
  });

  test('a parent with a single child gets no switcher', async ({ page }) => {
    await login(page, 'parent@alpha.test');
    await page.getByTestId('child-alpha-A1').click();
    await expect(page.getByRole('heading', { name: 'Asha1 Rao' })).toBeVisible();
    await expect(page.getByTestId('child-switcher')).toHaveCount(0);
  });
});
