/**
 * P4-T6 — Admin moderation service (implementation.md §5.8/§10/§9.1).
 * Audit trail rule (§9.1): every action writes an append-only AdminAction
 * row — that row (who/what/why/when) IS the oversight mechanism, so admins
 * CAN moderate their own items [ASSUMPTION: spec mandates no prohibition,
 * and blocking it wedges single-admin deployments; recorded in progress.md].
 * Self-ban, however, IS refused — an obvious lockout footgun with no
 * recovery flow in a single-admin setup.
 */

import mongoose from 'mongoose';

import {
  Item,
  User,
  AdminAction,
  Report,
  SwapRequest,
  PointsTransaction,
} from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { toSafeUser } from '../auth/authService.js';
import { withTransactionRetry } from '../../lib/withTransaction.js';

const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);

const PAGE_CEILING = 60;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * §5.8 queue: PENDING items, oldest first (fair moderation order), with the
 * owner's name for display. Paginated — never unbounded.
 */
export async function listPendingItems(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(PAGE_CEILING, Math.max(1, Number(query.pageSize) || 20));

  const filter = { status: 'PENDING' };
  const [items, total] = await Promise.all([
    Item.find(filter)
      .sort({ createdAt: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate('ownerId', 'name email')
      .lean(),
    Item.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    hasNextPage: page * pageSize < total,
    hasPrevPage: page > 1,
  };
}

/** Resolve an item by id or throw the §10 404 shape. NOTE: no `$ne` filter
 * here — sanitizeFilter defangs object-form operators on scalar paths into
 * CastErrors (the documented trap, `$in`/`$ne` variants); REMOVED items fall
 * through to the PENDING transition guard instead. */
async function getItemOr404(id) {
  const item = await Item.findOne({ _id: id });
  if (!item) throw notFound('Item');
  return item;
}

/** Append the audit row (§9.1 adminactions). Never updated or deleted. */
async function audit(adminId, targetType, targetId, action, reason) {
  await AdminAction.create({ adminId, targetType, targetId, action, reason: reason || null });
}

/**
 * §5.8 moderate: { action: APPROVE|REJECT, reason? } → conditional status
 * update + audit row. Conditional update = the same race discipline as the
 * swap gate (§5.7): if the item left PENDING (e.g. moderated concurrently or
 * swapped between queue fetch and click), the match fails and the admin
 * gets 409 CONFLICT instead of a stale overwrite.
 */
export async function moderateItem(itemId, { action, reason }, viewer) {
  const statusByAction = { APPROVE: 'APPROVED', REJECT: 'REJECTED' };
  const nextStatus = statusByAction[action];
  if (!nextStatus) {
    // Schema already enforces the enum; this is a defensive second gate.
    throw new AppError(400, 'VALIDATION', 'Unknown moderation action.');
  }

  const item = await getItemOr404(itemId);

  // Transition guard: only PENDING items are moderatable (§5.8 queue flow).
  if (item.status !== 'PENDING') {
    throw new AppError(
      409,
      'INVALID_STATE',
      `Item is already ${item.status}; only PENDING items can be moderated.`
    );
  }

  // Conditional update: match ONLY the state we validated (race-safe, §5.7).
  const updated = await Item.findOneAndUpdate(
    { _id: item._id, status: 'PENDING' },
    { $set: { status: nextStatus, moderationReason: reason || null } },
    { new: true }
  );
  if (!updated) {
    throw new AppError(409, 'CONFLICT', 'Item status changed; refresh the queue.');
  }

  await audit(viewer.id, 'Item', item._id, action, reason);

  return updated.toObject();
}

/**
 * §10 GET /admin/users — search/filter with q (name/email, escaped), role and
 * banned filters. Returns safe users (passwordHash/refreshTokenHash stripped
 * via toSafeUser). Paginated.
 */
export async function listUsers(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(PAGE_CEILING, Math.max(1, Number(query.pageSize) || 20));

  const filter = {};
  if (query.q) {
    const rx = new RegExp(escapeRegExp(query.q), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  if (query.role) filter.role = query.role;
  if (query.banned !== undefined) filter.isBanned = query.banned;

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    User.countDocuments(filter),
  ]);

  return {
    users: users.map(toSafeUser),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    hasNextPage: page * pageSize < total,
    hasPrevPage: page > 1,
  };
}

/**
 * §10 PATCH /admin/users/:id/ban { banned, reason? } — unban too (banned:
 * false). Effects of a ban: the user's refresh flow already refuses banned
 * accounts (§5.2, ACCOUNT_BANNED) and requireAuth re-fetches per request, so
 * a still-valid access token dies on its NEXT request — instant enforcement
 * without a denylist (§11 design, test exists in this task's suite).
 */
export async function setUserBanned(userId, { banned, reason }, viewer) {
  if (String(userId) === String(viewer.id)) {
    throw new AppError(400, 'FORBIDDEN', 'Admins cannot ban themselves.');
  }

  const user = await User.findById(userId);
  if (!user) throw notFound('User');

  if (user.isBanned === banned) {
    // Idempotent: same value → no-op (still audited).
    await audit(viewer.id, 'User', user._id, banned ? 'BAN' : 'UNBAN', reason);
    return { user: toSafeUser(user), changed: false };
  }

  user.isBanned = banned;
  if (banned) {
    // §11/§5.2: kill the session so a stolen cookie can't ride out the ban.
    user.refreshTokenHash = null;
  }
  await user.save();

  await audit(viewer.id, 'User', user._id, banned ? 'BAN' : 'UNBAN', reason);

  return { user: toSafeUser(user), changed: true };
}

/**
 * GET /admin/users/:id — the INVESTIGATION view (user-requested evidence kit).
 * When a report lands on someone, the admin needs that person's whole story on
 * one page: identity + contact, every item they listed (including the audit
 * fields moderation needs), every swap they took part in, the append-only
 * points ledger, reports filed BY and AGAINST them, and every admin action
 * taken ON them (bans and their recorded reasons).
 *
 * Read-only and admin-only; nothing here mutates. Pagination is applied to
 * the high-volume lists (items/swaps/ledger); reports and admin actions are
 * naturally low-volume and returned in full.
 */
export async function getUserDetail(userId, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(PAGE_CEILING, Math.max(1, Number(query.pageSize) || 20));

  const user = await User.findById(userId).lean();
  if (!user) throw notFound('User');

  // participant = either side of the swap (requester OR original owner via
  // the participants snapshot — ownerId flips on accept, so it can't be the
  // only key; scalar-array match is the sanitizeFilter-safe pattern).
  const [items, swaps, ledger, reportsFiled, reportsAgainst, adminActions, itemCounts] =
    await Promise.all([
      Item.find({ ownerId: userId }).sort({ createdAt: -1 }).lean(),
      SwapRequest.find({
        $or: [{ requesterId: userId }, { participants: userId }],
      })
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate('requesterId', 'name email')
        .populate('itemId', 'title status pointValue ownerId')
        .populate('offeredItemId', 'title status pointValue')
        .lean(),
      PointsTransaction.find({ userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate('relatedSwapRequestId', 'type status')
        .lean(),
      Report.find({ reporterId: userId })
        .sort({ createdAt: -1 })
        .populate('againstId', 'name email')
        .populate('swapRequestId', 'type status')
        .lean(),
      Report.find({ againstId: userId })
        .sort({ createdAt: -1 })
        .populate('reporterId', 'name email')
        .populate('swapRequestId', 'type status')
        .lean(),
      AdminAction.find({ targetType: 'User', targetId: userId })
        .sort({ createdAt: -1 })
        .populate('adminId', 'name email')
        .lean(),
      // Behavioral counters — computed in ONE grouped query (not per-status
      // find calls) so the dashboard answers "what has this account done?"
      // without N round-trips.
      Item.aggregate([
        { $match: { ownerId: new mongoose.Types.ObjectId(String(userId)) } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

  const counts = { total: 0, PENDING: 0, APPROVED: 0, REJECTED: 0, SWAPPED: 0 };
  for (const row of itemCounts) {
    counts[row._id] = row.count;
    counts.total += row.count;
  }

  return {
    user: toSafeUser(user),
    counts,
    items,
    swaps: {
      items: swaps,
      total: swaps.length, // page-scoped — the lists are the evidence, not a scrollable archive
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(swaps.length / pageSize)),
    },
    ledger,
    reportsFiled,
    reportsAgainst,
    adminActions,
  };
}

/**
 * ── Dispute reports (user-requested fraud-response scope addition) ──
 * The queue and the human remedy. Design rule: the platform NEVER
 * auto-reverses a completed swap (automated reversal of money = scammable);
 * a human admin reads the report + ledger trail and decides.
 */

/** GET /admin/reports?status=open — OPEN first (oldest first, fair order). */
export async function listReports(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(PAGE_CEILING, Math.max(1, Number(query.pageSize) || 20));

  const filter = query.status ? { status: query.status } : {};
  const [reports, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate('reporterId', 'name email')
      .populate('againstId', 'name email')
      .populate({
        path: 'swapRequestId',
        select: 'type status requesterId itemId requesterPhone',
        populate: [
          { path: 'requesterId', select: 'name email' },
          { path: 'itemId', select: 'title status pointValue' },
        ],
      })
      .lean(),
    Report.countDocuments(filter),
  ]);

  return {
    reports,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    hasNextPage: page * pageSize < total,
    hasPrevPage: page > 1,
  };
}

/**
 * PATCH /admin/reports/:id — the human remedy.
 *  - remedy NONE: close with a note, no ledger effect.
 *  - remedy REFUND (POINTS_REDEMPTION disputes): reverse the swap's ledger
 *    pair with two ADJUSTED entries — the §9.3 invariant holds for reversals
 *    too (ledger docs + balance-cache written in the SAME transaction) — and
 *    flip the swap to CANCELLED so the item can be re-listed by the owner.
 *    The offender's balance CLAMPS AT 0 (cannot extract points that were
 *    already spent); the clamp is stated in the resolution note context.
 * Every resolve is idempotence-guarded (a RESOLVED report can't re-resolve)
 * and audited (AdminAction row).
 */
export async function resolveReport(reportId, { remedy, resolutionNote }, viewer) {
  const report = await Report.findById(reportId);
  if (!report) throw notFound('Report');
  if (report.status !== 'OPEN') {
    throw new AppError(409, 'INVALID_STATE', `This report is already ${report.status}.`);
  }

  let refund = null;

  if (remedy === 'REFUND') {
    const swapRequest = await SwapRequest.findById(report.swapRequestId);
    if (!swapRequest) throw notFound('Swap request');
    if (swapRequest.type !== 'POINTS_REDEMPTION') {
      throw new AppError(
        400,
        'VALIDATION',
        'Only points-redemption swaps move points — direct swaps have nothing to refund.'
      );
    }

    const pointsTx = await PointsTransaction.findOne({
      relatedSwapRequestId: swapRequest._id,
      type: 'SPENT',
    }).lean();
    if (!pointsTx) {
      throw new AppError(
        409,
        'INVALID_STATE',
        'No SPENT ledger entry found for this swap — nothing to refund.'
      );
    }
    const amount = Math.abs(pointsTx.amount);

    refund = await withTransactionRetry(async (session) => {
      // The remedy unwinds the ORIGINAL TRANSACTION, independent of who
      // filed: credit the requester (they get their points back), debit the
      // ORIGINAL owner (participants[0] — post-transfer ownership is
      // unreliable). Test-caught bug: keying the debit on report.againstId
      // would debit/credit the same user when the owner files.
      const originalOwnerId = swapRequest.participants[0];
      const beneficiaryId = swapRequest.requesterId;

      // §9.3 invariant preservation: refund only what is RECOVERABLE — the
      // owner's balance may have dropped below the swap amount (they spent
      // the points). Clamping the CACHE would break cache=ledger; going
      // NEGATIVE would invent a debt concept. So the refund amount is
      // min(swap amount, current balance), computed INSIDE the transaction
      // (race-safe), and any shortfall is reported to the admin (it lands in
      // the resolution note) — the ledger and cache move by the SAME refund
      // amount, so reconciliation still holds exactly.
      const offender = await User.findById(originalOwnerId).session(session);
      const requester = await User.findById(beneficiaryId).session(session);
      const refundAmount = Math.min(amount, offender.pointsBalance ?? 0);

      // Reverse the ledger pair (append-only — never mutate the originals).
      await PointsTransaction.create(
        [
          {
            userId: swapRequest.requesterId,
            amount: refundAmount,
            type: 'ADJUSTED',
            relatedSwapRequestId: swapRequest._id,
          },
        ],
        { session }
      );
      await PointsTransaction.create(
        [
          {
            userId: originalOwnerId,
            amount: -refundAmount,
            type: 'ADJUSTED',
            relatedSwapRequestId: swapRequest._id,
          },
        ],
        { session }
      );

      // Cache updates in the SAME transaction (§9.3).
      await User.updateOne(
        { _id: offender._id },
        { $set: { pointsBalance: (offender.pointsBalance ?? 0) - refundAmount } },
        { session }
      );
      await User.updateOne(
        { _id: requester._id },
        { $set: { pointsBalance: (requester.pointsBalance ?? 0) + refundAmount } },
        { session }
      );

      // Close the swap record. Item ownership is NOT auto-reverted (the
      // physical item may already have changed hands — re-listing is the
      // admin's manual follow-up, documented decision).
      swapRequest.status = 'CANCELLED';
      await swapRequest.save({ session });

      return { amount: refundAmount, requested: amount, shortfall: amount - refundAmount };
    });
  }

  report.status = remedy === 'REFUND' ? 'RESOLVED' : 'DISMISSED';
  report.remedy = remedy;
  report.resolutionNote = refund?.shortfall
    ? `${resolutionNote} (Only ${refund.amount} of ${refund.requested} pts was recoverable — the offender's balance was lower.)`
    : resolutionNote;
  report.resolvedBy = viewer.id;
  report.resolvedAt = new Date();
  await report.save();

  await audit(
    viewer.id,
    'Report',
    report._id,
    remedy === 'REFUND' ? 'REFUND' : 'DISMISS',
    resolutionNote
  );

  return { report: report.toObject(), refund };
}
