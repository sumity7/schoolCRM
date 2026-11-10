import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = process.env.E2E_WEB_PORT ?? '3100';
const WEB = `http://localhost:${WEB_PORT}`;
// E2E_WEB_MODE=prod serves the web app from an isolated PRODUCTION build (NEXT_DIST_DIR, default .next-build; built with
// API_ORIGIN pointing at the E2E API) instead of `next dev`, so nothing compiles on demand during the run.
const prod = process.env.E2E_WEB_MODE === 'prod';
const distDir = process.env.NEXT_DIST_DIR ?? '.next-build';
// The API port is configurable so a run can avoid a port still held by an earlier run (default unchanged).
const API_PORT = process.env.E2E_API_PORT ?? '4100';
// Optional: drive an installed browser (e.g. PW_CHANNEL=msedge or chrome) instead of downloading Playwright's Chromium.
const channel = process.env.PW_CHANNEL || undefined;
// Opt-in: reuse servers left running by an earlier run (default is strict, so CI always starts clean).
const reuse = process.env.PW_REUSE_SERVERS === '1';

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
      url: `http://localhost:${API_PORT}/health/ready`,
      timeout: 180_000,
      reuseExistingServer: reuse,
      env: { E2E_WEB_ORIGIN: WEB, E2E_API_PORT: API_PORT, MONGOMS_SYSTEM_BINARY: process.env.MONGOMS_SYSTEM_BINARY ?? '', MONGOMS_SYSTEM_BINARY_VERSION_CHECK: 'false' },
    },
    {
      command: prod ? `npx next start -p ${WEB_PORT}` : `npx next dev -p ${WEB_PORT}`,
      url: `${WEB}/login`,
      timeout: 180_000,
      reuseExistingServer: reuse,
      env: { API_ORIGIN: `http://127.0.0.1:${API_PORT}`, ...(prod ? { NEXT_DIST_DIR: distDir, NODE_ENV: 'production' } : {}) },
    },
    { command: 'node e2e/attacker-server.mjs', url: 'http://localhost:3200/', timeout: 30_000, reuseExistingServer: reuse, env: { E2E_WEB_ORIGIN: WEB } },
  ],
});
