/**
 * Users service (§10 users endpoints). Minimal Phase 5 scope: only what the
 * frontend currently needs — the owner's own items (swap-request dialog's
 * offered-item picker, P5-T3; dashboard, P5-T5).
 *
 * VIEWER: receives the auth WRAPPER ({ id, role }) attached by requireAuth —
 * the same convention as items/swaps services (lean docs lack the .id virtual).
 */

import { Item, PointsTransaction } from '../../models/index.js';

/**
 * GET /users/me/items (§10). The caller's OWN items, newest first, ALL
 * statuses (the dashboard shows PENDING moderation items; the swap dialog
 * filters client-side to APPROVED — server-side status forcing like browse's
 * would hide exactly what the owner needs to manage).
 * Ordered with the primary image first so clients can just take images[0].
 */
export async function listMyItems(viewer) {
  return Item.find({ ownerId: viewer.id })
    .sort({ createdAt: -1 })
    .lean({ virtuals: false })
    .then((items) =>
      items.map((item) => ({
        ...item,
        images: [...(item.images ?? [])].sort(
          (a, b) => Number(b.isPrimary ?? false) - Number(a.isPrimary ?? false)
        ),
      }))
    );
}

/**
 * GET /users/me/points/history (§10 users rows): the caller's append-only
 * ledger (§9.1 pointstransactions), newest first, paginated — never unbounded
 * (§ "never unbounded"). The envelope matches the browse/admin shape so the
 * frontend reuses one pagination convention. NOTE: the ledger is the source
 * of truth (§9.3); the balance shown in the UI comes from `users.me`, but
 * this list is what reconciles it.
 */
export async function listMyPointsHistory(query, viewer) {
  const { page, pageSize } = query;
  const filter = { userId: viewer.id };

  const [transactions, total] = await Promise.all([
    PointsTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate('relatedSwapRequestId', 'type status')
      .lean(),
    PointsTransaction.countDocuments(filter),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    transactions,
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}
