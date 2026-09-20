/**
 * P4-T4 — swap-request module integration tests, INCLUDING the concurrency
 * race test that implementation.md §27 demands be written alongside the
 * implementation. The accept flow must survive two owners... (well: one owner,
 * two competing accept paths) racing: exactly one 200, one clean 409, and no
 * half-applied state (§5.7/§14.3 core guarantee).
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../../../src/app.js';
import { startTestDb, stopTestDb } from '../../../tests/helpers/testDb.js';
import { Item, PointsTransaction, SwapRequest, User } from '../../../src/models/index.js';
import { signAccessToken } from '../../../src/modules/auth/tokens.js';

async function createUser(name, points = 0) {
  const created = await User.create({
    name,
    email: `${name.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.dev`,
    passwordHash: await bcrypt.hash('Password123!', 4),
    pointsBalance: points,
  });
  return User.findById(created._id);
}

async function createItem(owner, overrides = {}) {
  return Item.create({
    ownerId: owner._id,
    title: `Item by ${owner.name}`,
    description: 'A swap-test fixture item with enough description.',
    category: 'TOPS',
    type: 'T_SHIRT',
    size: 'M',
    condition: 'GOOD',
    pointValue: 20,
    status: 'APPROVED',
    images: [{ url: 'https://example.com/x.jpg', isPrimary: true }],
    ...overrides,
  });
}

let owner;
let requester;
let third;
let ownerToken;
let requesterToken;
let thirdToken;

beforeAll(async () => {
  await startTestDb();
  owner = await createUser('Owner');
  requester = await createUser('Requester', 100); // enough for a redemption
  third = await createUser('Third', 100);
  ownerToken = signAccessToken(owner);
  requesterToken = signAccessToken(requester);
  thirdToken = signAccessToken(third);
});

afterAll(async () => {
  await stopTestDb();
});

describe('GET /swap-requests?direction=… — dashboard payload (Session 14)', () => {
  it('returns self-explanatory rows: requester name + item display trio, no private fields', async () => {
    const target = await createItem(owner, { title: 'Listed Parka' });
    const offered = await createItem(requester, { title: 'Offered Kettle' });
    await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'DIRECT_SWAP', offeredItemId: String(offered._id) })
      .expect(201);

    // Owner's incoming view: the row must carry WHO is asking and WHAT both
    // sides look like (the §5.7 dashboard renders it without extra fetches).
    const incoming = await request(app)
      .get('/api/v1/swap-requests?direction=incoming')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const row = incoming.body.requests.find((r) => r.itemId?._id === String(target._id));
    expect(row).toBeDefined();
    expect(row.requesterId).toMatchObject({ _id: String(requester._id), name: 'Requester' });
    expect(row.itemId).toMatchObject({ title: 'Listed Parka' });
    expect(row.itemId.images).toBeDefined();
    expect(row.itemId.size).toBeDefined();
    expect(row.itemId.condition).toBeDefined();
    expect(row.offeredItemId).toMatchObject({ title: 'Offered Kettle' });
    // §15: only public profile fields on the embedded user — never credentials.
    expect(row.requesterId.passwordHash).toBeUndefined();
    expect(row.requesterId.email).toBeUndefined();
    expect(row.requesterId.pointsBalance).toBeUndefined();

    // Requester's outgoing view: the same enrichment, mirrored.
    const outgoing = await request(app)
      .get('/api/v1/swap-requests?direction=outgoing')
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);
    const mine = outgoing.body.requests.find((r) => r.itemId?._id === String(target._id));
    expect(mine.requesterId).toMatchObject({ _id: String(requester._id), name: 'Requester' });
    expect(mine.offeredItemId).toMatchObject({ title: 'Offered Kettle' });
  });
});

describe('POST /items/:id/swap-requests — creation rules (§14.2)', () => {
  let targetItem;

  beforeAll(async () => {
    targetItem = await createItem(owner);
  });

  it('creates a DIRECT_SWAP request with a valid offered item — 201 PENDING', async () => {
    const offered = await createItem(requester);
    const res = await request(app)
      .post(`/api/v1/items/${targetItem._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'DIRECT_SWAP', offeredItemId: String(offered._id) })
      .expect(201);

    expect(res.body.swapRequest.status).toBe('PENDING');
    expect(res.body.swapRequest.type).toBe('DIRECT_SWAP');
  });

  it('creates a POINTS_REDEMPTION request without offeredItemId — 201', async () => {
    const res = await request(app)
      .post(`/api/v1/items/${targetItem._id}/swap-requests`)
      .set('Authorization', `Bearer ${thirdToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);
    expect(res.body.swapRequest.type).toBe('POINTS_REDEMPTION');
  });

  it('rejects DIRECT_SWAP without offeredItemId (400, field error from shared schema)', async () => {
    const res = await request(app)
      .post(`/api/v1/items/${targetItem._id}/swap-requests`)
      .set('Authorization', `Bearer ${thirdToken}`)
      .send({ type: 'DIRECT_SWAP' })
      .expect(400);
    expect(res.body.error.message).toMatch(/offered item/i);
  });

  it('blocks swapping your OWN item (400)', async () => {
    const res = await request(app)
      .post(`/api/v1/items/${targetItem._id}/swap-requests`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_SWAP');
  });

  it('blocks offering an item you do NOT own (403)', async () => {
    const notMine = await createItem(third);
    const res = await request(app)
      .post(`/api/v1/items/${targetItem._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'DIRECT_SWAP', offeredItemId: String(notMine._id) })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks requests on non-APPROVED items (409) and duplicate PENDING requests (409)', async () => {
    const pendingItem = await createItem(owner, { status: 'PENDING' });
    await request(app)
      .post(`/api/v1/items/${pendingItem._id}/swap-requests`)
      .set('Authorization', `Bearer ${thirdToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(409);

    // third already has a PENDING request on targetItem (from earlier test)
    const res = await request(app)
      .post(`/api/v1/items/${targetItem._id}/swap-requests`)
      .set('Authorization', `Bearer ${thirdToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(409);
    expect(res.body.error.code).toBe('DUPLICATE_REQUEST');
  });

  it('blocks points redemption when balance is too low (409 INSUFFICIENT_POINTS)', async () => {
    const poor = await createUser('Poor', 5);
    const poorToken = signAccessToken(await User.findById(poor._id));
    const res = await request(app)
      .post(`/api/v1/items/${targetItem._id}/swap-requests`)
      .set('Authorization', `Bearer ${poorToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_POINTS');
  });
});

describe('PATCH /swap-requests/:id — transactional accept (§5.7 + P4-T5)', () => {
  it('DIRECT_SWAP accept: swaps owners on both items, both → SWAPPED (atomic)', async () => {
    const target = await createItem(owner, { title: 'Target A' });
    const offered = await createItem(requester, { title: 'Offered B' });
    const created = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'DIRECT_SWAP', offeredItemId: String(offered._id) })
      .expect(201);

    await request(app)
      .patch(`/api/v1/swap-requests/${created.body.swapRequest._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'ACCEPT' })
      .expect(200);

    const afterTarget = await Item.findById(target._id).lean();
    const afterOffered = await Item.findById(offered._id).lean();
    expect(String(afterTarget.ownerId)).toBe(String(requester._id)); // ownership flipped
    expect(String(afterOffered.ownerId)).toBe(String(owner._id));
    expect(afterTarget.status).toBe('SWAPPED');
    expect(afterOffered.status).toBe('SWAPPED');
  });

  it('POINTS_REDEMPTION accept: item transfers + ledger docs + cache updates, all consistent (§9.3)', async () => {
    const target = await createItem(owner, { title: 'Redeemable', pointValue: 30 });
    const balanceBefore = (await User.findById(requester._id)).pointsBalance; // 100
    const ownerBefore = (await User.findById(owner._id)).pointsBalance;

    const created = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/swap-requests/${created.body.swapRequest._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'ACCEPT' })
      .expect(200);

    const afterItem = await Item.findById(target._id).lean();
    expect(String(afterItem.ownerId)).toBe(String(requester._id));
    expect(afterItem.status).toBe('SWAPPED');

    // Ledger (source of truth) got exactly the two append-only docs.
    const ledger = await PointsTransaction.find({
      relatedSwapRequestId: created.body.swapRequest._id,
    }).lean();
    expect(ledger).toHaveLength(2);
    const spent = ledger.find((t) => String(t.userId) === String(requester._id));
    const earned = ledger.find((t) => String(t.userId) === String(owner._id));
    expect(spent.amount).toBe(-30);
    expect(spent.type).toBe('SPENT');
    expect(earned.amount).toBe(30);
    expect(earned.type).toBe('EARNED');

    // Cache (§9.3) matches the ledger on BOTH users.
    const requesterAfter = await User.findById(requester._id).lean();
    const ownerAfter = await User.findById(owner._id).lean();
    expect(requesterAfter.pointsBalance).toBe(balanceBefore - 30);
    expect(ownerAfter.pointsBalance).toBe(ownerBefore + 30);
  });

  it('auto-rejects other PENDING requests on the swapped item', async () => {
    const target = await createItem(owner, { title: 'Contested' });
    const r1 = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);
    const r2 = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${thirdToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/swap-requests/${r1.body.swapRequest._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'ACCEPT' })
      .expect(200);

    const loser = await SwapRequest.findById(r2.body.swapRequest._id).lean();
    expect(loser.status).toBe('REJECTED');
  });

  it('reject/cancel change status only — no ownership or ledger side effects', async () => {
    const target = await createItem(owner, { title: 'Rejectable' });
    const r = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/swap-requests/${r.body.swapRequest._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'REJECT' })
      .expect(200);

    const after = await SwapRequest.findById(r.body.swapRequest._id).lean();
    expect(after.status).toBe('REJECTED');
    const itemAfter = await Item.findById(target._id).lean();
    expect(itemAfter.status).toBe('APPROVED'); // untouched
    expect(String(itemAfter.ownerId)).toBe(String(owner._id));

    // cancel path (requester's own request on a fresh item)
    const target2 = await createItem(owner, { title: 'Cancellable' });
    const c = await request(app)
      .post(`/api/v1/items/${target2._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);
    await request(app)
      .patch(`/api/v1/swap-requests/${c.body.swapRequest._id}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ action: 'CANCEL' })
      .expect(200);
    const cancelled = await SwapRequest.findById(c.body.swapRequest._id).lean();
    expect(cancelled.status).toBe('CANCELLED');
    // P8-T1 edge: the CANCEL path scrubs the volunteered number too (the
    // REJECT-path scrub has its own test in the contact-reveal describe —
    // one consent rule, both terminal actions).
    expect(cancelled.requesterPhone).toBeNull();
  });

  it('blocks swap requests on a REJECTED item (409) — §17 edge-case row, REJECTED literal', async () => {
    const rejectedItem = await createItem(owner, { title: 'Rejected listing', status: 'REJECTED' });
    const res = await request(app)
      .post(`/api/v1/items/${rejectedItem._id}/swap-requests`)
      .set('Authorization', `Bearer ${thirdToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(409);
    expect(res.body.error.code).toBe('ITEM_NOT_AVAILABLE');
  });

  it('403s accept by non-owner and double-accept returns 409 INVALID_STATE', async () => {
    const target = await createItem(owner, { title: 'Guarded' });
    const r = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/swap-requests/${r.body.swapRequest._id}`)
      .set('Authorization', `Bearer ${thirdToken}`)
      .send({ action: 'ACCEPT' })
      .expect(403);

    // owner accepts, then tries again
    await request(app)
      .patch(`/api/v1/swap-requests/${r.body.swapRequest._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'ACCEPT' })
      .expect(200);
    const second = await request(app)
      .patch(`/api/v1/swap-requests/${r.body.swapRequest._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'ACCEPT' })
      .expect(409);
    expect(second.body.error.code).toBe('INVALID_STATE');
  });
});

describe('CONCURRENCY: two competing accepts on one item (§5.7 core guarantee)', () => {
  it('exactly one accept wins; the loser gets 409 CONFLICT; state stays consistent', async () => {
    const target = await createItem(owner, { title: 'Race item', pointValue: 10 });
    const r1 = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);
    const r2 = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${thirdToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);

    const balanceBefore = (await User.findById(owner._id)).pointsBalance;

    // Fire BOTH accepts simultaneously.
    const [res1, res2] = await Promise.allSettled([
      request(app)
        .patch(`/api/v1/swap-requests/${r1.body.swapRequest._id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ action: 'ACCEPT' }),
      request(app)
        .patch(`/api/v1/swap-requests/${r2.body.swapRequest._id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ action: 'ACCEPT' }),
    ]);

    const codes = res1.value.status + '/' + res2.value.status;
    const winners = [res1, res2].filter((r) => r.value.status === 200);
    const losers = [res1, res2].filter((r) => r.value.status === 409);

    expect(winners).toHaveLength(1); // exactly one winner
    expect(losers).toHaveLength(1); // exactly one clean 409
    expect(losers[0].value.body.error.code).toBe('CONFLICT');

    // State is consistent: item SWAPPED exactly once, exactly one ledger pair.
    const item = await Item.findById(target._id).lean();
    expect(item.status).toBe('SWAPPED');
    const acceptedId = winners[0].value.body.swapRequest._id;
    const ledger = await PointsTransaction.find({ relatedSwapRequestId: acceptedId }).lean();
    expect(ledger).toHaveLength(2); // one SPENT + one EARNED, never duplicated

    // Owner gained exactly pointValue once (10).
    const ownerAfter = await User.findById(owner._id).lean();
    expect(ownerAfter.pointsBalance).toBe(balanceBefore + 10);

    // Losing request auto-rejected by the winner's transaction.
    // (The 409 body is the §10 error envelope — the loser is identified as
    // whichever request is NOT the winner's.)
    const winnerId = String(winners[0].value.body.swapRequest._id);
    const loserId =
      winnerId === String(r1.body.swapRequest._id)
        ? r2.body.swapRequest._id
        : r1.body.swapRequest._id;
    const loserDoc = await SwapRequest.findById(loserId).lean();
    expect(loserDoc.status).toBe('REJECTED');

    void codes; // informational only
  }, 20000);
});

describe('Contact reveal (user-requested scope addition)', () => {
  // Dedicated users: earlier describes spend `requester`'s balance (including
  // the RACE-dependent concurrency test), so reusing it here would make these
  // tests flaky on whoever wins that race. Isolation over arithmetic.
  let cOwner;
  let cRequester;
  let cOwnerToken;
  let cRequesterToken;

  beforeAll(async () => {
    cOwner = await createUser('ContactOwner', 0);
    cRequester = await createUser('ContactRequester', 100);
    cOwnerToken = signAccessToken(await User.findById(cOwner._id));
    cRequesterToken = signAccessToken(await User.findById(cRequester._id));
  });

  it('volunteers requesterPhone at creation (E.164-normalized, participants snapshotted); junk like 1234567890 can never enter (400)', async () => {
    const target = await createItem(cOwner, { title: 'Contact Target' });
    const offered = await createItem(cRequester, { title: 'Contact Offer' });

    const bad = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${cRequesterToken}`)
      .send({
        type: 'DIRECT_SWAP',
        offeredItemId: String(offered._id),
        requesterPhone: '1234567890',
      })
      .expect(400);
    expect(bad.body.error.message).toMatch(/country code/i);

    const good = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${cRequesterToken}`)
      .send({
        type: 'DIRECT_SWAP',
        offeredItemId: String(offered._id),
        requesterPhone: '+91 98765 43211',
      })
      .expect(201);
    expect(good.body.swapRequest.requesterPhone).toBe('+919876543211');
    expect(good.body.swapRequest.participants.map(String).sort()).toEqual(
      [String(cOwner._id), String(cRequester._id)].sort()
    );
  });

  it('PENDING reveals nothing; ACCEPT reveals the owner contact to the requester and the volunteered number to the owner — whose incoming row SURVIVES the ownership transfer', async () => {
    const target = await createItem(cOwner, { title: 'Reveal Target' });
    const created = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${cRequesterToken}`)
      .send({ type: 'POINTS_REDEMPTION', requesterPhone: '+919876543211' })
      .expect(201);
    const id = created.body.swapRequest._id;

    // PENDING: no contact field exists for either party (§15).
    const pendingOut = await request(app)
      .get('/api/v1/swap-requests?direction=outgoing')
      .set('Authorization', `Bearer ${cRequesterToken}`)
      .expect(200);
    expect(pendingOut.body.requests.find((r) => r._id === id)?.contact).toBeUndefined();
    const pendingIn = await request(app)
      .get('/api/v1/swap-requests?direction=incoming')
      .set('Authorization', `Bearer ${cOwnerToken}`)
      .expect(200);
    expect(pendingIn.body.requests.find((r) => r._id === id)?.contact).toBeUndefined();

    // The owner volunteered a phone at signup; accept transfers the item.
    await User.updateOne({ _id: cOwner._id }, { $set: { phone: '+14155552671' } });
    await request(app)
      .patch(`/api/v1/swap-requests/${id}`)
      .set('Authorization', `Bearer ${cOwnerToken}`)
      .send({ action: 'ACCEPT' })
      .expect(200);

    // Requester's outgoing row: owner contact — email + SIGNUP phone.
    const out = await request(app)
      .get('/api/v1/swap-requests?direction=outgoing')
      .set('Authorization', `Bearer ${cRequesterToken}`)
      .expect(200);
    const mine = out.body.requests.find((r) => r._id === id);
    expect(mine.contact).toMatchObject({
      name: 'ContactOwner',
      email: cOwner.email,
      phone: '+14155552671',
    });

    // Owner's incoming row STILL EXISTS after the transfer (participants
    // snapshot — an ownerId-keyed list would have silently dropped it) and
    // carries the number volunteered ON THE REQUEST.
    const inc = await request(app)
      .get('/api/v1/swap-requests?direction=incoming')
      .set('Authorization', `Bearer ${cOwnerToken}`)
      .expect(200);
    const theirs = inc.body.requests.find((r) => r._id === id);
    expect(theirs).toBeDefined();
    expect(theirs.contact).toMatchObject({
      name: 'ContactRequester',
      email: cRequester.email,
      phone: '+919876543211',
    });

    // An unrelated user's list contains neither the row nor any contact.
    const thirdOut = await request(app)
      .get('/api/v1/swap-requests?direction=outgoing')
      .set('Authorization', `Bearer ${thirdToken}`)
      .expect(200);
    expect(thirdOut.body.requests.find((r) => r._id === id)).toBeUndefined();
  });

  it('ACCEPTED is terminal: cancel/reject after accept → 409, and the contact stays visible to BOTH parties afterwards', async () => {
    const target = await createItem(cOwner, { title: 'Terminal Target' });
    const created = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${cRequesterToken}`)
      .send({ type: 'POINTS_REDEMPTION', requesterPhone: '+919876543213' })
      .expect(201);
    const id = created.body.swapRequest._id;

    await User.updateOne({ _id: cOwner._id }, { $set: { phone: '+14155552672' } });
    await request(app)
      .patch(`/api/v1/swap-requests/${id}`)
      .set('Authorization', `Bearer ${cOwnerToken}`)
      .send({ action: 'ACCEPT' })
      .expect(200);

    // Nobody can un-accept — every un-accept path is blocked (user-pinned
    // guarantee: the accepted transfer is irreversible, so the revealed
    // contact cannot be "taken back" by a later state change). The codes
    // differ by role, both by design of resolveSwapRequest:
    //  - requester CANCEL → passes the requester-role check, then hits the
    //    terminal-state guard → 409 INVALID_STATE.
    //  - original owner REJECT → post-transfer they are NO LONGER the item's
    //    owner of record (accept moved ownership to the requester), so the
    //    role check itself refuses → 403 FORBIDDEN.
    //  - requester REJECT → ironically now passes the owner-role check
    //    (they DO own the item post-transfer) but the terminal-state guard
    //    still refuses → 409. Status can never leave ACCEPTED.
    await request(app)
      .patch(`/api/v1/swap-requests/${id}`)
      .set('Authorization', `Bearer ${cRequesterToken}`)
      .send({ action: 'CANCEL' })
      .expect(409);
    await request(app)
      .patch(`/api/v1/swap-requests/${id}`)
      .set('Authorization', `Bearer ${cOwnerToken}`)
      .send({ action: 'REJECT' })
      .expect(403);
    await request(app)
      .patch(`/api/v1/swap-requests/${id}`)
      .set('Authorization', `Bearer ${cRequesterToken}`)
      .send({ action: 'REJECT' })
      .expect(409);

    // Contact intact on both sides after the failed un-accept attempts.
    const out = await request(app)
      .get('/api/v1/swap-requests?direction=outgoing')
      .set('Authorization', `Bearer ${cRequesterToken}`)
      .expect(200);
    expect(out.body.requests.find((r) => r._id === id).contact).toMatchObject({
      email: cOwner.email,
      phone: '+14155552672',
    });

    const inc = await request(app)
      .get('/api/v1/swap-requests?direction=incoming')
      .set('Authorization', `Bearer ${cOwnerToken}`)
      .expect(200);
    expect(inc.body.requests.find((r) => r._id === id).contact).toMatchObject({
      email: cRequester.email,
      phone: '+919876543213',
    });

    // And the document itself was never scrubbed (status still ACCEPTED).
    const doc = await SwapRequest.findById(id).lean();
    expect(doc.status).toBe('ACCEPTED');
    expect(doc.requesterPhone).toBe('+919876543213');
  });

  it('REJECT scrubs the volunteered number from the document (dead consent must not persist)', async () => {
    const target = await createItem(cOwner, { title: 'Scrub Target' });
    const created = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${cRequesterToken}`)
      .send({ type: 'POINTS_REDEMPTION', requesterPhone: '+919876543212' })
      .expect(201);
    const id = created.body.swapRequest._id;

    await request(app)
      .patch(`/api/v1/swap-requests/${id}`)
      .set('Authorization', `Bearer ${cOwnerToken}`)
      .send({ action: 'REJECT' })
      .expect(200);

    const doc = await SwapRequest.findById(id).lean();
    expect(doc.status).toBe('REJECTED');
    expect(doc.requesterPhone).toBeNull();
  });
});
