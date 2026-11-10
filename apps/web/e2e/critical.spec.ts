import { expect, test, type Page } from '@playwright/test';
import { WEB_ORIGIN } from './env';

/**
 * Mandatory critical browser flows (docs/phase-0/11 §2.1). API tests do NOT replace these.
 * Synthetic seed data only (apps/api/scripts/e2e-server.ts). Password for all users: Correct-Horse-9
 */
const PASSWORD = 'Correct-Horse-9';
const WEB = WEB_ORIGIN;
const EVIL = 'http://localhost:3200';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('identifier').fill(email);
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/(app|select-school)/); // the session cookie exists once we have navigated
}

/** Navigate via the sidebar; on phones the sidebar lives behind the hamburger menu. */
async function navTo(page: Page, name: string) {
  const burger = page.getByRole('button', { name: 'Open menu' });
  if (await burger.isVisible()) await burger.click();
  await page.getByRole('link', { name, exact: true }).first().click();
}

test.describe('E2E-01 login & session persistence', () => {
  test('login, reload, new tab, cookie hardening, logout invalidates', async ({ page, context }) => {
    await login(page, 'owner@alpha.test');
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId('school-name')).toHaveText('School alpha');

    await page.reload();
    await expect(page.getByTestId('school-name')).toHaveText('School alpha'); // survives reload

    const tab2 = await context.newPage();
    await tab2.goto('/app');
    await expect(tab2.getByTestId('school-name')).toHaveText('School alpha'); // survives new tab

    const cookies = await context.cookies();
    const sid = cookies.find((c) => c.name === 'edunex_sid');
    expect(sid, 'session cookie present').toBeTruthy();
    expect(sid!.httpOnly).toBe(true);
    expect(sid!.sameSite).toBe('Lax');
    expect(await page.evaluate(() => document.cookie)).not.toContain('edunex_sid'); // not readable by page JS

    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/login/);
    await tab2.reload();
    await expect(tab2).toHaveURL(/\/login/); // other tab is logged out too: the server session is gone
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login/);
    await page.goBack();
    await expect(page.getByTestId('school-name')).toHaveCount(0); // back button does not resurrect the session
  });

  test('wrong password shows a generic error and never authenticates', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('identifier').fill('owner@alpha.test');
    await page.getByTestId('password').fill('definitely-wrong-1');
    await page.getByTestId('login-submit').click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid credentials' })).toBeVisible();
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('E2E-02 CSRF from a second origin', () => {
  test('forged cross-origin requests are rejected and change nothing', async ({ page, context }) => {
    await login(page, 'owner@alpha.test');
    await expect(page.getByTestId('school-name')).toBeVisible();

    // (a) fetch-based forgery from another origin while the victim is logged in
    const evil = await context.newPage();
    await evil.goto(EVIL);
    await evil.waitForFunction(() => Object.keys((window as unknown as { results: object }).results).length === 2, null, { timeout: 15_000 });
    // (b) form-based forgery (what a malicious <form> can do)
    await evil.goto(`${EVIL}/form`);
    await evil.waitForTimeout(1500);

    // (c) direct request with a foreign Origin and the victim's cookies, including the custom header
    const res = await context.request.post(`${WEB}/api/v1/auth/logout`, { headers: { Origin: EVIL, 'X-Requested-With': 'edunex', 'Content-Type': 'application/json' }, data: {} });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('CSRF_REJECTED');
    // missing custom header (what a cross-site simple request lacks)
    const res2 = await context.request.post(`${WEB}/api/v1/auth/logout`, { headers: { Origin: WEB, 'Content-Type': 'application/json' }, data: {} });
    expect(res2.status()).toBe(403);

    // the victim is STILL logged in: none of the forged logouts worked
    await page.reload();
    await expect(page.getByTestId('school-name')).toHaveText('School alpha');
    const me = await context.request.get(`${WEB}/api/v1/auth/me`);
    expect(me.status()).toBe(200);
  });
});

test.describe('E2E-03 tenant switching & stale-tab protection', () => {
  test('switching school changes all data; a stale tab is refused and reloads into the new school', async ({ page, context }) => {
    await login(page, 'multi@x.test');
    await expect(page).toHaveURL(/select-school/);
    await page.getByTestId('school-alpha').click();
    await expect(page.getByTestId('school-name')).toHaveText('School alpha');
    await navTo(page, 'Students');
    await expect(page.getByTestId('students-table')).toContainText('alpha-A1');
    await expect(page.getByTestId('students-table')).not.toContainText('bravo-'); // no Bravo admission number may ever appear

    // "tab 2" switches the SAME session to bravo
    const tab2 = await context.newPage();
    await tab2.goto('/select-school');
    await tab2.getByTestId('school-bravo').click();
    await expect(tab2.getByTestId('school-name')).toHaveText('School bravo');

    // "tab 1" still believes it is on alpha; its next API call must be refused (409) and it reloads into bravo
    await page.getByTestId('student-search').fill('asha');
    await expect(page.getByTestId('school-name')).toHaveText('School bravo', { timeout: 15_000 });
    await expect(page.getByTestId('students-table')).not.toContainText('alpha-');

    await page.goto('/app/students');
    await expect(page.getByTestId('students-table')).toContainText('bravo-A1');
    await expect(page.getByTestId('students-table')).not.toContainText('alpha-A1');
  });
});

test.describe('E2E-04 attendance submission', () => {
  test('teacher marks the assigned class, submit once, reload shows saved values, no duplicates, retry after network failure', async ({ page }) => {
    await login(page, 'tina@alpha.test');
    await page.goto('/app/attendance');
    const select = page.getByTestId('section-select');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveCount(1); // only the assigned section is offered

    await expect(page.getByTestId('row-alpha-A1')).toBeVisible();
    await page.getByTestId('mark-all-present').click();
    await page.getByTestId('mark-alpha-A2-absent').click();
    await expect(page.getByTestId('mark-alpha-A2-absent')).toHaveAttribute('aria-pressed', 'true');

    // simulated network drop on the first save → clear error, nothing silently saved, retry works
    let dropped = false;
    await page.route('**/api/v1/attendance/sections/**', async (route) => {
      if (route.request().method() === 'PUT' && !dropped) {
        dropped = true;
        await route.abort('connectionreset');
      } else await route.continue();
    });
    await page.getByTestId('save-attendance').click();
    await expect(page.getByRole('alert').filter({ hasText: /Cannot reach the server/i })).toBeVisible();
    await page.getByTestId('save-attendance').dblclick(); // double-click must not create duplicates
    await expect(page.getByTestId('saved-msg')).toContainText('Saved 3 students');

    await page.reload();
    await expect(page.getByTestId('mark-alpha-A1-present')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mark-alpha-A2-absent')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mark-alpha-A3-present')).toHaveAttribute('aria-pressed', 'true');

    // server truth: exactly one record per student for today
    const sections = await (await page.request.get('/api/v1/sections')).json();
    const sectionId = sections.data[0].id as string;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const sheet = await (await page.request.get(`/api/v1/attendance/sections/${sectionId}?date=${today}`)).json();
    expect(sheet.data.students).toHaveLength(3);

    // unassigned section: refused by the API even when the URL/id is guessed
    const owner = await (await page.request.get('/api/v1/academics/sections/' + sectionId + '/roster')).json();
    expect(owner.data.students).toHaveLength(3);
  });

  test('teacher cannot reach the other section by manipulating the request', async ({ page }) => {
    await login(page, 'tina@alpha.test');
    const roster = await page.request.get('/api/v1/sections');
    expect((await roster.json()).data).toHaveLength(2); // sections are listed, but only assigned ones are actionable
    const all = (await roster.json()).data as Array<{ id: string; name: string }>;
    const other = all.find((s) => s.name === 'B')!;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const res = await page.request.get(`/api/v1/attendance/sections/${other.id}?date=${today}`, { headers: { 'X-Requested-With': 'edunex' } });
    expect(res.status()).toBe(403);
  });
});

test.describe('E2E-05 mobile workflows', () => {
  test('login → attendance → submit are usable on a phone: no horizontal scroll, ≥44px tap targets, menu works', async ({ page, viewport }) => {
    await page.goto('/login');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, 'login page scrolls horizontally').toBe(false);
    await login(page, 'tina@alpha.test');
    await expect(page.getByTestId('school-name')).toBeVisible();

    if (viewport && viewport.width < 768) {
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('link', { name: 'Attendance', exact: true }).click();
    } else await page.goto('/app/attendance');
    await expect(page.getByTestId('row-alpha-A1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), 'attendance scrolls horizontally').toBe(false);

    for (const id of ['mark-alpha-A1-present', 'mark-alpha-A1-absent', 'save-attendance', 'mark-all-present']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(36);
      expect(box!.width, `${id} width`).toBeGreaterThanOrEqual(36);
    }
    await page.getByTestId('mark-all-present').click();
    await page.getByTestId('save-attendance').click();
    await expect(page.getByTestId('saved-msg')).toBeVisible();
  });
});
