/**
 * Items service (§5.4/§10). browseItems is the read path for discovery:
 *
 * - The compound index { status: 1, category: 1 } (§9.1/§23) serves the
 *   dominant browse path (status + optional category). Remaining filters
 *   (size/condition/tags/q/location) apply post-index — fine at MVP scale, and the
 *   index keeps the scan bounded per status/category slice.
 * - Guests/users are FORCED to status=APPROVED (§10: "non-owner/non-admin
 *   callers are implicitly forced to status=APPROVED"); admins may pass
 *   ?status=... to browse other statuses.
 * - q is escaped before building the RegExp (user input must never become
 *   regex metacharacters).
 * - MULTI-VALUE FILTERS vs sanitizeFilter (§15): the global `sanitizeFilter:
 *   true` (lib/db.js) defangs `$in` object-form filters (verified: it wraps
 *   them in `$eq` and casts fail; per-query opt-out does NOT override the
 *   global). Two sanitize-friendly patterns used here: plain-array values on
 *   scalar paths (Mongoose casts to $in natively) for category/size/condition,
 *   and scalar values inside `$or` clauses for tags "contains-any" (arrays
 *   on array paths mean EXACT-array match — not what browse needs). `$or`/
 *   `$and` logical operators pass sanitizeFilter untouched. Do not "upgrade"
 *   any of this to object-form operators.
 * - VIEWER: services receive the auth WRAPPER ({ id, role }) that BOTH
 *   requireAuth and optionalAuth attach — never a user doc (lean docs lack
 *   the .id virtual; that asymmetry broke owner matching once).
 */

