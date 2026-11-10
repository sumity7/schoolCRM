/** Origin of the web app under test. Default is the dev server on 3100; E2E_WEB_PORT selects another (e.g. an isolated production build). */
export const WEB_ORIGIN = `http://localhost:${process.env.E2E_WEB_PORT ?? '3100'}`;

/**
 * Opens the mobile menu when the viewport is phone-sized. Decided by the viewport (deterministic), never by a non-waiting
 * isVisible() check — that raced the app shell, which renders only after /auth/me returns. The click auto-waits for the
 * button and the menu dialog must then actually be open.
 */
export async function openMenuIfMobile(page: import('@playwright/test').Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1280) >= 768) return; // md breakpoint: the sidebar is always visible
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).waitFor({ state: 'visible' });
}
