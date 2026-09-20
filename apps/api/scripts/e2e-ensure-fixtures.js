/**
 * P8-T3 — E2E fixture ensure (upsert-only, NO drop).
 *
 * The §17 Playwright journey needs two deterministic identities: an ADMIN
 * (moderation gate) and a FUNDED user (redemption balance). Unlike
 * `npm run seed` (drop-and-reseed — wipes dev data), this script only
 * CREATES what's missing and leaves everything else untouched:
 *   - admin@rewear.test  (role ADMIN; password Password123!)
 *   - demo@rewear.test   (role USER, 120 pts + matching §9.3 ledger doc)
 *
 * The demo user's balance is FORCED to a funded value on every run (still
 * not a drop): the journey spends exactly its own redemption, so restoring
 * the canonical 120 keeps reruns deterministic. If a §9.3 ledger doc for the
 * initial 120 is missing, one EARNED entry is appended (cache=ledger rule).
 *
 * Wired into Playwright's webServer chain (see playwright.config.mjs) so the
 * stack boots ready for the journey. Never run automatically outside e2e.
 */
import bcrypt from 'bcryptjs';

import env from '../src/config/env.js';
import logger from '../src/lib/logger.js';
import { connectDb, disconnectDb } from '../src/lib/db.js';
import { User, PointsTransaction } from '../src/models/index.js';

const DEMO_POINTS = 120;
const passwordHash = await bcrypt.hash('Password123!', 10);

async function ensureUser(email, patch) {
  const existing = await User.findOne({ email });
  if (existing) return { user: existing, created: false };
  const user = await User.create({ email, passwordHash, ...patch });
  return { user, created: true };
}

async function main() {
  if (env.isProduction && !process.argv.includes('--force')) {
    logger.error('e2e_fixtures_refused', { reason: 'NODE_ENV=production' });
    process.exit(1);
  }

  await connectDb(env.MONGODB_URI);

  const { user: admin, created: adminCreated } = await ensureUser('admin@rewear.test', {
    name: 'Admin Demo',
    role: 'ADMIN',
    pointsBalance: 0,
  });

  const { user: demo, created: demoCreated } = await ensureUser('demo@rewear.test', {
    name: 'Demo User',
    role: 'USER',
    pointsBalance: DEMO_POINTS,
  });

  if (!demoCreated) {
    // Restore the canonical funded balance for deterministic reruns.
    await User.updateOne({ _id: demo._id }, { $set: { pointsBalance: DEMO_POINTS } });
  }

  // §9.3: the funded balance needs a matching ledger doc (append-only).
  const hasSeedLedger = await PointsTransaction.exists({
    userId: demo._id,
    amount: DEMO_POINTS,
    type: 'EARNED',
  });
  if (!hasSeedLedger) {
    await PointsTransaction.create({
      userId: demo._id,
      amount: DEMO_POINTS,
      type: 'EARNED',
      relatedSwapRequestId: null,
    });
  }

  logger.info('e2e_fixtures_ready', {
    admin: admin.email,
    adminCreated,
    demo: demo.email,
    demoCreated,
  });

  await disconnectDb();
  process.exit(0);
}

main().catch(async (err) => {
  logger.error('e2e_fixtures_failed', { error: err?.message ?? err });
  await disconnectDb();
  process.exit(1);
});
