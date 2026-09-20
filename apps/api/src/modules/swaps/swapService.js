/**
 * Swap-request service (P4-T4) — THE highest-risk module (§5.7/§14.3).
 *
 * acceptSwapRequest implements the spec's concurrency guarantee EXACTLY:
 *   session transaction
 *     → conditional Item.findOneAndUpdate({ _id, status: 'APPROVED' }, …)
 *       (null result = lost the race → throw 409 → transaction ABORTS,
 *        nothing half-applied)
 *     → type-specific final state, ALL inside the same transaction:
 *         DIRECT_SWAP:        both items' ownerId swap, both → SWAPPED
 *         POINTS_REDEMPTION:  two append-only PointsTransaction docs +
 *                             both users' pointsBalance cache (§9.3/§9.4:
 *                             ledger + cache only ever written together,
 *                             in the same transaction)
 *     → SwapRequest → ACCEPTED
 *     → other PENDING requests on the now-taken items → REJECTED
 *   → commit
 *
 * sanitizeFilter note: EVERY filter in this module uses only scalar
 * equality or $and/$or/$nor over scalar equality — object-form operators
 * ({ $in: … }, { $ne: … }) are defanged by the global sanitizeFilter setting
 * (see itemsService for the full investigation). Keep it that way.
 */

import { Item, PointsTransaction, Report, SwapRequest, User } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { withTransactionRetry } from '../../lib/withTransaction.js';
import { DIRECT_SWAP, POINTS_REDEMPTION, normalizePhone } from '@rewear/shared-schemas';

function notFound(what = 'Swap request') {
  return new AppError(404, 'NOT_FOUND', `${what} not found.`);
}

/**
 * §14.2 creation rules. Runs OUTSIDE a transaction by design: it only reads
 * then inserts one SwapRequest — double-submission races are bounded by the
 * one-pending-per-requester-per-item rule check at accept time anyway.
 */
export async function createSwapRequest(itemId, payload, viewer) {
  const item = await Item.findById(itemId).lean();
  if (!item) throw notFound('Item');
  if (String(item.ownerId) === String(viewer.id)) {
    throw new AppError(400, 'INVALID_SWAP', 'You cannot request a swap on your own item.');
  }
  if (item.status !== 'APPROVED') {
    throw new AppError(409, 'ITEM_NOT_AVAILABLE', 'This item is not available for swaps.');
  }

  let offeredItemId = null;

  if (payload.type === DIRECT_SWAP) {
    if (!payload.offeredItemId) {
      throw new AppError(400, 'VALIDATION', 'An offered item is required for a direct swap.');
    }
    const offered = await Item.findById(payload.offeredItemId).lean();
    if (!offered) throw notFound('Offered item');
    if (String(offered.ownerId) !== String(viewer.id)) {
      throw new AppError(403, 'FORBIDDEN', 'You can only offer items you own.');
    }
    if (offered.status !== 'APPROVED') {
      throw new AppError(409, 'ITEM_NOT_AVAILABLE', 'The offered item must be APPROVED.');
    }
    if (String(offered._id) === String(item._id)) {
      throw new AppError(400, 'INVALID_SWAP', 'You cannot offer the item being requested.');
    }
    offeredItemId = offered._id;
  }

  if (payload.type === POINTS_REDEMPTION) {
    const requester = await User.findById(viewer.id).lean();
    if (!requester) throw notFound('User');
    if ((requester.pointsBalance ?? 0) < item.pointValue) {
      throw new AppError(
        409,
        'INSUFFICIENT_POINTS',
        'You do not have enough points for this redemption.'
      );
    }
  }

  const duplicate = await SwapRequest.findOne({
    itemId,
    requesterId: viewer.id,
    status: 'PENDING',
  }).lean();
  if (duplicate) {
    throw new AppError(
      409,
      'DUPLICATE_REQUEST',
      'You already have a pending request on this item.'
    );
  }

  const swapRequest = await SwapRequest.create({
    itemId,
    requesterId: viewer.id,
    // Contact reveal: freeze who the two parties are AT CREATION — after an
    // accept transfers ownership, item.ownerId can no longer identify the
    // original owner (it names the requester). participants[1] = requester.
    participants: [item.ownerId, viewer.id],
    // Requester's volunteered number for THIS exchange. Schema-validated
    // (real-phone rules); stored normalized E.164 so tel: links just work.
    requesterPhone: payload.requesterPhone ? normalizePhone(payload.requesterPhone) : null,
    type: payload.type,
    offeredItemId,
    status: 'PENDING',
  });

  return swapRequest.toObject();
}

