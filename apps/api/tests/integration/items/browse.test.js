/**
 * P4-T3 — GET /items integration tests (§5.4/§10, on mongodb-memory-server).
 * Covers: guest forcing to APPROVED, filters (category/size/condition/tags),
 * multi-value filters, q search with regex-safety, pagination + clamping,
 * admin status override, and the GET /items/:id visibility rule.
 */

import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import app from '../../../src/app.js';
import { startTestDb, stopTestDb } from '../../../tests/helpers/testDb.js';
import { Item, User } from '../../../src/models/index.js';
import { signAccessToken } from '../../../src/modules/auth/tokens.js';

let owner;

async function createItem(overrides = {}) {
  const base = {
    ownerId: owner._id,
    title: 'Test item',
    description: 'A perfectly good item for testing.',
    category: 'TOPS',
    type: 'T_SHIRT',
    size: 'M',
    condition: 'GOOD',
    pointValue: 20,
    status: 'APPROVED',
    images: [{ url: 'https://example.com/img.jpg', isPrimary: true }],
  };
  return Item.create({ ...base, ...overrides });
}

let tokenFor;

beforeAll(async () => {
  await startTestDb();
  owner = await User.create({
    name: 'Owner',
    email: `owner-${Date.now()}@test.dev`,
    passwordHash: await bcrypt.hash('Password123!', 4),
  });
  owner = await User.findById(owner._id); // passwordHash is select:false by default
  tokenFor = (user) => signAccessToken(user);
});

afterAll(async () => {
  await stopTestDb();
});

describe('GET /items — browse & filters (P4-T3)', () => {
  beforeAll(async () => {
    await Item.deleteMany({});
    await createItem({
      title: 'Red wool sweater',
      category: 'TOPS',
      size: 'M',
      condition: 'GOOD',
      tags: ['wool', 'warm'],
    });
    await createItem({
      title: 'Blue denim jacket',
      category: 'OUTERWEAR',
      size: 'L',
      condition: 'LIKE_NEW',
      tags: ['denim'],
    });
    await createItem({
      title: 'Black dress',
      category: 'DRESSES',
      size: 'S',
      condition: 'NEW',
      tags: ['evening'],
    });
    await createItem({
      title: 'Pending dress',
      category: 'DRESSES',
      status: 'PENDING',
      tags: ['hidden'],
    });
    await createItem({ title: 'Rejected parka', category: 'OUTERWEAR', status: 'REJECTED' });
  });

  it('returns 200 with the §10 response envelope and only APPROVED items for guests', async () => {
    const res = await request(app).get('/api/v1/items').expect(200);

    expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(res.body.items).toHaveLength(3);
    expect(res.body.total).toBe(3);
    // Every returned item is APPROVED — PENDING/REJECTED never leak.
    res.body.items.forEach((i) => expect(i.status).toBe('APPROVED'));
  });

  it('filters by category (uses the {status,category} compound index path)', async () => {
    const res = await request(app).get('/api/v1/items?category=DRESSES').expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe('Black dress');
  });

  it('supports multi-value filters via repeated params and comma lists', async () => {
    const repeated = await request(app)
      .get('/api/v1/items?condition=NEW&condition=LIKE_NEW')
      .expect(200);
    expect(repeated.body.items).toHaveLength(2);

    const comma = await request(app).get('/api/v1/items?condition=NEW,GOOD').expect(200);
    expect(comma.body.items).toHaveLength(2);
  });

  it('filters by size and tags', async () => {
    const size = await request(app).get('/api/v1/items?size=L').expect(200);
    expect(size.body.items.map((i) => i.title)).toEqual(['Blue denim jacket']);

    const tags = await request(app).get('/api/v1/items?tags=wool').expect(200);
    expect(tags.body.items.map((i) => i.title)).toEqual(['Red wool sweater']);
  });

  it('searches q across title/description/tags and is regex-safe', async () => {
    const hit = await request(app).get('/api/v1/items?q=sweater').expect(200);
    expect(hit.body.items).toHaveLength(1);
    expect(hit.body.items[0].title).toBe('Red wool sweater');

    // Regex metacharacters are escaped, not interpreted: "(.*" matches nothing
    // but MUST NOT error.
    const safe = await request(app).get('/api/v1/items?q=%28.%2A').expect(200);
    expect(safe.body.items).toHaveLength(0);
  });

  it('paginates and reports the §10 envelope fields', async () => {
    const res = await request(app).get('/api/v1/items?page=1&pageSize=2').expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(3);
    expect(res.body.totalPages).toBe(2);
    expect(res.body.hasNextPage).toBe(true);
    expect(res.body.hasPrevPage).toBe(false);

    const res2 = await request(app).get('/api/v1/items?page=2&pageSize=2').expect(200);
    expect(res2.body.items).toHaveLength(1);
    expect(res2.body.hasNextPage).toBe(false);
    expect(res2.body.hasPrevPage).toBe(true);
  });

  it('rejects pageSize above the 60 ceiling and page < 1 (explicit 400, not silent clamp)', async () => {
    // Deliberate contract: the schema REJECTS oversized pages rather than
    // clamping — silent clamping hides client bugs (§10 "never unbounded").
    await request(app).get('/api/v1/items?pageSize=500').expect(400);

    await request(app).get('/api/v1/items?page=0').expect(400);
    await request(app).get('/api/v1/items?page=notanumber').expect(400);
    await request(app).get('/api/v1/items?condition=NOT_A_CONDITION').expect(400);
  });

  it('forces guests and regular users to APPROVED even with ?status=PENDING', async () => {
    const guest = await request(app).get('/api/v1/items?status=PENDING').expect(200);
    expect(guest.body.items).toHaveLength(3);
    guest.body.items.forEach((i) => expect(i.status).toBe('APPROVED'));

    const user = await request(app)
      .get('/api/v1/items?status=PENDING')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .expect(200);
    expect(user.body.items).toHaveLength(3);
  });

  it('lets admins browse other statuses via ?status=', async () => {
    const admin = await User.create({
      name: 'Admin',
      email: `admin-${Date.now()}@test.dev`,
      passwordHash: await bcrypt.hash('Password123!', 4),
      role: 'ADMIN',
    });
    const adminToken = tokenFor(await User.findById(admin._id));

    const pending = await request(app)
      .get('/api/v1/items?status=PENDING')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(pending.body.items).toHaveLength(1);
    expect(pending.body.items[0].title).toBe('Pending dress');

    const rejected = await request(app)
      .get('/api/v1/items?status=REJECTED')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(rejected.body.items.map((i) => i.title)).toEqual(['Rejected parka']);
  });

  it('treats an invalid Bearer token as anonymous (public read never breaks)', async () => {
    const res = await request(app)
      .get('/api/v1/items?status=PENDING')
      .set('Authorization', 'Bearer garbage.token.here')
      .expect(200);
    expect(res.body.items).toHaveLength(3); // forced to APPROVED as a guest
  });
});

