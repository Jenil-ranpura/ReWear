/**
 * P8-T3 — §17 E2E journey (Playwright, REAL browser against the REAL stack).
 *
 * The journey (§17 row: "register → list item → (second user) browse →
 * request swap → owner accepts → both dashboards reflect the change"), with
 * one realistic addition: items are born PENDING (§5.3), so the owner's
 * acceptance step requires an ADMIN approval first — the journey therefore
 * also crosses the moderation gate.
 *
 * Chosen redemption type: POINTS_REDEMPTION (not DIRECT_SWAP) so the test
 * needs no second listing + image upload for the offering side — and because
 * it exercises the points ECONOMY end to end (ledger + balances + contact
 * reveal + dispute surface) through the real UI.
 *
 * Image upload uses a tiny generated PNG fixture (the §17 journey demands a
 * real listing); the API processes it through the real sharp pipeline.
 *
 * Run:  npx playwright test   (root script wires dev servers automatically)
 */

import { test, expect } from '@playwright/test';

const API = 'http://localhost:4000/api/v1';

// Deterministic per-run data (timestamped email avoids rerun collisions).
const runId = Date.now();
const OWNER = {
  // Unique name per run: the contact card's "reach <name>" line is the
  // rerun-stable anchor for the assertion in step 6.
  name: `E2E Owner ${runId}`,
  email: `e2e-owner-${runId}@test.dev`,
  password: 'Password123!',
};
// The redeemer is the SEEDED funded identity (scripts/e2e-ensure-fixtures.js):
// there is no top-up endpoint (no payments by design), so the seed IS funding.
const SEEDED = { email: 'demo@rewear.test', password: 'Password123!' };
const ITEM = {
  title: `E2E Sunset Windbreaker ${runId}`,
  description: 'A windbreaker created by the automated §17 journey test.',
  type: 'Windbreaker',
  size: 'M',
};

/** Register through the UI (the §17 journey's own first step). */
async function register(page, user, { withPhone = false } = {}) {
  await page.goto('/register');
  await page.getByLabel('Name').fill(user.name);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  if (withPhone) {
    // Contact reveal: the OWNER volunteers a phone at signup — this is the
    // number the redeemer will see on the accepted row (the requester's
    // revealed number is the one volunteered ON the request).
    await page.getByLabel(/phone/i).fill('+91 98765 43211');
  }
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible();
}

/**
 * Log in through the UI and CONFIRM the session before returning.
 *
 * The confirmation wait is load-bearing: clicking "Log in" only STARTS the
 * request — navigating before it resolves (e.g. straight to a dashboard)
 * aborts the POST, the route guard sees no token and bounces back to
 * /login, and the next selector waits forever on a page that never renders.
 * (Found the hard way: the journey's step 5 accepted... nothing.)
 */
async function login(page, { email, password }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible();
}

/** Admin-approve an item through the moderation queue UI. */
async function approveAsAdmin(page, itemTitle) {
  await page.getByRole('button', { name: /log ?out/i }).click();
  await login(page, { email: 'admin@rewear.test', password: 'Password123!' });

  await page.goto('/admin');
  const row = page.locator('[data-testid="admin-queue-row"]', { hasText: itemTitle });
  await row.waitFor();
  await row.getByRole('button', { name: /approve/i }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^approve$/i })
    .click();
  await expect(page.getByTestId('toast')).toContainText(/approved/i);
}

test.describe('§17 E2E journey', () => {
  test('register → list → moderate → browse → redeem → both dashboards reflect it → contact revealed', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    // Deterministic PNG (1×1 red px) — sharp validates + hashes it for real.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    // ── 1. Owner registers and lists an item (upload-first flow). ──
    // (The owner doesn't need points to LIST — only the redeemer's balance
    // is gated. The redeemer is the SEEDED demo user: funded 120 pts — the
    // repo has no top-up endpoint by design, so the seed IS the funding.)
    await register(page, OWNER, { withPhone: true });

    await page.goto('/items/new');
    await page.getByLabel('Title').fill(ITEM.title);
    await page.getByLabel('Description').fill(ITEM.description);
    await page.getByLabel(/^Category/).selectOption('TOPS');
    await page.getByLabel('Type').fill(ITEM.type);
    await page.getByLabel('Size').fill(ITEM.size);
    await page.getByLabel(/^Condition/).selectOption('GOOD');
    await page.setInputFiles('[data-testid="image-input"]', {
      name: 'windbreaker.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByText(/1\/5 used/i)).toBeVisible();
    await page.getByRole('button', { name: /submit for review/i }).click();
    await expect(page.getByText(/submitted for review/i)).toBeVisible();

    // ── 2. Admin approves through the moderation queue. ──
    await approveAsAdmin(page, ITEM.title);

    // ── 3. Second user (the seeded, funded demo identity) logs in and
    // finds the item in Browse. ──
    await page.getByRole('button', { name: /log ?out/i }).click();
    await login(page, SEEDED);

    await page.goto('/items');
    await page.getByLabel('Search items').fill(ITEM.title);
    await expect(page.getByText(ITEM.title).first()).toBeVisible();

    // ── 4. Redeem via points (volunteering the phone for contact reveal). ──
    await page.getByText(ITEM.title).first().click();
    await page.getByRole('button', { name: /redeem for \d+ pts/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/your phone/i).fill('+91 98765 43212');
    await dialog.getByRole('button', { name: /send redemption request/i }).click();
    await expect(page.getByTestId('toast')).toContainText(/redemption request sent/i);

    // ── 5. Owner accepts; both dashboards reflect the swap. ──
    await page.getByRole('button', { name: /log ?out/i }).click();
    await login(page, OWNER); // confirm session BEFORE navigating (see login())
    await page.goto('/dashboard/swaps');
    await page.getByRole('button', { name: /^accept$/i }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^accept$/i })
      .click();
    await expect(page.getByTestId('toast')).toContainText(/swap accepted/i);
    // The transfer surfaced in the owner's items dashboard.
    await page.goto('/dashboard/items');
    await expect(page.getByText(ITEM.title)).toHaveCount(0);

    // ── 6. Redeemer's dashboard: accepted row + revealed contact. ──
    // The demo user's identity anchors the row summary; the revealed phone
    // is the OWNER's signup phone (the redeemer volunteered none).
    await page.getByRole('button', { name: /log ?out/i }).click();
    await login(page, SEEDED);
    await page.goto('/dashboard/swaps');
    await page.getByRole('tab', { name: /outgoing/i }).click();
    // Reruns accumulate accepted rows in the dev DB (create-only journey), so
    // anchor to THIS run's card via the owner's unique name — never a bare
    // single-element expectation over every card ever created.
    const card = page
      .getByTestId('swap-contact-card')
      .filter({ hasText: `reach ${OWNER.name}` })
      .first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('+919876543211');
    // The phone is DIALABLE: an anchor whose href is the tel: URI (the link's
    // accessible name is its display text, so match the href, not the name).
    await expect(card.locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:+919876543211');

    // ── 7. The dispute surface exists on the accepted row (fraud kit). ──
    // Reruns accumulate accepted rows in the dev DB — anchor to THIS run's
    // row via its unique item title (single-element discipline again).
    const thisRunRow = page.getByTestId('swap-request-row').filter({ hasText: ITEM.title });
    await expect(thisRunRow.getByRole('button', { name: /report a problem/i })).toBeVisible();

    void testInfo;
  });
});
