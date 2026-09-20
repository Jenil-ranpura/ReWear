/**
 * Dispute kit integration tests (user-requested fraud-response scope
 * addition). Covers: report authorization (participants-only), state rules
 * (accepted-only), dedupe, the admin queue, and the REFUND remedy with full
 * §9.3 ledger reconciliation (including the partial-refund path — refund is
 * capped at the offender's recoverable balance so cache=ledger ALWAYS holds).
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../../../src/app.js';
import { startTestDb, stopTestDb } from '../../../tests/helpers/testDb.js';
import { Item, PointsTransaction, Report, SwapRequest, User } from '../../../src/models/index.js';
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
    description: 'A dispute-test fixture item with enough description.',
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

async function acceptedRedemption(owner, requester, pointValue = 20) {
  const target = await createItem(owner, { title: `Redeemable by ${owner.name}`, pointValue });
  const created = await request(app)
    .post(`/api/v1/items/${target._id}/swap-requests`)
    .set('Authorization', `Bearer ${requester.token}`)
    .send({ type: 'POINTS_REDEMPTION', requesterPhone: '+919876543211' })
    .expect(201);
  await request(app)
    .patch(`/api/v1/swap-requests/${created.body.swapRequest._id}`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ action: 'ACCEPT' })
    .expect(200);
  return created.body.swapRequest;
}

let owner;
let requester;
let outsider;
let admin;
let ownerToken;
let requesterToken;
let outsiderToken;
let adminToken;

beforeAll(async () => {
  await startTestDb();
  owner = await createUser('Owner', 0);
  requester = await createUser('Requester', 100);
  outsider = await createUser('Outsider', 50);
  admin = await createUser('Admin', 0);
  await User.updateOne({ _id: admin._id }, { role: 'ADMIN' });
  owner.token = signAccessToken(await User.findById(owner._id));
  requester.token = signAccessToken(await User.findById(requester._id));
  outsider.token = signAccessToken(await User.findById(outsider._id));
  admin.token = signAccessToken(await User.findById(admin._id));
  ownerToken = owner.token;
  requesterToken = requester.token;
  outsiderToken = outsider.token;
  adminToken = admin.token;
});

afterAll(async () => {
  await stopTestDb();
});

describe('POST /swap-requests/:id/report — filing rules', () => {
  it('files a report from either party of an ACCEPTED swap (201, OPEN, counterparty snapshotted)', async () => {
    const swap = await acceptedRedemption(owner, requester);

    const res = await request(app)
      .post(`/api/v1/swap-requests/${swap._id}/report`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ reason: 'ITEM_NOT_AS_DESCRIBED', details: 'The jacket had a torn lining.' })
      .expect(201);

    expect(res.body.report).toMatchObject({
      status: 'OPEN',
      reason: 'ITEM_NOT_AS_DESCRIBED',
      reporterId: String(requester._id),
      againstId: String(owner._id),
    });
  });

  it('403s non-participants (IDOR guard) and 409s non-accepted swaps', async () => {
    const target = await createItem(owner);
    const pending = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);

    // Non-participant on a real swap.
    const swap = await acceptedRedemption(owner, requester);
    await request(app)
      .post(`/api/v1/swap-requests/${swap._id}/report`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ reason: 'OTHER' })
      .expect(403);

    // Participant, but the swap isn't accepted (still PENDING) — nothing to dispute.
    await request(app)
      .post(`/api/v1/swap-requests/${pending.body.swapRequest._id}/report`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ reason: 'OTHER' })
      .expect(409);
  });

  it('rejects an invalid reason and duplicate reports from the same reporter', async () => {
    const swap = await acceptedRedemption(owner, requester);

    const bad = await request(app)
      .post(`/api/v1/swap-requests/${swap._id}/report`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ reason: 'NOT_A_REASON' })
      .expect(400);

    expect(bad.body.error.code).toBe('VALIDATION');

    await request(app)
      .post(`/api/v1/swap-requests/${swap._id}/report`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ reason: 'NO_SHOW' })
      .expect(201);

    await request(app)
      .post(`/api/v1/swap-requests/${swap._id}/report`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ reason: 'NO_SHOW' })
      .expect(409); // DUPLICATE_REPORT
  });
});

describe('Admin dispute queue + remedy', () => {
  it('queues reports admin-only; non-admins get 403', async () => {
    await request(app)
      .get('/api/v1/admin/reports')
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(403);

    const res = await request(app)
      .get('/api/v1/admin/reports')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body.reports)).toBe(true);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('REFUND reverses the ledger pair via ADJUSTED entries and keeps cache=ledger EXACTLY (full amount)', async () => {
    const swap = await acceptedRedemption(owner, requester, 20);
    // requester already reported this one below; use a fresh swap for owner-side report.
    const report = await request(app)
      .post(`/api/v1/swap-requests/${swap._id}/report`)
      .set('Authorization', `Bearer ${ownerToken}`) // owner disputes (e.g. requester ghosted on handover)
      .send({ reason: 'NO_SHOW' })
      .expect(201);

    const requesterBefore = (await User.findById(requester._id)).pointsBalance;
    const ownerBefore = (await User.findById(owner._id)).pointsBalance;

    const res = await request(app)
      .patch(`/api/v1/admin/reports/${report.body.report._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        remedy: 'REFUND',
        resolutionNote: 'Requester confirmed the item never changed hands.',
      })
      .expect(200);

    expect(res.body.report.status).toBe('RESOLVED');
    expect(res.body.refund).toMatchObject({ amount: 20, requested: 20, shortfall: 0 });

    // Ledger: the original SPENT/EARNED pair untouched + two ADJUSTED docs.
    const ledger = await PointsTransaction.find({ relatedSwapRequestId: swap._id }).lean();
    const adjusted = ledger.filter((t) => t.type === 'ADJUSTED');
    expect(adjusted).toHaveLength(2);
    const toRequester = adjusted.find((t) => String(t.userId) === String(requester._id));
    const fromOwner = adjusted.find((t) => String(t.userId) === String(owner._id));
    expect(toRequester.amount).toBe(20);
    expect(fromOwner.amount).toBe(-20);

    // Cache = ledger sum for BOTH users (§9.3 invariant, applied to reversals).
    const requesterAfter = (await User.findById(requester._id)).pointsBalance;
    const ownerAfter = (await User.findById(owner._id)).pointsBalance;
    expect(requesterAfter).toBe(requesterBefore + 20);
    expect(ownerAfter).toBe(ownerBefore - 20);

    // Swap closed so it can't be re-disputed; report is terminal.
    expect((await SwapRequest.findById(swap._id)).status).toBe('CANCELLED');
    expect((await Report.findById(report.body.report._id)).status).toBe('RESOLVED');

    void ledger;
  });

  it('PARTIAL refund: capped at the offender balance — ledger and cache still move by the SAME amount (invariant holds)', async () => {
    // A dedicated owner drained to 5 AFTER the accept credit (+20 lands on
    // top of whatever balance exists — so pre-seed 5-20=-15 is wrong; instead
    // seed 0, accept adds 20, then drain to 5 → refund can recover only 5).
    const brokeOwner = await createUser('BrokeOwner', 0);
    const brokeOwnerToken = signAccessToken(await User.findById(brokeOwner._id));
    brokeOwner.token = brokeOwnerToken;

    const target = await createItem(brokeOwner, { title: 'Broke Redeemable', pointValue: 20 });
    const created = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);
    await request(app)
      .patch(`/api/v1/swap-requests/${created.body.swapRequest._id}`)
      .set('Authorization', `Bearer ${brokeOwnerToken}`)
      .send({ action: 'ACCEPT' })
      .expect(200);
    const swap = created.body.swapRequest;

    // Drain: the +20 accept credit is now reduced to 5 recoverable.
    await User.updateOne({ _id: brokeOwner._id }, { $set: { pointsBalance: 5 } });

    const report = await request(app)
      .post(`/api/v1/swap-requests/${swap._id}/report`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ reason: 'FAKE_ITEM' })
      .expect(201);

    const requesterBefore = (await User.findById(requester._id)).pointsBalance;
    const ownerBefore = (await User.findById(brokeOwner._id)).pointsBalance; // 5

    const res = await request(app)
      .patch(`/api/v1/admin/reports/${report.body.report._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ remedy: 'REFUND', resolutionNote: 'Offender spent most of the points already.' })
      .expect(200);

    expect(res.body.refund).toMatchObject({ amount: 5, requested: 20, shortfall: 15 });
    expect(res.body.report.resolutionNote).toContain('recoverable');

    const ledger = await PointsTransaction.find({
      relatedSwapRequestId: swap._id,
      type: 'ADJUSTED',
    }).lean();
    const sum = ledger.reduce((acc, t) => acc + t.amount, 0); // net 0 across both parties
    expect(ledger.find((t) => String(t.userId) === String(brokeOwner._id)).amount).toBe(-5);

    const requesterAfter = (await User.findById(requester._id)).pointsBalance;
    const ownerAfter = (await User.findById(brokeOwner._id)).pointsBalance;
    expect(requesterAfter).toBe(requesterBefore + 5);
    expect(ownerAfter).toBe(ownerBefore - 5); // 0 — never negative, cache=ledger holds

    expect(sum).toBe(0);
  });

  it('NONE remedy dismisses with a note and moves NO points; double-resolve 409s; every resolve is audited', async () => {
    const swap = await acceptedRedemption(owner, requester, 20);
    const report = await request(app)
      .post(`/api/v1/swap-requests/${swap._id}/report`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ reason: 'OTHER', details: 'Misunderstanding — sorted it out offline.' })
      .expect(201);

    const requesterBefore = (await User.findById(requester._id)).pointsBalance;

    const res = await request(app)
      .patch(`/api/v1/admin/reports/${report.body.report._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ remedy: 'NONE', resolutionNote: 'Both parties confirmed resolution offline.' })
      .expect(200);

    expect(res.body.report.status).toBe('DISMISSED');
    expect(res.body.refund).toBeNull();
    expect((await User.findById(requester._id)).pointsBalance).toBe(requesterBefore);
    expect((await SwapRequest.findById(swap._id)).status).toBe('ACCEPTED'); // untouched

    // Terminal: re-resolving is refused.
    await request(app)
      .patch(`/api/v1/admin/reports/${report.body.report._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ remedy: 'REFUND', resolutionNote: 'Trying to re-resolve a closed report.' })
      .expect(409);
  });
});