describe('GET /items/:id — visibility rules (P4-T3)', () => {
  let approvedItem;
  let pendingItem;

  beforeAll(async () => {
    approvedItem = await createItem({ title: 'Visible approved item' });
    pendingItem = await createItem({ title: 'Invisible pending item', status: 'PENDING' });
  });

  it('shows approved items to guests with owner info', async () => {
    const res = await request(app).get(`/api/v1/items/${approvedItem._id}`).expect(200);
    expect(res.body.item.title).toBe('Visible approved item');
    expect(String(res.body.item.ownerId)).toBe(String(owner._id));
  });

  it('attaches public owner info (§10 populated owner) — never credential fields', async () => {
    const res = await request(app).get(`/api/v1/items/${approvedItem._id}`).expect(200);
    expect(res.body.item.owner).toBeDefined();
    expect(res.body.item.owner._id).toBe(String(owner._id));
    expect(res.body.item.owner.name).toBe('Owner');
    // §15: only public profile fields may leave the API.
    expect(res.body.item.owner).not.toHaveProperty('passwordHash');
    expect(res.body.item.owner).not.toHaveProperty('refreshTokenHash');
    expect(res.body.item.owner).not.toHaveProperty('email');
    expect(res.body.item.owner).not.toHaveProperty('pointsBalance');
  });

  it('404s unapproved items for guests (no existence leak) but shows them to the owner', async () => {
    await request(app).get(`/api/v1/items/${pendingItem._id}`).expect(404);

    const ownerRes = await request(app)
      .get(`/api/v1/items/${pendingItem._id}`)
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .expect(200);
    expect(ownerRes.body.item.title).toBe('Invisible pending item');
  });

  it('404s unknown ids and malformed ObjectIds with the §10 shape', async () => {
    const missing = await request(app)
      .get(`/api/v1/items/${new mongoose.Types.ObjectId()}`)
      .expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const malformed = await request(app).get('/api/v1/items/not-an-objectid').expect(400);
    expect(malformed.body.error.code).toBe('VALIDATION');
  });
});

describe('GET /items?location= — owner-location filter (user-requested scope addition)', () => {
  let mumbaiUser;
  let delhiUser;

  beforeAll(async () => {
    // Distinct owners WITH locations; the earlier describe's items all belong
    // to `owner` (no location) — so every assertion below doubles as a check
    // that location-less owners are EXCLUDED from a filtered browse.
    mumbaiUser = await User.create({
      name: 'Mumbai Maya',
      email: `maya-${Date.now()}@test.dev`,
      passwordHash: await bcrypt.hash('Password123!', 4),
      location: 'Mumbai, MH',
    });
    delhiUser = await User.create({
      name: 'Delhi Dev',
      email: `dev-${Date.now()}@test.dev`,
      passwordHash: await bcrypt.hash('Password123!', 4),
      location: 'delhi',
    });
    await createItem({ title: 'Mumbai sweater', ownerId: mumbaiUser._id });
    await createItem({ title: 'Delhi jacket', ownerId: delhiUser._id });
  });

  it('matches case-insensitively and as a contains-match on the owner profile', async () => {
    // lowercase input vs "Mumbai, MH" — proves 'i' flag + substring semantics.
    const res = await request(app).get('/api/v1/items?location=mumbai').expect(200);
    expect(res.body.items.map((i) => i.title)).toEqual(['Mumbai sweater']);
  });

  it('ANDs with the other filters (category still applies)', async () => {
    // 'Red wool sweater' is TOPS but its owner has no location → excluded.
    const res = await request(app).get('/api/v1/items?location=mumbai&category=TOPS').expect(200);
    expect(res.body.items.map((i) => i.title)).toEqual(['Mumbai sweater']);
  });

  it('returns an explicit empty list when no owner matches (never widens the query)', async () => {
    const res = await request(app).get('/api/v1/items?location=Nowhereville').expect(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });

  it('escapes regex metacharacters in the location value (no 500, no wildcard)', async () => {
    const res = await request(app).get('/api/v1/items?location=%28.%2A').expect(200);
    expect(res.body.total).toBe(0);
  });

  it('keeps unapproved items hidden from location-filtered browse', async () => {
    await createItem({
      title: 'Hidden Mumbai pending',
      ownerId: mumbaiUser._id,
      status: 'PENDING',
    });
    const res = await request(app).get('/api/v1/items?location=mumbai').expect(200);
    expect(res.body.items.map((i) => i.title)).toEqual(['Mumbai sweater']);
  });
});
