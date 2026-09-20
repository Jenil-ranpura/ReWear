/**
 * Admin user-detail (investigation view) integration tests.
 * The evidence kit an admin needs BEFORE acting on a report: profile +
 * contact, every item (with moderation audit fields), every swap they
 * participated in, the append-only points ledger, reports filed BY and
 * AGAINST them, and every admin action taken ON them. Guards: admin-only,
 * 404 on unknown ids, invalid ids → 400 (CastError mapping).
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../../../src/app.js';
import { startTestDb, stopTestDb } from '../../../tests/helpers/testDb.js';
import {
  AdminAction,
  Item,
  PointsTransaction,
  Report,
  SwapRequest,
  User,
} from '../../../src/models/index.js';
import { signAccessToken } from '../../../src/modules/auth/tokens.js';

async function createUser(name, overrides = {}) {
  return User.create({
    name,
    email: `${name.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.dev`,
    passwordHash: await bcrypt.hash('Password123!', 4),
    pointsBalance: 0,
    ...overrides,
  });
}

let admin;
let adminToken;
let subject; // the user under investigation
let otherUser;

beforeAll(async () => {
  await startTestDb();
  admin = await createUser('Admin', { role: 'ADMIN', phone: '+919876543210' });
  adminToken = signAccessToken(admin);
  subject = await createUser('Suspect', {
    email: 'suspect@rewear.test',
    pointsBalance: 80,
  });
  otherUser = await createUser('Counterparty');
});

afterAll(async () => {
  await stopTestDb();
});

async function seedEvidence() {
  // Two items: one approved+swapped history, one pending (plus one owned by
  // someone else that must NOT appear).
  const itemA = await Item.create({
    ownerId: subject._id,
    title: 'Floral Summer Dress',
    description: 'A tested evidence item with enough description text.',
    category: 'DRESSES',
    type: 'DRESS',
    size: 'S',
    condition: 'LIKE_NEW',
    pointValue: 40,
    status: 'APPROVED',
    images: [{ url: 'https://example.com/a.jpg', isPrimary: true }],
  });
  const itemB = await Item.create({
    ownerId: subject._id,
    title: 'Pending Sneakers',
    description: 'A tested evidence item with enough description text.',
    category: 'FOOTWEAR',
    type: 'SNEAKERS',
    size: 'UK 8',
    condition: 'GOOD',
    pointValue: 25,
    status: 'PENDING',
    images: [{ url: 'https://example.com/b.jpg', isPrimary: true }],
  });
  await Item.create({
    ownerId: otherUser._id,
    title: 'Someone else’s item — must NOT appear',
    description: 'A tested evidence item with enough description text.',
    category: 'TOPS',
    type: 'T_SHIRT',
    size: 'M',
    condition: 'GOOD',
    pointValue: 10,
    status: 'APPROVED',
    images: [{ url: 'https://example.com/c.jpg', isPrimary: true }],
  });

  // A completed POINTS_REDEMPTION swap where otherUser redeemed subject's item.
  const swap = await SwapRequest.create({
    itemId: itemA._id,
    requesterId: otherUser._id,
    participants: [subject._id, otherUser._id],
    type: 'POINTS_REDEMPTION',
    status: 'ACCEPTED',
  });
  await Item.updateOne({ _id: itemA._id }, { $set: { ownerId: otherUser._id, status: 'SWAPPED' } });

  // Ledger: subject earned 40 for the swap, spent… nothing else, plus a seed bonus.
  await PointsTransaction.create({
    userId: subject._id,
    amount: 100,
    type: 'ADJUSTED',
  });
  await PointsTransaction.create({
    userId: subject._id,
    amount: 40,
    type: 'EARNED',
    relatedSwapRequestId: swap._id,
  });

  // A report AGAINST subject (filed by otherUser).
  await Report.create({
    swapRequestId: swap._id,
    reporterId: otherUser._id,
    againstId: subject._id,
    reason: 'FAKE_ITEM',
    details: 'The item never arrived.',
    status: 'OPEN',
  });

  // An admin action ON subject (a past ban, since lifted).
  await AdminAction.create({
    adminId: admin._id,
    targetType: 'User',
    targetId: subject._id,
    action: 'UNBAN',
    reason: 'Appeal accepted',
  });

  return { itemA, itemB, swap };
}

describe('GET /admin/users/:id (investigation view)', () => {
  it('is admin-only: 401 for guests, 403 for regular users', async () => {
    const guest = await request(app).get('/api/v1/admin/users/000000000000000000000000');
    expect(guest.status).toBe(401);

    const userToken = signAccessToken(subject);
    const plebe = await request(app)
      .get('/api/v1/admin/users/000000000000000000000000')
      .set('Authorization', `Bearer ${userToken}`);
    expect(plebe.status).toBe(403);
    expect(plebe.body.error.code).toBe('FORBIDDEN');
  });

  it('404 for an unknown user, 400 for a malformed id', async () => {
    const missing = await request(app)
      .get('/api/v1/admin/users/000000000000000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const malformed = await request(app)
      .get('/api/v1/admin/users/not-an-objectid')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION');
  });

  it('returns the full evidence bundle for one user', async () => {
    const { swap } = await seedEvidence();

    const res = await request(app)
      .get(`/api/v1/admin/users/${subject._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Profile: safe (no hashes) + contact + role + points.
    expect(res.body.user.email).toBe('suspect@rewear.test');
    expect(res.body.user.pointsBalance).toBe(80);
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.refreshTokenHash).toBeUndefined();

    // Behavioral counters reflect items they CURRENTLY own (itemA transferred
    // to the redeemer on accept — that transfer is itself the evidence, and
    // shows up in the swap row below).
    expect(res.body.counts.total).toBe(1);
    expect(res.body.counts.PENDING).toBe(1);

    // Items: only their own, newest first, with moderation-relevant fields.
    const titles = res.body.items.map((i) => i.title);
    expect(titles).toEqual(['Pending Sneakers']);
    expect(titles).not.toContain('Someone else’s item — must NOT appear');

    // Swaps: participant-keyed (they were the ORIGINAL owner) with parties populated.
    expect(res.body.swaps.items).toHaveLength(1);
    const swapRow = res.body.swaps.items[0];
    expect(String(swapRow._id)).toBe(String(swap._id));
    expect(swapRow.requesterId.email).toBe(otherUser.email);
    expect(swapRow.itemId.title).toBe('Floral Summer Dress');
    expect(swapRow.itemId.ownerId).toBe(otherUser._id.toString()); // ownership flipped on accept

    // Ledger: newest first, swap-linked rows populated.
    expect(res.body.ledger.map((t) => t.type)).toEqual(['EARNED', 'ADJUSTED']);
    expect(res.body.ledger[0].amount).toBe(40);
    expect(String(res.body.ledger[0].relatedSwapRequestId._id)).toBe(String(swap._id));

    // Reports against them (with reporter identity), none filed by them.
    expect(res.body.reportsAgainst).toHaveLength(1);
    expect(res.body.reportsAgainst[0].reason).toBe('FAKE_ITEM');
    expect(res.body.reportsAgainst[0].reporterId.email).toBe(otherUser.email);
    expect(res.body.reportsFiled).toHaveLength(0);

    // Audit trail of admin actions ON this user.
    expect(res.body.adminActions).toHaveLength(1);
    expect(res.body.adminActions[0].action).toBe('UNBAN');
    expect(res.body.adminActions[0].reason).toBe('Appeal accepted');
    expect(res.body.adminActions[0].adminId.email).toBe(admin.email);
  });

  it('paginates the high-volume lists (items/swaps/ledger)', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/users/${subject._id}?page=1&pageSize=1`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.swaps.items).toHaveLength(1);
    expect(res.body.ledger).toHaveLength(1);
  });
});