import { Item, SwapRequest, User } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { computeSuggestedPoints } from '@rewear/shared-schemas';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function browseItems(query, viewer) {
  const isAdmin = viewer?.role === 'ADMIN';

  // §10: status is admin-only. Guests/users are pinned to APPROVED.
  const status = isAdmin && query.status ? query.status : 'APPROVED';

  const filter = { status };

  // Location filter (user-requested scope addition): resolve free-text
  // location to owner ids FIRST (case-insensitive contains on User.location),
  // then filter items by that id list via a PLAIN ARRAY — the established
  // sanitizeFilter-safe pattern (plain arrays cast to $in natively; object-form
  // $in is defanged — see SECURITY NOTE). Regex VALUE (not an operator) passes
  // sanitizeFilter untouched, same as the q clauses below.
  // Live from the profile on every query: editing your location instantly
  // moves your listings in/out of location-filtered browse — zero
  // denormalization, zero propagation logic to drift.
  // A location matching nobody keeps the EXPLICIT empty array: deleting the
  // key here would silently widen the query to all owners.
  if (query.location) {
    const owners = await User.find({ location: new RegExp(escapeRegExp(query.location), 'i') })
      .select('_id')
      .lean();
    filter.ownerId = owners.map((o) => o._id);
  }

  // Plain arrays — Mongoose casts them to $in (see SECURITY NOTE above).
  if (query.category?.length) filter.category = query.category;
  if (query.size?.length) filter.size = query.size;
  if (query.condition?.length) filter.condition = query.condition;

  // tags: "contains ANY of these" — must be $or of scalar equality (multikey
  // match), NOT a plain array (that would require the whole tags[] to equal).
  const tagClause = query.tags?.length ? query.tags.map((t) => ({ tags: t })) : null;

  const qClause = query.q
    ? [
        { title: new RegExp(escapeRegExp(query.q), 'i') },
        { description: new RegExp(escapeRegExp(query.q), 'i') },
        { tags: new RegExp(escapeRegExp(query.q), 'i') },
      ]
    : null;

  const orClauses = [...(tagClause ?? []), ...(qClause ?? [])];
  if (orClauses.length === 1) filter.$or = orClauses;
  if (orClauses.length > 1) filter.$and = [{ $or: orClauses }]; // keep $or pairs AND-ed together

  const { page, pageSize } = query;
  const [items, total] = await Promise.all([
    Item.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Item.countDocuments(filter),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

export async function getItemById(id, viewer) {
  const item = await Item.findById(id).lean();
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Item not found.');

  // §10: public if approved; owner/admin may view any status. Non-owners get
  // the same 404 for unapproved items — never leak their existence (§15).
  const isOwner = viewer && String(item.ownerId) === String(viewer.id);
  if (item.status !== 'APPROVED' && !isOwner && viewer?.role !== 'ADMIN') {
    throw new AppError(404, 'NOT_FOUND', 'Item not found.');
  }

  // §10 "populated owner": uploader info for the detail page (§5.5).
  // Attached as a SEPARATE `owner` field — raw `ownerId` stays untouched
  // (P4-T3 response contract), and only public profile fields are selected
  // (§15: never select whole user docs, credential fields exist for a reason).
  const owner = await User.findById(item.ownerId)
    .select('name avatarUrl location createdAt')
    .lean();
  return { ...item, owner: owner ?? null };
}

// Items editable/deletable by the owner per §10 PATCH/DELETE rows.
const OWNER_EDITABLE_STATUSES = new Set(['PENDING', 'APPROVED']);

/**
 * Active swap request = PENDING or ACCEPTED (§10 DELETE row: "soft delete if
 * no active swap, else 409"). Anything terminal (REJECTED/CANCELLED) or past
 * (SWAPPED) does not block.
 * sanitizeFilter-safe form: $or of scalar equality (plain-array/object-form
 * $in is defanged by sanitizeFilter — see the SECURITY NOTE at the top).
 */
export async function assertNoActiveSwap(itemId) {
  const active = await SwapRequest.findOne({
    itemId,
    $or: [{ status: 'PENDING' }, { status: 'ACCEPTED' }],
  }).lean();
  if (active) {
    throw new AppError(
      409,
      'ITEM_LOCKED',
      'This item has an active swap request and cannot be changed.'
    );
  }
}

/**
 * Create (§14.1): validate → auto-PENDING (client can never submit status)
 * → duplicate-image FLAG ONLY (§14.1: flag, never block) → insert. AI
 * classification is advisory-only and NOT part of this path (§14.4/§16).
 */
export async function createItem(payload, viewer) {
  // Duplicate-image FLAG ONLY (§14.1). sanitizeFilter-safe plain-array form
  // (same rule as browse — see the SECURITY NOTE at the top of this file).
  // Hashes come from POST /items/images (server-computed via sharp); a
  // client-supplied value can at worst skew this advisory flag, never block.
  const submittedHashes = (payload.images ?? []).map((i) => i.perceptualHash).filter(Boolean);
  const isDuplicateImage = submittedHashes.length
    ? await Item.exists({ 'images.perceptualHash': submittedHashes })
    : null;

  const item = await Item.create({
    ...payload,
    ownerId: viewer.id,
    status: 'PENDING',
    // §14.4 revised (Session 13, user request): pointValue is DERIVED from
    // the fixed formula — never client-set. Spread AFTER payload so a
    // smuggled 3000 cannot survive (same trust pattern as status/ownerId).
    pointValue: computeSuggestedPoints(payload.category, payload.condition),
    // §14.5: a duplicate-image match PRE-FILLS moderationReason so the flag
    // surfaces in the admin queue itself (create-time response alone isn't
    // visible there). Advisory only — the item is still created normally.
    // Spread AFTER payload so a client can never set/override this field.
    ...(isDuplicateImage
      ? {
          moderationReason:
            'Possible duplicate: image matches an existing listing — review before approving.',
        }
      : {}),
    // Persist the hash that the upload endpoint computed; URLs + isPrimary
    // only for anything the client sent without one (advisory flag skips it).
    images: payload.images.map((i) => ({
      url: i.url,
      isPrimary: Boolean(i.isPrimary),
      ...(i.perceptualHash ? { perceptualHash: i.perceptualHash } : {}),
    })),
  });

  return {
    item: item.toObject(),
    duplicateImageFlagged: Boolean(isDuplicateImage),
  };
}

/**
 * Owner-only update (§10): status must be PENDING/APPROVED; no active swap.
 * Ownership is re-checked in the service (§15 IDOR — middleware alone is
 * never the only guard). Returns the fresh doc.
 */
export async function updateItem(id, payload, viewer) {
  const item = await Item.findById(id);
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Item not found.');
  if (String(item.ownerId) !== String(viewer.id)) {
    throw new AppError(403, 'FORBIDDEN', 'You can only edit your own items.');
  }
  if (!OWNER_EDITABLE_STATUSES.has(item.status)) {
    throw new AppError(409, 'ITEM_LOCKED', `Items in status ${item.status} cannot be edited.`);
  }
  await assertNoActiveSwap(item._id);

  // Same trust rule as create: persist only echoes of server-computed data.
  if (payload.images) {
    payload.images = payload.images.map((i) => ({
      url: i.url,
      isPrimary: Boolean(i.isPrimary),
      ...(i.perceptualHash ? { perceptualHash: i.perceptualHash } : {}),
    }));
  }

  // §14.4 revised (Session 13): points are ALWAYS formula-derived — strip a
  // client-sent pointValue BEFORE it can reach the doc via Object.assign.
  delete payload.pointValue;
  Object.assign(item, payload);
  // If the payload changed category/condition, recompute from the merged
  // values; otherwise the stored value stays untouched. Either way the
  // client never decides points.
  if (payload.category !== undefined || payload.condition !== undefined) {
    item.pointValue = computeSuggestedPoints(item.category, item.condition);
  }
  await item.save();
  return item.toObject();
}

/**
 * Owner-only SOFT delete (§10): sets status=REMOVED, never deletes the doc
 * (swap history and ledger entries reference items). Same guards as update.
 */
export async function softDeleteItem(id, viewer) {
  const item = await Item.findById(id);
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Item not found.');
  if (String(item.ownerId) !== String(viewer.id)) {
    throw new AppError(403, 'FORBIDDEN', 'You can only delete your own items.');
  }
  if (item.status === 'REMOVED') {
    return item.toObject(); // idempotent (§5.9: repeat delete is a no-op)
  }
  if (!OWNER_EDITABLE_STATUSES.has(item.status)) {
    throw new AppError(409, 'ITEM_LOCKED', `Items in status ${item.status} cannot be deleted.`);
  }
  await assertNoActiveSwap(item._id);

  item.status = 'REMOVED';
  await item.save();
  return item.toObject();
}