/**
 * THE accept flow (§5.7). Retries transient transaction failures (Mongo's
 * WriteConflict) a few times before surfacing an error; genuine races exit
 * earlier via the conditional update 409.
 */
export async function acceptSwapRequest(swapRequestId, viewer) {
  return withTransactionRetry(async (session) => {
    // §10: only the item's OWNER may accept. Re-fetch inside the transaction.
    const swapRequest = await SwapRequest.findOne({ _id: swapRequestId }).session(session);
    if (!swapRequest) throw notFound();
    if (swapRequest.status !== 'PENDING') {
      // Distinguish a genuine state error from LOSING THE §14.3 RACE: when a
      // concurrent accept won, it auto-REJECTED this request and took the item
      // — the spec (§5.7) mandates the truthful 409 CONFLICT for that path,
      // not a generic "already {status}". An ACCEPTED request (double-accept)
      // or one rejected/cancelled while its item is still APPROVED is a real
      // INVALID_STATE.
      if (swapRequest.status === 'REJECTED') {
        const itemStillAvailable = await Item.exists({
          _id: swapRequest.itemId,
          status: 'APPROVED',
        }).session(session);
        if (!itemStillAvailable) {
          throw new AppError(409, 'CONFLICT', 'Item no longer available.');
        }
      }
      throw new AppError(409, 'INVALID_STATE', `This request is already ${swapRequest.status}.`);
    }

    const item = await Item.findOne({ _id: swapRequest.itemId }).session(session);
    if (!item) throw notFound('Item');
    if (String(item.ownerId) !== String(viewer.id)) {
      throw new AppError(403, 'FORBIDDEN', 'Only the item owner can accept a swap request.');
    }

    // ── Race gate (§14.3): conditional on current status. null ⇒ lost race. ──
    const claimed = await Item.findOneAndUpdate(
      { _id: item._id, status: 'APPROVED' },
      { $set: { status: 'PENDING_TRANSFER' } },
      { session, new: true }
    );
    if (!claimed) {
      throw new AppError(409, 'CONFLICT', 'Item no longer available.');
    }

    if (swapRequest.type === DIRECT_SWAP) {
      // Same conditional gate on the OFFERED item.
      const offeredClaimed = await Item.findOneAndUpdate(
        { _id: swapRequest.offeredItemId, status: 'APPROVED' },
        { $set: { status: 'PENDING_TRANSFER' } },
        { session, new: true }
      );
      if (!offeredClaimed) {
        throw new AppError(409, 'CONFLICT', 'Offered item no longer available.');
      }

      // §5.7 final state: swap owners, both → SWAPPED.
      await Item.updateOne(
        { _id: item._id },
        { $set: { ownerId: swapRequest.requesterId, status: 'SWAPPED' } },
        { session }
      );
      await Item.updateOne(
        { _id: swapRequest.offeredItemId },
        { $set: { ownerId: viewer.id, status: 'SWAPPED' } },
        { session }
      );
    } else {
      // POINTS_REDEMPTION (§5.7 + P4-T5): ledger docs + cache updates in the
      // SAME transaction — the §9.3 invariant.
      const requester = await User.findOne({ _id: swapRequest.requesterId }).session(session);
      const owner = await User.findOne({ _id: viewer.id }).session(session);
      if (!requester || !owner) throw notFound('User');
      if ((requester.pointsBalance ?? 0) < item.pointValue) {
        throw new AppError(409, 'INSUFFICIENT_POINTS', 'Requester no longer has enough points.');
      }

      await PointsTransaction.create(
        [
          {
            userId: requester._id,
            amount: -item.pointValue,
            type: 'SPENT',
            relatedSwapRequestId: swapRequest._id,
          },
        ],
        { session }
      );
      await PointsTransaction.create(
        [
          {
            userId: owner._id,
            amount: item.pointValue,
            type: 'EARNED',
            relatedSwapRequestId: swapRequest._id,
          },
        ],
        { session }
      );

      await User.updateOne(
        { _id: requester._id },
        { $set: { pointsBalance: requester.pointsBalance - item.pointValue } },
        { session }
      );
      await User.updateOne(
        { _id: owner._id },
        { $set: { pointsBalance: (owner.pointsBalance ?? 0) + item.pointValue } },
        { session }
      );

      // Item transfers to the redeemer.
      await Item.updateOne(
        { _id: item._id },
        { $set: { ownerId: requester._id, status: 'SWAPPED' } },
        { session }
      );
    }

    swapRequest.status = 'ACCEPTED';
    await swapRequest.save({ session });

    // Auto-reject OTHER pending requests on the now-taken item(s) (§5.7).
    // sanitizeFilter-safe form: $nor/$and of scalar equality (object-form
    // operators like { $ne: … } are defanged by the global setting — see the
    // module header note). $nor([thisRequest, notPending]) ≡ not-this ∧ pending.
    const takenItemIds = [
      item._id,
      ...(swapRequest.offeredItemId ? [swapRequest.offeredItemId] : []),
    ];
    await SwapRequest.updateMany(
      {
        $and: [
          { $nor: [{ _id: swapRequest._id }] },
          { $or: takenItemIds.map((id) => ({ itemId: id })) },
          { status: 'PENDING' },
        ],
      },
      { $set: { status: 'REJECTED' } },
      { session }
    );

    return swapRequest.toObject();
  });
}

