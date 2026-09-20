// @ts-check
/**
 * E2E config — fixed session window / automatic logout (§11, user request).
 *
 * Separate from playwright.config.mjs (the §17 journey) because the feature
 * under test IS the passage of time: this config boots its OWN stack on
 * alternate ports with a SHORT session TTL (SESSION_TTL_MINUTES=0.2 → a
 * 12-second session), so the spec exercises the real login → auto-logout →
 * dead-session behavior without waiting 15 real minutes.
 *
 *   API:  http://localhost:4001  (SESSION_TTL_MINUTES=0.2)
 *   Web:  http://localhost:5174  (proxies /api → 4001)
 *
 * The exported vars win over apps/api/.env (node --env-file never overrides
 * the real environment), so the same dev DB is reused — fixtures stay
 * upsert-only. Run:  npm run test:e2e:session
 */

import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  testMatch: /session-expiry\.spec\.js/, // this config runs ONLY the expiry spec
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
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
      // Same upsert-only fixture chain as the journey, then the API with a
      // 12-second session window + CORS for this stack's web origin.
      command:
        'export SESSION_TTL_MINUTES=0.2 PORT=4001 CORS_ORIGIN=http://localhost:5174 && ' +
        'node --env-file-if-exists=.env scripts/e2e-ensure-fixtures.js && npm run dev',
      cwd: '../api',
      url: 'http://localhost:4001/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // Vite on the alternate port, proxying /api to the short-TTL API.
      command: `VITE_API_PROXY_TARGET=http://localhost:4001 npm run dev -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
