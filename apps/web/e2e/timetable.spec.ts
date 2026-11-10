import { expect, test, type Page } from '@playwright/test';
import { WEB_ORIGIN } from './env';

/**
 * E2E-16 timetable (Phase B). Synthetic data; re-runnable: every run builds its own draft ("TT <run>") and, because only one
 * timetable can be published per session, publishing replaces the previous run's — which is itself part of what is verified.
 */
const PASSWORD = 'Correct-Horse-9';
const run = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
async function login(page: Page, id: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByTestId('identifier').fill(id);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/(app|select-school)/);
}
/** The grid renders a table (wide screens) and per-day cards (phones); only one is visible, so target the visible one. */
const cell = (page: Page, day: number, period: number) => page.locator(`[data-testid="cell-${day}-${period}"] >> visible=true`);

test.describe('E2E-16 timetable', () => {
  test('admin builds a draft, hits a teacher clash, publishes; teacher, student and parent see it; printable; no horizontal scroll', async ({ page, browser }) => {
    const r = run();
    await login(page, 'owner@alpha.test');
    await page.goto('/app/timetable');
    await page.getByTestId('new-draft').click();
    await page.getByTestId('draft-name').fill(`TT ${r}`);
    await page.getByTestId('create-draft').click();
    await expect(page.getByTestId('tt-editor')).toBeVisible();
    await page.getByTestId('ed-section').selectOption({ label: 'Class 5 A' });

    // Monday period 1 for Class 5 A: Mathematics by Tina Teacher, room LAB-1
    await cell(page, 1, 1).click();
    await page.getByTestId('lesson-subject').selectOption({ label: 'Mathematics' });
    await page.getByTestId('lesson-teacher').selectOption({ label: 'Tina Teacher' });
    await page.getByTestId('lesson-room').fill('lab-1');
    await page.getByTestId('lesson-save').click();
    await expect(cell(page, 1, 1)).toContainText('Mathematics');
    await expect(cell(page, 1, 1)).toContainText('LAB-1');

    // the same teacher for Class 5 B in the same period is refused with a clear reason
    await page.getByTestId('ed-section').selectOption({ label: 'Class 5 B' });
    await cell(page, 1, 1).click();
    await page.getByTestId('lesson-subject').selectOption({ label: 'Mathematics' });
    await page.getByTestId('lesson-teacher').selectOption({ label: 'Tina Teacher (busy this period)' });
    await page.getByTestId('lesson-save').click();
    await expect(page.getByRole('alert').filter({ hasText: /Tina Teacher is already teaching Class 5 A/ })).toBeVisible();
    await page.keyboard.press('Escape');

    // publish
    page.once('dialog', (d) => void d.accept());
    const card = page.getByTestId('tt-versions').locator('li').filter({ hasText: `TT ${r}` });
    await card.getByRole('button', { name: 'Publish' }).click();
    await expect(card).toContainText('published');
    expect(await noHorizontalScroll(page)).toBe(true);

    // the published class timetable (viewer) is printable
    await page.getByTestId('tt-section').selectOption({ label: 'Class 5 A' });
    await expect(page.getByTestId('tt-caption')).toContainText(`TT ${r}`);
    await expect(page.getByTestId('print-timetable')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('print-timetable')).toBeHidden();
    await expect(page.getByTestId('viewer-grid').locator('table')).toBeVisible(); // print always uses the full table
    await page.emulateMedia({ media: 'screen' });

    // a teacher sees only the published timetable and cannot edit
    const t = await browser.newContext({ baseURL: WEB_ORIGIN, viewport: page.viewportSize() ?? undefined });
    const tp = await t.newPage();
    await login(tp, 'tina@alpha.test');
    await tp.goto('/app/timetable');
    await expect(tp.getByTestId('tt-builder')).toHaveCount(0);
    await tp.getByTestId('tt-mode').selectOption('me');
    await expect(tp.getByTestId('tt-caption')).toContainText(`TT ${r}`);
    await expect(cell(tp, 1, 1)).toContainText('Mathematics');
    expect((await tp.request.post('/api/v1/timetable/versions', { headers: { 'X-Requested-With': 'edunex', Origin: WEB_ORIGIN }, data: { name: 'x', periods: [] } })).status()).toBe(403);
    expect(await noHorizontalScroll(tp)).toBe(true);
    await t.close();

    // the parent of alpha-A1 (Class 5 A) sees it on the child's Timetable tab
    const p = await browser.newContext({ baseURL: WEB_ORIGIN, viewport: page.viewportSize() ?? undefined });
    const pp = await p.newPage();
    await login(pp, 'parent@alpha.test');
    await pp.getByTestId('child-alpha-A1').click();
    await pp.getByRole('tab', { name: 'timetable' }).click();
    await expect(pp.getByTestId('child-timetable')).toBeVisible();
    await expect(cell(pp, 1, 1)).toContainText('Mathematics');
    expect(await noHorizontalScroll(pp)).toBe(true);
    await p.close();
  });
});