/**
 * Owner rejects / requester cancels (§5.7: "same session discipline, status
 * only, no ownership/points side effects").
 */
export async function resolveSwapRequest(swapRequestId, action, viewer) {
  const swapRequest = await SwapRequest.findById(swapRequestId);
  if (!swapRequest) throw notFound();

  const isOwner = await Item.exists({ _id: swapRequest.itemId, ownerId: viewer.id });
  const isRequester = String(swapRequest.requesterId) === String(viewer.id);

  if (action === 'CANCEL') {
    if (!isRequester) throw new AppError(403, 'FORBIDDEN', 'Only the requester can cancel.');
  } else {
    if (!isOwner) throw new AppError(403, 'FORBIDDEN', 'Only the item owner can reject a request.');
  }

  if (swapRequest.status !== 'PENDING') {
    throw new AppError(409, 'INVALID_STATE', `This request is already ${swapRequest.status}.`);
  }

  swapRequest.status = action === 'CANCEL' ? 'CANCELLED' : 'REJECTED';
  // Contact reveal consent dies with the swap: a volunteered number must not
  // persist on a dead document (nothing reveals it for terminal states, but
  // scrubbing honors the "for this exchange" contract at the data level).
  swapRequest.requesterPhone = null;
  await swapRequest.save();
  return swapRequest.toObject();
}

/**
 * Contact reveal (user-requested): for ACCEPTED swaps ONLY, attach the
 * COUNTERPARTY's contact — { name, email, phone } — so the two people can
 * actually meet up. Consent mapping:
 *   - requester's phone = the number they volunteered on THIS request
 *     (requesterPhone) — never their profile phone (that consent is signup-
 *     time and unused here; explicit beats implicit).
 *   - owner's phone = their profile `phone` (volunteered at signup for
 *     exactly this).
 * Non-accepted rows get NO contact field at all — the field's existence
 * cannot leak acceptance-independent data. Terminal-state rows never carry
 * a phone (requesterPhone is scrubbed at resolve time).
 * Batched: one User.find per list page (plain-array _id → native $in, the
 * sanitizeFilter-safe pattern — NEVER object-form { $in: ... }).
 */
async function attachContacts(requests, viewerId) {
  const accepted = requests.filter((r) => r.status === 'ACCEPTED');
  if (accepted.length === 0) return requests;

  const counterpartyIds = accepted.map((r) => {
    const mine = String(r.requesterId?._id ?? r.requesterId) === String(viewerId);
    return mine ? r.participants[0] : r.participants[1];
  });
  const users = await User.find({ _id: counterpartyIds }).select('name email phone').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  for (const request of accepted) {
    const isMine = String(request.requesterId?._id ?? request.requesterId) === String(viewerId);
    const counterpartyId = isMine ? request.participants[0] : request.participants[1];
    const user = byId.get(String(counterpartyId));
    if (!user) continue; // vanished account — row renders without contact
    const counterpartyIsRequester =
      String(counterpartyId) === String(request.requesterId?._id ?? request.requesterId);
    request.contact = {
      name: user.name,
      email: user.email,
      phone: counterpartyIsRequester ? (request.requesterPhone ?? null) : (user.phone ?? null),
    };
  }
  return requests;
}

/**
 * Report a completed swap (user-requested fraud-response scope addition).
 * Disputes are the HUMAN adjudication layer: the platform can't verify a
 * physical meetup, so it never auto-reverses a completed swap — an admin
 * reads the report and decides (see adminService.resolveReport).
 *
 * Rules (each test-pinned):
 *  - BOTH parties of an ACCEPTED swap may report (identity via the
 *    participants snapshot — post-transfer ownership is unreliable).
 *  - One dispute per REPORTER per swap (both sides can still each file).
 *  - Non-participants get 403; non-accepted swaps get 409 (nothing to
 *    dispute yet — the exchange hasn't been agreed).
 */
