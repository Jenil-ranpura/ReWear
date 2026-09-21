/**
 * One-time backfill: make the 25-point signup grant LEDGER-BACKED for
 * accounts created before the fix ("Confirm 25-point signup grant as final").
 *
 * Who it touches — ONLY users where the ledger cannot explain the balance:
 *   • has NO PointsTransaction documents at all, AND
 *   • pointsBalance === 25 (the signup grant)
 * These are pre-fix registrations: cache 25, empty ledger. Each gets exactly
 * one EARNED doc (+25) so cache === Σledger (§9.3) again.
 *
 * NOT touched (never guessed, never double-credited):
 *   • users with ANY ledger docs (their balance has a history)
 *   • users whose balance is not exactly 25 (admin-edited, redeemed, etc.)
 * After the run, a reconciliation report prints any account that is still
 * cache≠ledger — those need a human decision, never a silent write.
 *
 * Idempotent: EARNED docs are created per-user only if still absent, so a
 * re-run is a no-op. Every user is processed in its own transaction.
 *
 * Usage (from apps/api):
 *   node --env-file-if-exists=.env scripts/backfill-signup-grant.js           # dry run (default)
 *   node --env-file-if-exists=.env scripts/backfill-signup-grant.js --write   # actually write
 */

import mongoose from 'mongoose';

import env from '../src/config/env.js';
import logger from '../src/lib/logger.js';
import { connectDb, disconnectDb } from '../src/lib/db.js';
import { User, PointsTransaction } from '../src/models/index.js';
import { SIGNUP_POINTS_GRANT } from '@rewear/shared-schemas';

const WRITE = process.argv.includes('--write');

async function main() {
  await connectDb(env.MONGODB_URI);

  // Pre-fix registrations: the ONLY signature we can safely attribute to the
  // signup grant is "empty ledger AND cache exactly 25".
  const candidates = await User.find({ pointsBalance: SIGNUP_POINTS_GRANT })
    .select('_id name email pointsBalance')
    .lean();

  const toBackfill = [];
  for (const user of candidates) {
    const ledgerSum = await PointsTransaction.aggregate([
      { $match: { userId: user._id } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const total = ledgerSum[0]?.total ?? 0;
    const docCount = await PointsTransaction.countDocuments({ userId: user._id });
    if (docCount === 0 && total === 0) toBackfill.push(user);
  }

  logger.info('backfill_plan', {
    mode: WRITE ? 'WRITE' : 'DRY-RUN',
    candidates: candidates.length,
    toBackfill: toBackfill.length,
  });

  let written = 0;
  for (const user of toBackfill) {
    if (!WRITE) continue;
    // Re-check INSIDE the transaction (serializable view) so a concurrent
    // registration/admin action between scan and write cannot double-credit.
    await mongoose.connection.transaction(async (session) => {
      const existing = await PointsTransaction.exists({ userId: user._id }).session(session);
      if (existing) return; // someone wrote history meanwhile — skip, never stack docs

      await PointsTransaction.create(
        [
          {
            userId: user._id,
            amount: SIGNUP_POINTS_GRANT,
            type: 'EARNED',
          },
        ],
        { session }
      );
    });
    written += 1;
  }

  // ── Post-run reconciliation report (whole DB, not just candidates) ──
  const users = await User.find({}).select('_id pointsBalance').lean();
  let inconsistent = 0;
  for (const u of users) {
    const [agg] = await PointsTransaction.aggregate([
      { $match: { userId: u._id } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    if ((agg?.total ?? 0) !== (u.pointsBalance ?? 0)) {
      inconsistent += 1;
      logger.warn('backfill_still_inconsistent', {
        userId: String(u._id),
        cached: u.pointsBalance ?? 0,
        ledger: agg?.total ?? 0,
      });
    }
  }

  logger.info('backfill_done', {
    mode: WRITE ? 'WRITE' : 'DRY-RUN',
    written,
    totalUsers: users.length,
    inconsistent,
  });

  await disconnectDb();
  if (inconsistent > 0) process.exitCode = 1; // loud, but data is safe
}

main().catch(async (err) => {
  logger.error('backfill_failed', { error: err.message });
  await disconnectDb().catch(() => {});
  process.exit(1);
});
