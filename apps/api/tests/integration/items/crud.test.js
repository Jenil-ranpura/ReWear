/**
 * P4-T1 — Items CRUD integration tests (§10/§14.1, on mongodb-memory-server).
 * Covers: create (auth required, auto-PENDING, ≥1 image, status strip,
 * unknown-field strip, duplicate-image flag), update (owner-only, state
 * guards, active-swap guard), soft delete (REMOVED, idempotent, guards).
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../../../src/app.js';
import { startTestDb, stopTestDb } from '../../../tests/helpers/testDb.js';
import { Item, SwapRequest, User } from '../../../src/models/index.js';
import { signAccessToken } from '../../../src/modules/auth/tokens.js';

let owner;
let otherUser;
let ownerToken;
let otherToken;

const validPayload = {
  title: 'Chunky knit sweater',
  description: 'Barely worn, super warm, from a smoke-free home.',
  category: 'TOPS',
  type: 'SWEATER',
  size: 'M',
  condition: 'LIKE_NEW',
  tags: ['knit', 'winter'],
  // Session 13: pointValue is DERIVED server-side (25 = TOPS × LIKE_NEW);
  // the value sent here is ignored — kept to prove the smuggle guard below.
  pointValue: 999,
  images: [{ url: 'https://example.com/sweater.jpg', isPrimary: true }],
};

async function createUser(name, role = 'USER') {
  const created = await User.create({
    name,
    email: `${name.toLowerCase()}-${Date.now()}@test.dev`,
    passwordHash: await bcrypt.hash('Password123!', 4),
    role,
  });
  return User.findById(created._id);
}

async function createItem(overrides = {}) {
  return Item.create({
    ownerId: owner._id,
    title: 'Existing item',
    description: 'An existing item used as a fixture in these tests.',
    category: 'TOPS',
    type: 'T_SHIRT',
    size: 'M',
    condition: 'GOOD',
    pointValue: 10,
    status: 'APPROVED',
    images: [{ url: 'https://example.com/existing.jpg', isPrimary: true }],
    ...overrides,
  });
}

beforeAll(async () => {
  await startTestDb();
  owner = await createUser('Owner');
  otherUser = await createUser('Other');
  ownerToken = signAccessToken(owner);
  otherToken = signAccessToken(otherUser);
});

afterAll(async () => {
  await stopTestDb();
});

describe('POST /items — create (P4-T1)', () => {
  it('creates an item as PENDING with the authenticated owner, 201', async () => {
    const res = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validPayload)
      .expect(201);

    expect(res.body.item.status).toBe('PENDING'); // §14.1: — → PENDING, always
    expect(res.body.item.ownerId).toBe(String(owner._id));
    expect(res.body.item.title).toBe('Chunky knit sweater');
    // §14.4 revised (Session 13): points are FORMULA-derived — the payload's
    // 999 is ignored, TOPS × LIKE_NEW = 25 × 1.2 → 30 is what persists.
    expect(res.body.item.pointValue).toBe(30);
    expect(res.body.duplicateImageFlagged).toBe(false);
  });

  it('derives pointValue from category × condition and IGNORES a smuggled 3000 (§14.4 revised)', async () => {
    const res = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validPayload, category: 'OTHER', condition: 'NEW', pointValue: 3000 })
      .expect(201);
    // The economy cannot be skewed: 20 × 1.5 = 30, not the submitted 3000.
    expect(res.body.item.pointValue).toBe(30);

    // Round-trip check: the DERIVED value is what actually persisted.
    const stored = await Item.findById(res.body.item._id).lean();
    expect(stored.pointValue).toBe(30);
  });

  it('requires authentication (guests get 401)', async () => {
    await request(app).post('/api/v1/items').send(validPayload).expect(401);
  });

  it('rejects zero images and strips client-submitted status', async () => {
    const res = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validPayload, images: [] })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION');

    // status: APPROVED in the payload must be IGNORED, not honored (§14.1).
    const smuggled = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validPayload, status: 'APPROVED', ownerId: String(otherUser._id) })
      .expect(201);
    expect(smuggled.body.item.status).toBe('PENDING');
    expect(smuggled.body.item.ownerId).toBe(String(owner._id)); // never the submitted one
    // §14.5/§10: moderationReason is server-set ONLY (admin REJECT also writes
    // it) — a client submission must never be able to smuggle one in.
    expect(smuggled.body.item.moderationReason).toBeNull();
  });

  it('flags duplicate images without blocking creation (§14.1 flag-only)', async () => {
    const first = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validPayload)
      .expect(201);
    expect(first.body.duplicateImageFlagged).toBe(false);

    // Same URL as the first submission. (Perceptual hashes arrive in P4-T2;
    // the flag currently keys on submitted URLs via the hash array.)
    const second = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validPayload)
      .expect(201);
    // NOTE: without a stored hash the flag cannot match yet — P4-T2 wires it.
    // This test pins the CONTRACT: 201 + boolean flag, never a block.
    expect(typeof second.body.duplicateImageFlagged).toBe('boolean');
  });
});

describe('PATCH /items/:id — update (P4-T1)', () => {
  it('lets the owner update editable fields and never status', async () => {
    const item = await createItem();
    const res = await request(app)
      .patch(`/api/v1/items/${item._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Renamed sweater',
        description: 'Updated description, still lovely.',
        status: 'REJECTED',
      })
      .expect(200);

    expect(res.body.item.title).toBe('Renamed sweater');
    expect(res.body.item.status).toBe('APPROVED'); // unchanged — not updatable here
  });

  it('403s non-owners (IDOR guard in the service, not just middleware)', async () => {
    const item = await createItem();
    const res = await request(app)
      .patch(`/api/v1/items/${item._id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Hijacked title' })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('recomputes pointValue when category/condition change and ignores a smuggled one (Session 13)', async () => {
    const item = await createItem({ category: 'TOPS', condition: 'GOOD', pointValue: 10 });
    // Only condition changes: TOPS/GOOD (10) → TOPS/NEW (25 × 1.5 = 38). A
    // client-sent pointValue: 1 in the same PATCH is overwritten, not honored.
    const res = await request(app)
      .patch(`/api/v1/items/${item._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ condition: 'NEW', pointValue: 1 })
      .expect(200);
    expect(res.body.item.pointValue).toBe(38);

    // A patch WITHOUT category/condition leaves the stored value untouched
    // (no recompute from a stale/absent category) — and still ignores a
    // smuggled pointValue.
    const untouched = await request(app)
      .patch(`/api/v1/items/${item._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Renamed only', pointValue: 555 })
      .expect(200);
    expect(untouched.body.item.pointValue).toBe(38);
  });

  it('409s when the item is in a non-editable state (SWAPPED)', async () => {
    const item = await createItem({ status: 'SWAPPED' });
    const res = await request(app)
      .patch(`/api/v1/items/${item._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Too late' })
      .expect(409);
    expect(res.body.error.code).toBe('ITEM_LOCKED');
  });

  it('409s when an active swap request exists (PENDING swap locks the item)', async () => {
    const item = await createItem();
    await SwapRequest.create({
      itemId: item._id,
      requesterId: otherUser._id,
      type: 'POINTS_REDEMPTION',
      status: 'PENDING',
    });

    const res = await request(app)
      .patch(`/api/v1/items/${item._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Should not apply' })
      .expect(409);
    expect(res.body.error.code).toBe('ITEM_LOCKED');
  });

  it('404s unknown ids with the §10 shape', async () => {
    const res = await request(app)
      .patch('/api/v1/items/000000000000000000000000')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Ghost item' })
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /items/:id — soft delete (P4-T1)', () => {
  it('soft-deletes to REMOVED (doc still exists) and is idempotent', async () => {
    const item = await createItem();

    await request(app)
      .delete(`/api/v1/items/${item._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    const after = await Item.findById(item._id);
    expect(after.status).toBe('REMOVED'); // soft delete — doc retained
    expect(after.deletedAt).toBeUndefined();

    // Second delete: idempotent 204 (§5.9), not an error.
    await request(app)
      .delete(`/api/v1/items/${item._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
  });

  it('403s non-owners and 409s when an active swap exists', async () => {
    const owned = await createItem();
    await request(app)
      .delete(`/api/v1/items/${owned._id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);

    const locked = await createItem();
    await SwapRequest.create({
      itemId: locked._id,
      requesterId: otherUser._id,
      type: 'POINTS_REDEMPTION',
      status: 'ACCEPTED',
    });
    const res = await request(app)
      .delete(`/api/v1/items/${locked._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(409);
    expect(res.body.error.code).toBe('ITEM_LOCKED');
  });

  it('requires authentication', async () => {
    const item = await createItem();
    await request(app).delete(`/api/v1/items/${item._id}`).expect(401);
  });
});
