/**
 * P2-T4 — Points-ledger reconciliation (implementation.md §9.3).
 * Rule: `users.pointsBalance` (cache) must equal the sum of that user's
 * `pointstransactions.amount` (source of truth). §17 requires this as a
 * standing test; the helper is also usable for admin tooling later.
 */

import { User, PointsTransaction } from '../models/index.js';

/**
 * Reconcile a user's cached balance against their ledger.
 * @param {string|ObjectId} userId
 * @param {import('mongoose').ClientSession} [session] — inside the swap
 *   transaction the check must read the same uncommitted state (§5.7).
 * @returns {Promise<{userId, cached, ledger, consistent}>}
 */
export async function reconcileUserPoints(userId, session = null) {
  const [user] = await User.find({ _id: userId }).session(session).lean();
  if (!user) throw new Error(`[reconcilePoints] User ${userId} not found`);

  const [agg] = await PointsTransaction.aggregate([
    { $match: { userId: user._id } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]).session(session);

  const cached = user.pointsBalance ?? 0;
  const ledger = agg?.total ?? 0;

  return { userId: String(user._id), cached, ledger, consistent: cached === ledger };
}
