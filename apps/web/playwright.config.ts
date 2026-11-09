import { defineConfig, devices } from '@playwright/test';

const WEB = 'http://localhost:3100';
// Optional: drive an installed browser (e.g. PW_CHANNEL=msedge or chrome) instead of downloading Playwright's Chromium.
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1, // tests share one seeded database; they are written to be re-runnable
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: WEB, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], channel } },
    { name: 'mobile-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 }, channel } },
  ],
  webServer: [
    {
      command: 'npm run e2e:api --workspace @edunex/api',
      url: 'http://localhost:4100/health/ready',
      timeout: 180_000,
      reuseExistingServer: false,
      env: { E2E_WEB_ORIGIN: WEB, MONGOMS_SYSTEM_BINARY: process.env.MONGOMS_SYSTEM_BINARY ?? '', MONGOMS_SYSTEM_BINARY_VERSION_CHECK: 'false' },
    },
    {
      command: 'npx next dev -p 3100',
      url: `${WEB}/login`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: { API_ORIGIN: 'http://localhost:4100' },
    },
    { command: 'node e2e/attacker-server.mjs', url: 'http://localhost:3200/', timeout: 30_000, reuseExistingServer: false, env: { E2E_WEB_ORIGIN: WEB } },
  ],
});
