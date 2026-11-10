import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/** E2E-12 Super Admin console with two-factor sign-in (R5). Synthetic super admin seeded by the E2E server. */
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
function totp(secret: string, t = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secret) { value = (value << 5) | alphabet.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(t / 30_000)));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, '0');
}
async function password(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('identifier').fill(email);
  await page.getByTestId('password').fill('Correct-Horse-9');
  await page.getByTestId('login-submit').click();
}
const run = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;

test.describe('E2E-12 platform console', () => {
  test('super admin signs in with password + authenticator code, sees real counts and creates a school', async ({ page }) => {
    const r = run();
    await password(page, 'root@edunex.test');
    await expect(page.getByTestId('mfa-code')).toBeVisible();
    await page.getByTestId('mfa-code').fill(totp(SECRET) === '000000' ? '111111' : '000000');
    await page.getByTestId('mfa-submit').click();
    await expect(page.getByRole('alert').filter({ hasText: 'not valid' })).toBeVisible();
    await page.getByTestId('mfa-code').fill(totp(SECRET));
    await page.getByTestId('mfa-submit').click();
    await page.waitForURL(/\/platform$/);
    await expect(page.getByTestId('pl-overview')).toContainText('Active students');
    await expect(page.getByTestId('pl-schools')).toContainText('School alpha');
    await expect(page.getByTestId('pl-schools')).not.toContainText('Asha'); // counts only, no student data

    await page.getByTestId('pl-new-school').click();
    await page.getByLabel('School name').fill(`E2E Academy ${r}`);
    await page.getByLabel('Code (short, permanent)').fill(`e2e-${r}`);
    await page.getByLabel('Owner name').fill('E2E Owner');
    await page.getByLabel('Owner email').fill(`owner-${r}@e2e.test`);
    await page.getByTestId('pl-create').click();
    await expect(page.getByText('School created; owner invited.')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByTestId('pl-schools')).toContainText(`e2e-${r}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByTestId('pl-audit')).toContainText('platform.school_provisioned');
  });

  test('school staff cannot use the console', async ({ page }) => {
    await password(page, 'owner@alpha.test');
    await page.waitForURL(/\/app/);
    await page.goto('/platform');
    await expect(page.getByText('This console is for EduNex platform staff only.')).toBeVisible();
    const res = await page.request.get('/api/v1/platform/schools', { headers: { 'X-Requested-With': 'edunex' } });
    expect(res.status()).toBe(403);
  });
});
