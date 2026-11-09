import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/**
 * R1 admin screens (checkpoint 5): import wizard, student create/detail/guardians, export, setup, navigation.
 * Re-runnable on the shared seeded database: every record created here has a run-unique admission number / name and
 * stays out of the seeded sections A/B used by the attendance flows.
 */
const PASSWORD = 'Correct-Horse-9';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('identifier').fill(email);
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/(app|select-school)/);
}

async function navTo(page: Page, name: string) {
  const burger = page.getByRole('button', { name: 'Open menu' });
  if (await burger.isVisible()) await burger.click();
  await page.getByRole('link', { name, exact: true }).first().click();
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const run = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

test.describe('E2E-06 student import wizard', () => {
  test('upload → auto-mapped columns → check → problem rows listed → import → students exist → undo', async ({ page }) => {
    page.on('dialog', (d) => void d.accept());
    const r = run();
    await login(page, 'owner@alpha.test');
    await navTo(page, 'Imports');
    await expect(page).toHaveURL(/\/app\/imports$/);
    const csv = [
      'Admission No,Student Name,DOB,Gender,Father Name,Parent Mobile',
      `IMP-${r}-1,Imported One,05/06/2015,F,Raj Kumar,9876500001`,
      `IMP-${r}-2,Imported Two,31/02/2015,M,,`,
      `IMP-${r}-3,Imported Three,07/08/2016,M,,`,
    ].join('\n');
    await page.getByTestId('import-file').setInputFiles({ name: `e2e-${r}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForURL(/\/app\/imports\/[a-f0-9]{24}$/);
    const batchUrl = page.url();
    await expect(page.getByTestId('map-admissionNo')).toHaveValue('0');
    await expect(page.getByTestId('map-dob')).toHaveValue('2');
    await page.getByTestId('check-rows').click();
    const counts = page.getByTestId('import-counts');
    await expect(counts).toContainText('Ready to import');
    await expect(counts).toContainText('2');
    await expect(page.getByTestId('problems-table')).toContainText('Date of Birth "31/02/2015"');
    await expect(page.getByTestId('preview-table')).toContainText('Imported One');
    expect(await noHorizontalScroll(page)).toBe(true);

    await page.getByTestId('commit-import').click();
    await expect(page.getByText('Imported', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('rollback-import')).toBeVisible();

    await page.goto('/app/students');
    await page.getByTestId('student-search').fill(`IMP-${r}`);
    await expect(page.getByTestId('students-table')).toContainText('Imported Three');
    await expect(page.getByTestId('students-table')).not.toContainText('Imported Two');

    await page.goto(batchUrl);
    await page.getByTestId('rollback-import').click();
    await expect(page.getByText('Rolled back', { exact: true }).first()).toBeVisible();
    await page.goto('/app/students');
    await page.getByTestId('student-search').fill(`IMP-${r}`);
    await expect(page.getByText('No students match these filters.')).toBeVisible();
  });

  test('a teacher has no import screen and the API refuses the upload', async ({ page }) => {
    await login(page, 'tina@alpha.test');
    const burger = page.getByRole('button', { name: 'Open menu' });
    if (await burger.isVisible()) await burger.click();
    await expect(page.getByRole('link', { name: 'Imports', exact: true })).toHaveCount(0);
    const status = await page.evaluate(async () => (await fetch('/api/v1/imports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'edunex' }, body: JSON.stringify({ entity: 'students', filename: 'x.csv', csv: 'a\n1' }) })).status);
    expect(status).toBe(403);
  });
});

test.describe('E2E-07 student record screens', () => {
  test('add a student, add + verify a guardian, enable portal access, edit, export CSV', async ({ page }) => {
    page.on('dialog', (d) => void d.accept());
    const r = run();
    await login(page, 'owner@alpha.test');
    await navTo(page, 'Students');
    await page.getByTestId('add-student').click();
    await page.getByLabel('Admission no. *').fill(`UI-${r}`);
    await page.getByLabel('First name *').fill('Kavya');
    await page.getByLabel('Last name').fill(`Test${r}`);
    await page.getByLabel('Date of birth *').fill('2015-04-10');
    await page.getByTestId('save-student').click();
    await page.waitForURL(/\/app\/students\/[a-f0-9]{24}$/);
    await expect(page.getByRole('heading', { name: `Kavya Test${r}` })).toBeVisible();

    await page.getByTestId('add-guardian').click();
    await page.getByLabel('Name').fill('Sunita Devi');
    await page.getByLabel('Phone').fill('9812345678');
    await page.getByRole('button', { name: 'Add guardian' }).last().click();
    const g = page.getByTestId('guardians-table');
    await expect(g).toContainText('Sunita Devi');
    await expect(g).toContainText('not verified');
    await expect(g.getByRole('button', { name: 'Enable portal' })).toHaveCount(0); // must verify first
    await g.getByRole('button', { name: 'Verify' }).click();
    await expect(g).toContainText('verified');
    await g.getByRole('button', { name: 'Enable portal' }).click();
    await expect(g.getByRole('button', { name: 'Disable portal' })).toBeVisible();

    await page.getByTestId('edit-student').click();
    await page.getByLabel('First name').fill('Kavyaa');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: `Kavyaa Test${r}` })).toBeVisible();
    // a second edit must not hit a stale version (the modal re-reads the record each time it opens)
    await page.getByTestId('edit-student').click();
    await page.getByLabel('First name').fill('Kavya');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: `Kavya Test${r}` })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);

    await page.goto('/app/students');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-students').click()]);
    expect(download.suggestedFilename()).toMatch(/^students-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await readFile((await download.path())!, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM so Excel shows Hindi names correctly
    expect(text.slice(1).split(/\r?\n/)[0]).toContain('Admission No,First Name,Last Name,Date of Birth');
    expect(text).toContain(`UI-${r}`);
  });
});

test.describe('E2E-08 setup screens & navigation', () => {
  test('owner: every sidebar screen loads without errors or horizontal scroll', async ({ page }) => {
    await login(page, 'owner@alpha.test');
    const hrefs = ['/app', '/app/attendance', '/app/attendance/reports', '/app/attendance/corrections', '/app/students', '/app/imports', '/app/staff',
      '/app/settings/academic-sessions', '/app/settings/classes', '/app/settings/calendar', '/app/settings/users', '/app/settings/school', '/app/audit'];
    const burger = page.getByRole('button', { name: 'Open menu' });
    if (await burger.isVisible()) await burger.click();
    for (const h of hrefs) await expect(page.locator(`nav a[href="${h}"]`).first(), `nav link ${h}`).toBeAttached();
    for (const h of hrefs) {
      await page.goto(h);
      await expect(page.getByRole('heading', { level: 1 }).first(), h).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main [role="alert"]'), `${h} shows an error`).toHaveCount(0);
      expect(await noHorizontalScroll(page), `${h} scrolls horizontally`).toBe(true);
    }
  });

  test('teacher sees only teaching screens', async ({ page }) => {
    await login(page, 'tina@alpha.test');
    const burger = page.getByRole('button', { name: 'Open menu' });
    if (await burger.isVisible()) await burger.click();
    const nav = page.getByRole('navigation', { name: 'Main' }).last();
    await expect(nav.getByRole('link', { name: 'Attendance', exact: true })).toBeVisible();
    for (const hidden of ['Imports', 'Staff', 'Academic sessions', 'Classes & sections', 'Users & roles', 'School settings', 'Audit log', 'Corrections']) {
      await expect(nav.getByRole('link', { name: hidden, exact: true }), hidden).toHaveCount(0);
    }
  });

  test('owner creates a class and a section, and adds a holiday', async ({ page }) => {
    const r = run();
    await login(page, 'owner@bravo.test'); // school bravo: keeps alpha's section list exactly as the attendance flows expect
    await page.goto('/app/settings/classes');
    await page.getByTestId('new-class').click();
    await page.getByLabel('Name').fill(`E2E ${r}`);
    await page.getByRole('button', { name: 'Save' }).click();
    const card = page.locator('div.rounded-xl', { hasText: `E2E ${r}` }).first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Add section' }).click();
    await page.getByLabel('Name').fill('Q');
    await page.getByLabel('Capacity (optional)').fill('30');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(card).toContainText('Section Q');
    await expect(card).toContainText('0 / 30 students');

    await page.goto('/app/settings/calendar');
    await page.getByLabel('Title').fill(`Holiday ${r}`);
    await page.getByLabel('From').fill('2030-08-15');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('cell', { name: `Holiday ${r}`, exact: true })).toBeVisible();
  });
});
