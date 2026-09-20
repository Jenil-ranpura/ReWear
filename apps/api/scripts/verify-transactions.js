/**
 * P2-T5 — Transaction smoke test against the REAL dev Atlas cluster
 * (implementation.md §27 P2-T5).
 *
 * Purpose: prove multi-document ACID transactions actually work on this
 * cluster BEFORE building the swap-accept flow (Phase 4) on that assumption.
 * Per §27 Phase 2 validation: if this fails, stop and re-check the Atlas
 * tier/configuration — it is a hard prerequisite for Phase 4.
 *
 * Proves three things:
 *   1. A multi-document transaction commits atomically (both docs visible together).
 *   2. An aborted transaction leaves NO partial state (rollback works).
 *   3. The §5.7 race pattern behaves: two concurrent conditional
 *      findOneAndUpdate claims on the same item → exactly one wins.
 *
 * Uses a throwaway database (rewear-tx-smoke-test) and drops it afterwards.
 * Run: npm run verify:tx
 */

import mongoose from 'mongoose';
import env from '../src/config/env.js';
import logger from '../src/lib/logger.js';
import { connectDb, disconnectDb } from '../src/lib/db.js';

const SMOKE_DB = 'rewear-tx-smoke-test';

function fail(message) {
  logger.error('tx_smoke_test_FAILED', { reason: message });
  process.exitCode = 1;
}

async function main() {
  if (!env.MONGODB_URI) {
    fail('MONGODB_URI is not set.');
    process.exit(1);
  }

  await connectDb(env.MONGODB_URI);
  const uri = new URL(env.MONGODB_URI);
  uri.pathname = `/${SMOKE_DB}`;
  await mongoose.disconnect();
  await mongoose.connect(uri.toString(), { serverSelectionTimeoutMS: 10000 });

  logger.info('tx_smoke_start', { db: SMOKE_DB });

  const thingSchema = new mongoose.Schema(
    { name: String, claimed: Boolean },
    { collection: 'things' }
  );
  const Thing = mongoose.model('Thing', thingSchema);
  await Thing.deleteMany({});

  // --- 1. Atomic commit of two related documents ---
  let session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // NOTE: Mongoose requires `ordered: true` when create() gets an array + session.
      await Thing.create(
        [
          { name: 'a', claimed: false },
          { name: 'b', claimed: false },
        ],
        { session, ordered: true }
      );
    });
    const count = await Thing.countDocuments();
    if (count !== 2) fail(`commit test: expected 2 docs after commit, found ${count}`);
    else logger.info('tx_smoke_commit_ok', { docs: count });
  } catch (err) {
    fail(`commit test: transaction commit failed — ${err.message}`);
  } finally {
    await session.endSession();
  }

  // --- 2. Abort leaves no partial state ---
  session = await mongoose.startSession();
  try {
    await session.startTransaction();
    await Thing.create([{ name: 'ghost', claimed: false }], { session });
    await session.abortTransaction();
    const count = await Thing.countDocuments();
    if (count !== 2)
      fail(`abort test: expected 2 docs after rollback, found ${count} — PARTIAL STATE LEAKED`);
    else logger.info('tx_smoke_abort_ok');
  } catch (err) {
    fail(`abort test: ${err.message}`);
  } finally {
    await session.endSession();
  }

  // --- 3. §5.7 race pattern: two concurrent conditional claims, one winner ---
  const item = await Thing.findOne({ name: 'a' });
  const conditionalClaim = async () => {
    const s = await mongoose.startSession();
    try {
      let winner = false;
      await s.withTransaction(async () => {
        const res = await Thing.findOneAndUpdate(
          { _id: item._id, claimed: false },
          { $set: { claimed: true } },
          { session: s }
        );
        winner = Boolean(res);
        // No match = the other concurrent transaction already claimed it:
        // abort this transaction — the §5.7 "losing request gets a clean 409" path.
        if (!res) throw new Error('simulated 409 — item already claimed');
      });
      return { winner, error: null };
    } catch (err) {
      return { winner: false, error: err };
    } finally {
      await s.endSession();
    }
  };

  const [first, second] = await Promise.all([conditionalClaim(), conditionalClaim()]);
  const winners = [first, second].filter((r) => r.winner).length;
  if (winners !== 1) {
    fail(
      `race test: expected exactly 1 winner, got ${winners} — this is the §5.7 double-swap hazard`
    );
  } else {
    logger.info('tx_smoke_race_ok', { note: 'one winner, one clean simulated 409' });
  }

  await mongoose.connection.dropDatabase();

  if (process.exitCode) {
    logger.error('tx_smoke_test_FAILED', { summary: 'see entries above — fix before Phase 4' });
  } else {
    logger.info('tx_smoke_test_PASSED', {
      summary:
        'multi-doc transactions, rollback, and the conditional-claim race all behave on this cluster',
    });
  }
  await disconnectDb();
  process.exit(process.exitCode || 0);
}

main().catch(async (err) => {
  logger.error('tx_smoke_test_FAILED', { error: err.message });
  await disconnectDb();
  process.exit(1);
});
