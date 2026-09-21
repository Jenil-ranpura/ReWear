/**
 * Users service (§10 users endpoints). Minimal Phase 5 scope: only what the
 * frontend currently needs — the owner's own items (swap-request dialog's
 * offered-item picker, P5-T3; dashboard, P5-T5).
 *
 * VIEWER: receives the auth WRAPPER ({ id, role }) attached by requireAuth —
 * the same convention as items/swaps services (lean docs lack the .id virtual).
 */

import bcrypt from 'bcryptjs';

import { Item, PointsTransaction, User } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { normalizePhone, PROFILE_EDITABLE_FIELDS } from '@rewear/shared-schemas';
import { toSafeUser } from '../auth/authService.js';

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

/** Bcrypt cost matches auth (§11: 10–12). Kept local — same value, same reason. */
const BCRYPT_COST = 10;

/**
 * PATCH /users/me (§10, profile self-service). Viewers may edit ONLY their own
 * profile — the viewer id comes from the token, never the request (§15 IDOR).
 *
 * Edits: name, phone (E.164-normalized, '' clears), and an OPTIONAL password
 * change gated on re-authentication (currentPassword verified against the
 * stored hash BEFORE any write — a stolen session cannot silently take over
 * the credential).
 *
 * Trust model (same as items/swaps): the payload is whitelisted via
 * PROFILE_EDITABLE_FIELDS so role/pointsBalance/email/refreshTokenHash can
 * NEVER ride in even if the validate middleware someday stops stripping
 * unknown keys. email is the account identifier and is not editable here.
 *
 * Returns the SAFE user shape (toSafeUser strips passwordHash and
 * refreshTokenHash) so callers can refresh their AuthContext user directly.
 */
export async function updateMyProfile(payload, viewer) {
  // Whitelist first — unknown/derived fields (role, pointsBalance, email,
  // isBanned, sessionExpiresAt, …) are structurally unreachable.
  const data = {};
  for (const key of PROFILE_EDITABLE_FIELDS) {
    if (payload[key] !== undefined) data[key] = payload[key];
  }

  const wantsPasswordChange = Boolean(data.password && data.password.length > 0);

  // Fetch with the hash included ONLY when we must verify it (select:false on
  // the model keeps credentials out of every casual query).
  const user = await User.findById(viewer.id).select(wantsPasswordChange ? '+passwordHash' : '');
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Account not found.');

  if (wantsPasswordChange) {
    const ok = await bcrypt.compare(data.currentPassword ?? '', user.passwordHash);
    if (!ok) {
      throw new AppError(403, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
    }
    user.passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
  }

  if (data.name !== undefined) user.name = data.name;
  if (data.phone !== undefined) {
    // '' or null clears; a value was already real-phone validated by the
    // shared schema — normalize to E.164 so tel: links just work.
    user.phone = data.phone ? normalizePhone(data.phone) : null;
  }

  await user.save();
  return toSafeUser(user);
}
