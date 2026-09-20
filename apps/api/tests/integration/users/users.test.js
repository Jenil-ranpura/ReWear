/**
 * P5-T3/P5-T5 — /users/me/* integration tests (§10 users rows). Items:
 * auth required, "me" scoping (only the caller's own items — §15 IDOR via
 * token-derived scoping), all statuses visible (server does NOT force
 * APPROVED — the caller decides), primary-image-first ordering, newest
 * first, and empty results. Points history: paginated ledger, newest first,
 * scoped to the caller, related swap request populated.
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../../../src/app.js';
import { startTestDb, stopTestDb } from '../../../tests/helpers/testDb.js';
import { Item, PointsTransaction, User } from '../../../src/models/index.js';
import { signAccessToken } from '../../../src/modules/auth/tokens.js';

let tokenFor;
let me;
let other;

async function createItem(overrides = {}) {
  const base = {
    ownerId: me._id,
    title: 'My item',
    description: 'A perfectly good item for testing.',
    category: 'TOPS',
    type: 'T_SHIRT',
    size: 'M',
    condition: 'GOOD',
    pointValue: 20,
    status: 'APPROVED',
    images: [{ url: 'https://example.com/img.jpg', isPrimary: true }],
  };
  // Small delay so createdAt ordering is deterministic.
  await new Promise((r) => setTimeout(r, 5));
  return Item.create({ ...base, ...overrides });
}

beforeAll(async () => {
  await startTestDb();
  const passwordHash = await bcrypt.hash('Password123!', 4);
  me = await User.create({
    name: 'Me',
    email: `me-${Date.now()}@test.dev`,
    passwordHash,
  });
  other = await User.create({
    name: 'Other',
    email: `other-${Date.now()}@test.dev`,
    passwordHash,
  });
  tokenFor = (user) => signAccessToken(user);
});

afterAll(async () => {
  await stopTestDb();
});

describe('GET /users/me/items', () => {
  beforeAll(async () => {
    await Item.deleteMany({});
    await createItem({ title: 'Mine newest' });
    await createItem({
      title: 'Mine pending',
      status: 'PENDING',
    });
    await createItem({
      title: 'Mine primary-second',
      images: [
        { url: 'https://example.com/b.jpg', isPrimary: false },
        { url: 'https://example.com/a.jpg', isPrimary: true },
      ],
    });
    await createItem({ title: 'Not mine', ownerId: other._id });
  });

  it('401s without a token', async () => {
    await request(app).get('/api/v1/users/me/items').expect(401);
  });

  it('returns only the caller’s own items, newest first', async () => {
    const res = await request(app)
      .get('/api/v1/users/me/items')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .expect(200);

    const titles = res.body.items.map((i) => i.title);
    expect(titles).toHaveLength(3);
    expect(titles).not.toContain('Not mine');
    expect(titles[0]).toBe('Mine primary-second'); // newest of mine
    expect(res.body.items[0].ownerId).toBe(String(me._id));
  });

  it('includes non-APPROVED statuses (owner manages their own queue)', async () => {
    const res = await request(app)
      .get('/api/v1/users/me/items')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .expect(200);

    expect(res.body.items.some((i) => i.status === 'PENDING')).toBe(true);
  });

  it('orders the primary image first', async () => {
    const res = await request(app)
      .get('/api/v1/users/me/items')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .expect(200);

    const item = res.body.items.find((i) => i.title === 'Mine primary-second');
    expect(item.images[0].url).toBe('https://example.com/a.jpg');
    expect(item.images[0].isPrimary).toBe(true);
  });

  it('scopes strictly: a second user sees only their own item (ledger included)', async () => {
    const res = await request(app)
      .get('/api/v1/users/me/items')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .expect(200);
    expect(res.body.items.map((i) => i.title)).toEqual(['Not mine']);
  });

  it('returns an empty list for a user with no items', async () => {
    const loner = await User.create({
      name: 'Loner',
      email: `loner-${Date.now()}@test.dev`,
      passwordHash: await bcrypt.hash('Password123!', 4),
    });
    const res = await request(app)
      .get('/api/v1/users/me/items')
      .set('Authorization', `Bearer ${tokenFor(loner)}`)
      .expect(200);
    expect(res.body.items).toEqual([]);
  });
});

describe('GET /users/me/points/history (P5-T5, §10)', () => {
  let ledgerUser;

  beforeAll(async () => {
    ledgerUser = await User.create({
      name: 'Ledger Owner',
      email: `ledger-${Date.now()}@test.dev`,
      passwordHash: await bcrypt.hash('Password123!', 4),
    });
    // 3 transactions for ledgerUser, 1 for someone else (scoping proof).
    // Explicit DISTINCT timestamps: a bulk insert lands in the same
    // millisecond, making createdAt ordering (the thing we assert)
    // nondeterministic.
    const base = Date.now();
    await PointsTransaction.create([
      { userId: ledgerUser._id, amount: 120, type: 'EARNED', createdAt: new Date(base - 2000) },
      { userId: ledgerUser._id, amount: -45, type: 'SPENT', createdAt: new Date(base - 1000) },
      { userId: ledgerUser._id, amount: 10, type: 'ADJUSTED', createdAt: new Date(base) },
      { userId: other._id, amount: 999, type: 'EARNED', createdAt: new Date(base) },
    ]);
  });

  it('401s without a token', async () => {
    await request(app).get('/api/v1/users/me/points/history').expect(401);
  });

  it('returns only the caller’s ledger, newest first, with the pagination envelope', async () => {
    const res = await request(app)
      .get('/api/v1/users/me/points/history')
      .set('Authorization', `Bearer ${tokenFor(ledgerUser)}`)
      .expect(200);

    expect(res.body.total).toBe(3);
    expect(res.body.transactions).toHaveLength(3);
    expect(res.body.transactions.map((t) => t.amount)).toEqual([10, -45, 120]); // newest first
    expect(res.body.page).toBe(1);
    expect(res.body.totalPages).toBe(1);
    // No cross-user leakage.
    expect(res.body.transactions.some((t) => t.amount === 999)).toBe(false);
  });

  it('paginates (page 2 with pageSize=2 → oldest item only)', async () => {
    const res = await request(app)
      .get('/api/v1/users/me/points/history?page=2&pageSize=2')
      .set('Authorization', `Bearer ${tokenFor(ledgerUser)}`)
      .expect(200);

    expect(res.body.total).toBe(3);
    expect(res.body.transactions).toHaveLength(1); // 3 items → page 2 has 1
    expect(res.body.transactions[0].amount).toBe(120); // the oldest
    expect(res.body.hasNextPage).toBe(false);
    expect(res.body.hasPrevPage).toBe(true);
  });

  it('rejects invalid pagination params with the §10 error shape', async () => {
    await request(app)
      .get('/api/v1/users/me/points/history?page=0')
      .set('Authorization', `Bearer ${tokenFor(ledgerUser)}`)
      .expect(400);
    await request(app)
      .get('/api/v1/users/me/points/history?pageSize=999')
      .set('Authorization', `Bearer ${tokenFor(ledgerUser)}`)
      .expect(400);
  });

  it('returns an empty ledger for a user with no transactions', async () => {
    const loner = await User.create({
      name: 'No Ledger',
      email: `noledger-${Date.now()}@test.dev`,
      passwordHash: await bcrypt.hash('Password123!', 4),
    });
    const res = await request(app)
      .get('/api/v1/users/me/points/history')
      .set('Authorization', `Bearer ${tokenFor(loner)}`)
      .expect(200);
    expect(res.body.transactions).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});
