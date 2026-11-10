import { expect, test, type Page } from '@playwright/test';

/**
 * E2E-13 login-page demo accounts (development only). The E2E API runs with DEMO_LOGIN_ENABLED=true and seeds the demo
 * school + accounts with the same idempotent seeder as `npm run seed:demo`. Clicking a card must only FILL the form.
 */
const PASSWORD = 'Correct-Horse-9';
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function openLogin(page: Page) {
  await page.goto('/login');
  await expect(page.getByTestId('demo-section')).toBeVisible();
}
async function pick(page: Page, key: string, identifier: string) {
  await page.getByTestId(`demo-${key}`).click();
  await expect(page.getByTestId('identifier')).toHaveValue(identifier);
  await expect(page.getByTestId('password')).toHaveValue(PASSWORD);
  await expect(page.getByTestId('demo-loaded')).toHaveText('Demo credentials loaded.');
  await expect(page.getByTestId(`demo-${key}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/login$/); // nothing was submitted
}

test.describe('E2E-13 login demo accounts', () => {
  test('cards, fill-only behaviour, clear, password toggle, no overflow', async ({ page }) => {
    await openLogin(page);
    for (const k of ['super_admin', 'school_admin', 'teacher', 'accountant', 'parent', 'student']) await expect(page.getByTestId(`demo-${k}`)).toBeEnabled();
    await expect(page.getByText('Try EduNex ERP Demo')).toBeVisible();
    await expect(page.getByText('Explore EduNex ERP using demo accounts for different user roles.')).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);

    await pick(page, 'school_admin', 'owner@demo.test');
    await expect(page.getByTestId('password')).toHaveAttribute('type', 'password');
    await page.getByTestId('toggle-password').click();
    await expect(page.getByTestId('password')).toHaveAttribute('type', 'text');
    await page.getByTestId('toggle-password').click();
    await pick(page, 'teacher', 'tina@demo.test'); // switching card replaces the credentials and the selected state
    await expect(page.getByTestId('demo-school_admin')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('demo-clear').click();
    await expect(page.getByTestId('identifier')).toHaveValue('');
    await expect(page.getByTestId('password')).toHaveValue('');
    await expect(page.getByTestId('demo-loaded')).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('typing your own identifier ends the demo-selected state', async ({ page }) => {
    await openLogin(page);
    await pick(page, 'school_admin', 'owner@demo.test');
    await page.getByTestId('identifier').fill('someone.else@example.test');
    await expect(page.getByTestId('demo-loaded')).toHaveCount(0);
    await expect(page.getByTestId('demo-school_admin')).toHaveAttribute('aria-pressed', 'false');
  });

  const journeys: Array<{ key: string; id: string; check: (page: Page) => Promise<void> }> = [
    { key: 'school_admin', id: 'owner@demo.test', check: async (p) => { await expect(p).toHaveURL(/\/app$/); await expect(p.getByTestId('dashboard-title')).toHaveText('School admin dashboard'); } },
    { key: 'teacher', id: 'tina@demo.test', check: async (p) => { await expect(p).toHaveURL(/\/app$/); await expect(p.getByTestId('dashboard-title')).toHaveText('Teacher dashboard'); } },
    { key: 'accountant', id: 'accountant@demo.test', check: async (p) => { await expect(p).toHaveURL(/\/app$/); await expect(p.getByTestId('dashboard-title')).toHaveText('Finance dashboard'); await expect(p.getByTestId('stat-collected')).toBeVisible(); } },
    { key: 'parent', id: 'parent@demo.test', check: async (p) => { await expect(p).toHaveURL(/\/app$/); await expect(p.getByTestId('child-demo-A1')).toBeVisible(); } },
    { key: 'student', id: 'demo-a1@demo.student', check: async (p) => { await expect(p).toHaveURL(/\/app$/); await expect(p.getByTestId('student-home')).toBeVisible(); await expect(p.getByRole('heading', { level: 1 })).toContainText('Asha1 Rao'); } },
    { key: 'super_admin', id: 'root@demo.test', check: async (p) => { await expect(p).toHaveURL(/\/platform$/); await expect(p.getByText('Turn on two-factor authentication to use the platform console.')).toBeVisible(); } },
  ];
  for (const j of journeys) {
    test(`${j.key}: card fills the form, Sign in is still required, then the correct dashboard opens`, async ({ page }) => {
      await openLogin(page);
      await pick(page, j.key, j.id);
      await page.getByTestId('login-submit').click(); // the ordinary Sign in button
      await j.check(page);
      // authorization comes from the server session, not from the card: staff APIs behave according to the real role
      const students = await page.request.get('/api/v1/students', { headers: { 'X-Requested-With': 'edunex' } });
      expect([j.key === 'school_admin' || j.key === 'teacher' || j.key === 'accountant' ? 200 : 403, j.key === 'accountant' ? 200 : 0]).toContain(students.status());
    });
  }

  test('invalid credentials are rejected even when a demo card was used', async ({ page }) => {
    await openLogin(page);
    await pick(page, 'school_admin', 'owner@demo.test');
    await page.getByTestId('password').fill('Definitely-Wrong-9');
    await page.getByTestId('login-submit').click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid credentials' })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login/);
  });

  test('unconfigured accounts show no credentials and cannot be selected; student appears only when it really exists', async ({ page }) => {
    await page.route('**/api/v1/auth/demo-accounts', (route) =>
      route.fulfill({
        json: { data: [
          { key: 'school_admin', label: 'School Admin', description: 'x', available: true, identifier: 'owner@demo.test', password: PASSWORD },
          { key: 'parent', label: 'Parent', description: 'x', available: false },
          { key: 'student', label: 'Student', description: 'x', available: false },
        ] },
      }),
    );
    await openLogin(page);
    await expect(page.getByTestId('demo-school_admin')).toBeEnabled();
    for (const k of ['parent', 'student']) {
      await expect(page.getByTestId(`demo-${k}`)).toBeDisabled();
      await expect(page.getByTestId(`demo-${k}`)).toContainText('Demo account not configured yet.');
      await expect(page.getByTestId(`demo-${k}`)).not.toContainText('Try Demo');
    }
    await page.getByTestId(`demo-student`).click({ force: true }).catch(() => undefined);
    await expect(page.getByTestId('identifier')).toHaveValue('');
    const html = await page.content();
    expect(html).not.toContain('parent@demo.test');
    expect(html).not.toContain('demo-a1@demo.student');
  });

  test('when the server does not offer demo accounts (production behaviour) the section is absent', async ({ page }) => {
    await page.route('**/api/v1/auth/demo-accounts', (route) => route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Resource not found' } } }));
    await page.goto('/login');
    await expect(page.getByTestId('identifier')).toBeVisible();
    await expect(page.getByTestId('demo-section')).toHaveCount(0);
    await expect(page.getByText('Try EduNex ERP Demo')).toHaveCount(0);
    expect(await page.content()).not.toContain(PASSWORD);
  });
});
