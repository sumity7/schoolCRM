import { expect, test, type Page } from '@playwright/test';
import { WEB_ORIGIN } from './env';

/**
 * E2E-17 homework (Phase C). Teacher sets homework with an attachment; a student (activated through the real
 * activation flow) submits with a file; the teacher reviews; the student sees the feedback; the parent sees the status;
 * an invalid upload is refused. Synthetic data; every run uses its own title so reruns do not collide.
 */
const PASSWORD = 'Correct-Horse-9';
const HDR = { 'X-Requested-With': 'edunex' };
const run = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n') });
async function login(page: Page, id: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByTestId('identifier').fill(id);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/(app|select-school)/);
}

test.describe('E2E-17 homework', () => {
  test('teacher sets homework → student submits with a file → teacher reviews → student and parent see the result', async ({ page, browser }) => {
    page.on('dialog', (d) => void d.accept());
    const r = run();
    const title = `Fractions ${r}`;

    // student A2 (alpha-a2) gets a real login through the activation link (staff never see the password)
    await login(page, 'owner@alpha.test');
    const list = await page.request.get('/api/v1/students?limit=100', { headers: HDR });
    const row = (await list.json()).data.find((s: { admissionNo: string }) => s.admissionNo === 'alpha-A1');
    const issued = await page.request.post(`/api/v1/students/${row.id}/portal-access`, { headers: { ...HDR, Origin: WEB_ORIGIN }, data: {} });
    expect(issued.status()).toBe(201);
    const url = new URL((await issued.json()).data.activationUrl);
    const sctx = await browser.newContext({ baseURL: WEB_ORIGIN, viewport: page.viewportSize() ?? undefined });
    const stu = await sctx.newPage();
    await stu.goto(url.pathname + url.search);
    await stu.getByTestId('password').fill('Student-Own-Pass-2');
    await stu.getByTestId('accept-submit').click();
    await expect(stu.getByTestId('accept-done')).toBeVisible();

    // teacher sets homework for Class 5 A with an attachment; a disallowed file is refused by the server
    const tctx = await browser.newContext({ baseURL: WEB_ORIGIN, viewport: page.viewportSize() ?? undefined });
    const tp = await tctx.newPage();
    await login(tp, 'tina@alpha.test');
    await tp.goto('/app/homework');
    await tp.getByTestId('new-homework').click();
    await tp.getByTestId('hw-section').selectOption({ label: 'Class 5 A' });
    await tp.getByTestId('hw-subject').selectOption({ label: 'Mathematics' });
    await tp.getByTestId('hw-title').fill(title);
    await tp.getByTestId('hw-description').fill('Solve exercise 4.2');
    const due = new Date(Date.now() + 2 * 86_400_000);
    await tp.getByTestId('hw-due').fill(`${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}T10:00`);
    await tp.getByTestId('hw-marks').fill('10');
    await tp.getByTestId('hw-files').setInputFiles({ name: 'run.exe', mimeType: 'application/pdf', buffer: Buffer.from('MZ\x90\x00') });
    await tp.getByTestId('hw-publish').click();
    await expect(tp.getByRole('alert').filter({ hasText: /not allowed/ })).toBeVisible();
    await tp.getByTestId('hw-files').setInputFiles(pdf('worksheet.pdf'));
    await tp.getByTestId('hw-publish').click();
    await expect(tp.getByTestId('homework-list')).toContainText(title);
    expect(await noHorizontalScroll(tp)).toBe(true);

    // student: sees it, downloads the attachment, submits answer + file
    await login(stu, 'alpha-a1@alpha.student', 'Student-Own-Pass-2');
    await stu.goto('/app/homework');
    await expect(stu.getByTestId('homework-list')).toContainText(title);
    await stu.getByTestId('homework-list').getByText(title).click();
    await expect(stu.getByTestId('hw-detail')).toBeVisible();
    const [dl] = await Promise.all([stu.waitForEvent('download'), stu.getByTestId('file-worksheet.pdf').click()]);
    expect(dl.suggestedFilename()).toBe('worksheet.pdf');
    await stu.getByTestId('hw-answer').fill('x = 3/4');
    await stu.getByTestId('hw-attach').setInputFiles(pdf('my-answer.pdf'));
    await stu.getByTestId('hw-submit').click();
    await expect(stu.getByTestId('hw-submission')).toContainText('submitted');
    await expect(stu.getByTestId('hw-submission')).toContainText('my-answer.pdf');
    expect(await noHorizontalScroll(stu)).toBe(true);

    // teacher: marking sheet shows the submission; reviews with marks + feedback
    await tp.goto('/app/homework');
    await tp.getByTestId('homework-list').getByText(title).click();
    await expect(tp.getByTestId('hw-sheet')).toBeVisible();
    await expect(tp.getByTestId('row-alpha-A1')).toContainText('submitted');
    await expect(tp.getByTestId('row-alpha-A2')).toContainText('missing');
    await tp.getByTestId('review-alpha-A1').click();
    await tp.getByTestId('rv-marks').fill('9');
    await tp.getByTestId('rv-feedback').fill('Well done');
    await tp.getByTestId('rv-save').click();
    await expect(tp.getByTestId('row-alpha-A1')).toContainText('reviewed');

    // student sees the feedback and can no longer change the submission
    await stu.reload();
    await expect(stu.getByTestId('hw-feedback')).toContainText('9 / 10');
    await expect(stu.getByTestId('hw-feedback')).toContainText('Well done');
    await expect(stu.getByTestId('hw-submit')).toHaveCount(0);

    // parent of alpha-A1 sees the status on the child's Homework tab (read-only)
    const pctx = await browser.newContext({ baseURL: WEB_ORIGIN, viewport: page.viewportSize() ?? undefined });
    const pp = await pctx.newPage();
    await login(pp, 'parent@alpha.test');
    await pp.getByTestId('child-alpha-A1').click();
    await pp.getByRole('tab', { name: 'homework' }).click();
    await expect(pp.getByTestId('child-homework')).toContainText(title);
    await expect(pp.getByTestId('child-homework')).toContainText('reviewed');
    expect(await noHorizontalScroll(pp)).toBe(true);
    await sctx.close(); await tctx.close(); await pctx.close();
  });
});