export async function createSwapReport(swapRequestId, payload, viewer) {
  const swapRequest = await SwapRequest.findById(swapRequestId).lean();
  if (!swapRequest) throw notFound('Swap request');

  const isRequester = String(swapRequest.requesterId) === String(viewer.id);
  const participants = (swapRequest.participants ?? []).map((p) => String(p));
  const isParticipant = isRequester || participants.includes(String(viewer.id));
  if (!isParticipant) {
    throw new AppError(403, 'FORBIDDEN', 'Only the swap participants can report it.');
  }
  if (swapRequest.status !== 'ACCEPTED') {
    throw new AppError(
      409,
      'INVALID_STATE',
      'Only accepted swaps can be reported — this exchange has not been agreed.'
    );
  }

  const duplicate = await Report.findOne({ swapRequestId, reporterId: viewer.id }).lean();
  if (duplicate) {
    throw new AppError(409, 'DUPLICATE_REPORT', 'You have already reported this swap.');
  }

  // The counterparty from the snapshot (never from item ownership).
  const againstId = isRequester ? participants[0] : swapRequest.requesterId;

  return Report.create({
    swapRequestId,
    reporterId: viewer.id,
    againstId,
    reason: payload.reason,
    details: payload.details || null,
    status: 'OPEN',
  }).then((r) => r.toObject());
}

export async function listSwapRequests(direction, viewer) {
  // §10 GET /swap-requests?direction=incoming|outgoing — filtered by role.
  // incoming = requests on MY items; outgoing = MY requests. Never unbounded.
  //
  // Both directions are PARTICIPANT-based (contact reveal prerequisite): the
  // participants snapshot is the only ownership truth that survives an
  // accept — the item's ownerId flips to the requester, so an ownerId-keyed
  // incoming list would make the accepted row VANISH for the very user who
  // must now see the counterparty contact. Pre-accept behavior is identical
  // (a requester is never the item owner — creation forbids it).
  const isOutgoing = direction === 'outgoing';
  const filter = isOutgoing
    ? { requesterId: viewer.id }
    : {
        // sanitizeFilter-safe: $and/$nor over scalar equality (object-form
        // operators are defanged — see the module header note).
        $and: [{ participants: viewer.id }, { $nor: [{ requesterId: viewer.id }] }],
      };
  const page = 1;
  const pageSize = 50;

  const [requests, total] = await Promise.all([
    SwapRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(0)
      .limit(pageSize)
      // Session 14 — the dashboard rows are SELF-EXPLANATORY cards, so the
      // payload carries everything the row needs in ONE request:
      // requester → who is asking (incoming) / who I asked (outgoing);
      // item + offeredItem → title, status, points AND the display trio
      // (first image, size, condition) the card thumbnails/specs render.
      .populate('requesterId', 'name avatarUrl')
      .populate('itemId', 'title status pointValue size condition images.url')
      .populate('offeredItemId', 'title status pointValue size condition images.url')
      .lean(),
    SwapRequest.countDocuments(filter),
  ]);

  await attachContacts(requests, viewer.id);

  return { requests, total, page, pageSize };
}

export async function getSwapRequest(id, viewer) {
  // §10: requester, item owner, or admin.
  const swapRequest = await SwapRequest.findById(id).lean();
  if (!swapRequest) throw notFound();

  const item = await Item.findById(swapRequest.itemId).select('ownerId').lean();
  const isRequester = String(swapRequest.requesterId) === String(viewer.id);
  const isOwner = item && String(item.ownerId) === String(viewer.id);

  if (!isRequester && !isOwner && viewer.role !== 'ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'You do not have access to this swap request.');
  }

  // Contact reveal on the detail read mirrors the list EXACTLY (one rule
  // everywhere): accepted-only, counterparty via the participants snapshot,
  // requester's phone = the number volunteered ON THE REQUEST (null if they
  // gave none — email still reveals), owner's phone = their signup phone.
  if (swapRequest.status === 'ACCEPTED') {
    const counterpartyId = isRequester ? swapRequest.participants[0] : swapRequest.participants[1];
    const user = await User.findById(counterpartyId).select('name email phone').lean();
    if (user) {
      swapRequest.contact = {
        name: user.name,
        email: user.email,
        phone: isRequester ? (swapRequest.requesterPhone ?? null) : (user.phone ?? null),
      };
    }
  }

  return swapRequest;
}
