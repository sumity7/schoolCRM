import { expect, test } from '@playwright/test';

/**
 * E2E-18 credentials never reach a URL. A submit that happens BEFORE the client has hydrated (slow network / slow dev
 * compile) used to fall back to a native GET form submission: /login?identifier=…&password=…  — leaking the password
 * into history, logs and Referer. The form is now method="post", its button is disabled until hydrated, and a native
 * POST that still arrives is answered with a 303 back to the page without ever reading the body.
 */
const PASSWORD = 'Correct-Horse-9';

test.describe('E2E-18 login credential handling', () => {
  for (const path of ['/login']) {
    test(`${path}: a submission before hydration never puts the identifier or password in the URL`, async ({ page }) => {
      await page.route('**/_next/static/**', (route) => route.abort()); // no JavaScript ⇒ the page can never hydrate
      const requests: Array<{ method: string; url: string }> = [];
      page.on('request', (r) => requests.push({ method: r.method(), url: r.url() }));
      await page.goto(path);
      await expect(page.getByTestId('login-submit')).toBeDisabled(); // not enabled until the client is ready
      await page.getByTestId('identifier').fill('tina@alpha.test');
      await page.getByTestId('password').fill(PASSWORD);
      await page.getByTestId('password').press('Enter'); // implicit submission is blocked by the disabled button
      await page.waitForTimeout(500);
      expect(page.url()).not.toMatch(/password|identifier|tina|%40|Correct/i);
      // force a native submission anyway (what the old bug did) and WAIT for it: the browser must send a POST, and the server must answer 303
      const [posted, answered] = await Promise.all([
        page.waitForRequest((r) => r.method() === 'POST'),
        page.waitForResponse((r) => r.request().method() === 'POST'),
        page.evaluate(() => (document.querySelector('form') as HTMLFormElement).requestSubmit()),
      ]);
      expect(posted.url().endsWith('/login')).toBe(true); // posted to the page itself, no query string
      expect(posted.url()).not.toContain('?');
      expect(answered.status()).toBe(303); // the body is never processed: redirect straight back
      await page.waitForLoadState('load');
      await page.waitForTimeout(500);
      const final = page.url();
      expect(final.endsWith('/login')).toBe(true);
      expect(final).not.toMatch(/\?|password|identifier|tina|%40|Correct/i);
      for (const r of requests) expect(r.url, `${r.method} ${r.url}`).not.toMatch(/password|identifier|tina|%40|Correct/i);
      expect(requests.filter((r) => r.method === 'POST').every((r) => r.url.endsWith('/login'))).toBe(true); // credentials only ever travelled in a POST body, to the page itself …
      expect(requests.some((r) => r.url.includes('/api/'))).toBe(false); // … and were never sent anywhere else
    });
  }

  test('normal login still works once hydrated; invalid credentials are rejected without leaving anything in the URL', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-submit')).toBeEnabled(); // enabled after hydration
    await page.getByTestId('identifier').fill('tina@alpha.test');
    await page.getByTestId('password').fill('Definitely-Wrong-9');
    await page.getByTestId('login-submit').click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid credentials' })).toBeVisible();
    expect(page.url()).not.toMatch(/\?|password|tina/i);
    await page.getByTestId('password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/app$/);
    expect(page.url()).not.toMatch(/\?|password|tina/i);
    await expect(page.getByTestId('school-name')).toBeVisible();
  });
});
