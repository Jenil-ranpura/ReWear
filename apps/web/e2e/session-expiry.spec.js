/**
 * E2E — fixed session window → automatic logout (§11, user request).
 *
 * Runs against a DEDICATED stack booted with SESSION_TTL_MINUTES=0.2 (a
 * 12-second session — see playwright.session-expiry.config.mjs), so the test
 * exercises the real 15-minute behavior without waiting 15 real minutes.
 *
 * What it proves, through the real UI + real API:
 *   1. login works and the session is live (protected page renders);
 *   2. once the window passes, the app AUTO-LOGS-OUT: ProtectedRoute bounces
 *      to /login and the nav flips to logged-out — no user action;
 *   3. the session is dead SERVER-side too: a reload can't restore it, the
 *      refresh endpoint 401s (cookie cleared), and /dashboard bounces again.
 *
 * Run:  npm run test:e2e:session   (from apps/web or the repo root)
 */

import { test, expect } from '@playwright/test';

// The stack under test (alternate ports so it can run next to the §17 journey).
const WEB = 'http://localhost:5174';
const REFRESH = `${WEB}/api/v1/auth/refresh`;

test.describe('fixed session window → automatic logout', () => {
  test('auto-logs-out when the session window passes and the session stays dead server-side', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // ── 1. Register through the UI — a fresh login starts the clock. ──
    const email = `e2e-expiry-${Date.now()}@test.dev`;
    await page.goto('/register');
    await page.getByLabel('Name').fill('E2E Session Expiry');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Password123!');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible();

    // ── 2. Sit on a protected page so the auto-logout redirect is observable. ──
    // (A full navigation re-arms the timer via the restore path — same
    // absolute deadline, since rotation never extends it.)
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible();

    // ── 3. Wait out the 12-second window → the app must log the user out
    // on its own: ProtectedRoute redirects to /login. ──
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: /log ?out/i })).toBeHidden();
    await expect(page.getByRole('button', { name: /^log in$/i })).toBeVisible();

    // ── 4. The session is dead SERVER-side: direct API proof first — the
    // still-latest (stale) refresh cookie now 401s because the window is over. ──
    const res = await page.request.post(REFRESH); // page.request shares the browser's cookies
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe('INVALID_REFRESH');
    // ...and the stale cookie was cleared for the browser.
    expect(res.headers()['set-cookie']).toContain('rewear_refreshToken=;');

    // A reload can't resurrect it either: silent restore fails → logged out.
    await page.reload();
    await expect(page.getByRole('button', { name: /^log in$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /log ?out/i })).toBeHidden();

    // ── 5. And the guard still bounces: /dashboard → /login. ──
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
