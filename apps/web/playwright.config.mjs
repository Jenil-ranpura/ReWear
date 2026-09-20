// @ts-check
/**
 * P8-T3 — Playwright config (§17 E2E row). Two webServer entries boot the
 * FULL stack for the journey test: the API (port 4000, real Atlas dev DB)
 * and the Vite dev server (port 5173, /api proxy → 4000, so the httpOnly
 * refresh cookie is first-party — the same topology as manual dev).
 *
 * The DB is NOT reseeded per run (the journey is create-only: timestamped
 * users/items never collide with the seed or with reruns).
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // one journey, one shared stack
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Upsert the E2E identities (admin + funded demo user — NO drop) before
      // booting, so the journey's moderation and redemption steps are
      // deterministic regardless of dev-DB state.
      command: 'node --env-file-if-exists=.env scripts/e2e-ensure-fixtures.js && npm run dev',
      cwd: '../api',
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
