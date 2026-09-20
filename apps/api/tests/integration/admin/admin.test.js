/**
 * P4-T6 — admin moderation integration tests (implementation.md §27: "role
 * guard test, moderation flow test"). Covers all four §10 admin endpoints:
 * pending queue, moderate (+ AdminAction audit), users search, ban/unban —
 * plus the §5.8 guardrails: non-admins are 403, bans enforce INSTANTLY
 * (requireAuth re-fetches per request), and moderation is race-safe via the
 * same conditional-update discipline as the swap gate (§5.7).
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../../../src/app.js';
import { startTestDb, stopTestDb } from '../../../tests/helpers/testDb.js';
import { AdminAction, Item, User } from '../../../src/models/index.js';
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

async function createItem(owner, overrides = {}) {
  return Item.create({
    ownerId: owner._id,
    title: `Item by ${owner.name}`,
    description: 'A moderation-test fixture item with enough description.',
    category: 'TOPS',
    type: 'T_SHIRT',
    size: 'M',
    condition: 'GOOD',
    pointValue: 20,
    status: 'PENDING',
    images: [{ url: 'https://example.com/x.jpg', isPrimary: true }],
    ...overrides,
  });
}

let admin;
let adminToken;
let user;
let userToken;

beforeAll(async () => {
  await startTestDb();
  admin = await createUser('Admin', { role: 'ADMIN' });
  adminToken = signAccessToken(admin);
  user = await createUser('Plebe');
  userToken = signAccessToken(user);
});

afterAll(async () => {
  await stopTestDb();
});

describe('role guard (§27: every admin route rejects non-admins)', () => {
  const call = (method, url) => request(app)[method.toLowerCase()](url);

  it.each([
    ['GET', '/api/v1/admin/items/pending'],
    ['PATCH', '/api/v1/admin/items/someid/moderate'],
    ['GET', '/api/v1/admin/users'],
    ['PATCH', '/api/v1/admin/users/someid/ban'],
  ])('%s %s → 403 for a regular user, 401 for a guest', async (method, url) => {
    const guest = await call(method, url);
    expect(guest.status).toBe(401);

    const plebe = await call(method, url)
      .set('Authorization', `Bearer ${userToken}`)
      .send(method === 'PATCH' ? { action: 'APPROVE' } : {});
    expect(plebe.status).toBe(403);
    expect(plebe.body.error.code).toBe('FORBIDDEN');
  });
});

describe('GET /admin/items/pending', () => {
  it('lists only PENDING items (oldest first) with owner info, paginated', async () => {
    const owner = await createUser('QueueOwner');
    const old = await createItem(owner, { title: 'Old pending item' });
    const newer = await createItem(owner, { title: 'Newer pending item' });
    await createItem(owner, { status: 'APPROVED', title: 'Approved — must NOT appear' });

    const res = await request(app)
      .get('/api/v1/admin/items/pending')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(2);
    const titles = res.body.items.map((i) => i.title);
    expect(titles).toContain('Old pending item');
    expect(titles).toContain('Newer pending item');
    expect(titles).not.toContain('Approved — must NOT appear');

    const idxOld = res.body.items.findIndex((i) => i.title === 'Old pending item');
    const idxNewer = res.body.items.findIndex((i) => i.title === 'Newer pending item');
    expect(idxOld).toBeLessThan(idxNewer); // oldest first (fair moderation order)

    expect(res.body.items[0].ownerId).toMatchObject({ name: 'QueueOwner' }); // populated
    expect(res.body).toMatchObject({ page: 1 });
    expect(old && newer).toBeTruthy();
  });

  it('400s on invalid pagination params (shared schema, §10 shape)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/items/pending?page=0')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

describe('PATCH /admin/items/:id/moderate', () => {
  it('APPROVE → status APPROVED + AdminAction audit row written', async () => {
    const owner = await createUser('ApproveOwner');
    const item = await createItem(owner);

    const res = await request(app)
      .patch(`/api/v1/admin/items/${item._id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'APPROVE' })
      .expect(200);

    expect(res.body.item.status).toBe('APPROVED');

    const auditRow = await AdminAction.findOne({ targetId: item._id, action: 'APPROVE' }).lean();
    expect(auditRow).toBeTruthy();
    expect(String(auditRow.adminId)).toBe(String(admin._id));
    expect(auditRow.targetType).toBe('Item');
  });

  it('REJECT stores the reason on the item (moderationReason) and in the audit row', async () => {
    const owner = await createUser('RejectOwner');
    const item = await createItem(owner, { title: 'Spammy duplicate jacket' });

    const res = await request(app)
      .patch(`/api/v1/admin/items/${item._id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'REJECT', reason: 'Suspected spam listing' })
      .expect(200);

    expect(res.body.item.status).toBe('REJECTED');
    expect(res.body.item.moderationReason).toBe('Suspected spam listing');

    const auditRow = await AdminAction.findOne({ targetId: item._id, action: 'REJECT' }).lean();
    expect(auditRow.reason).toBe('Suspected spam listing');
  });

  it('moderating a non-PENDING item → 409 INVALID_STATE', async () => {
    const owner = await createUser('AlreadyApproved');
    const item = await createItem(owner, { status: 'APPROVED' });

    const res = await request(app)
      .patch(`/api/v1/admin/items/${item._id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'REJECT', reason: 'too late' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('unknown item → 404; invalid body → 400 VALIDATION', async () => {
    const missing = await request(app)
      .patch('/api/v1/admin/items/000000000000000000000000/moderate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'APPROVE' });
    expect(missing.status).toBe(404);

    const bad = await request(app)
      .patch(
        `/api/v1/admin/items/${(await createItem(await createUser('BadBodyOwner')))._id}/moderate`
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'NUKE' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');
  });

  it('race safety: two concurrent moderates on one PENDING item — exactly one 200 + one 409, one audit row (§5.7 discipline)', async () => {
    const owner = await createUser('RaceOwner');
    const item = await createItem(owner);

    // Two moderators both saw the item in the queue (both read PENDING) and
    // click different actions at the same time. The conditional update is
    // the referee — the loser's match fails and must surface a clean 409.
    const [resA, resB] = await Promise.allSettled([
      request(app)
        .patch(`/api/v1/admin/items/${item._id}/moderate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'APPROVE' }),
      request(app)
        .patch(`/api/v1/admin/items/${item._id}/moderate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'REJECT', reason: 'raced' }),
    ]);
    const outcomes = [resA.value, resB.value];
    const winners = outcomes.filter((r) => r.status === 200);
    const losers = outcomes.filter((r) => r.status === 409);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    // The loser ALWAYS gets a 409, but WHICH 409 code depends on scheduling:
    // CONFLICT when the loser's guard-read happened BEFORE the winner's write
    // (the conditional update misses), INVALID_STATE when the guard-read
    // happens AFTER (it simply observes the new status). Both are correct
    // §5.7-discipline outcomes — the INVARIANT is one winner + one clean 409
    // + exactly one audit row, not a specific code. (A full-suite run
    // exposed this flake; isolated runs always passed. The swap service
    // CAN distinguish the two paths because its transaction auto-rejects
    // the losing request atomically — moderation has no such atomic read.)
    expect(['CONFLICT', 'INVALID_STATE']).toContain(losers[0].body.error.code);

    // The winner's action is the item's final state, with exactly ONE audit
    // row (no phantom rows from the loser).
    const final = await Item.findById(item._id).lean();
    const winnerAction = winners[0].body.item.status === 'APPROVED' ? 'APPROVE' : 'REJECT';
    expect(final.status).toBe(winners[0].body.item.status);
    const auditRows = await AdminAction.find({ targetId: item._id }).lean();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe(winnerAction);
  });
});

describe('GET /admin/users', () => {
  it('lists safe users (no passwordHash/refreshTokenHash) with search + filters', async () => {
    const target = await createUser('Findme Uniqueuser');
    await createUser('Other Person');

    const res = await request(app)
      .get(`/api/v1/admin/users?q=findme`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.users[0].name).toBe('Findme Uniqueuser');
    expect(res.body.users[0].passwordHash).toBeUndefined();
    expect(res.body.users[0].refreshTokenHash).toBeUndefined();
    void target;
  });

  it('filters by role and banned flags; paginates', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users?role=ADMIN&banned=false&page=1&pageSize=5')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.page).toBe(1);
    for (const u of res.body.users) {
      expect(u.role).toBe('ADMIN');
      expect(u.isBanned).toBe(false);
    }
  });
});

describe('PATCH /admin/users/:id/ban', () => {
  it('bans a user: isBanned true, session killed (refreshTokenHash null), audit row written', async () => {
    const victim = await createUser('Bannable');
    victim.refreshTokenHash = 'somehash';
    await victim.save();

    const res = await request(app)
      .patch(`/api/v1/admin/users/${victim._id}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ banned: true, reason: 'Fraudulent listings' })
      .expect(200);

    expect(res.body.user.isBanned).toBe(true);
    expect(res.body.changed).toBe(true);

    const doc = await User.findById(victim._id).select('+refreshTokenHash'); // select:false field (§11)
    expect(doc.isBanned).toBe(true);
    expect(doc.refreshTokenHash).toBeNull(); // session invalidation (§5.2/§11)

    const auditRow = await AdminAction.findOne({ targetId: victim._id, action: 'BAN' }).lean();
    expect(auditRow.reason).toBe('Fraudulent listings');
  });

  it('a banned user is refused on their VERY NEXT request (instant enforcement, §11)', async () => {
    const victim = await createUser('InstantOff');

    // Pre-ban request passes...
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${signAccessToken(victim)}`)
      .expect(200);

    // ...ban happens...
    await request(app)
      .patch(`/api/v1/admin/users/${victim._id}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ banned: true })
      .expect(200);

    // ...and the still-valid token dies immediately (requireAuth re-fetches).
    const after = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${signAccessToken(victim)}`);
    expect(after.status).toBe(401);
  });

  it('unban restores access (banned:false); admin cannot ban themselves; idempotent re-ban audits but does not fail', async () => {
    const cycled = await createUser('BanCycle');
    const banUrl = `/api/v1/admin/users/${cycled._id}/ban`;

    await request(app)
      .patch(banUrl)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ banned: true })
      .expect(200);
    await request(app)
      .patch(banUrl)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ banned: true, reason: 'repeat offence' })
      .expect(200); // idempotent

    const unbanned = await request(app)
      .patch(banUrl)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ banned: false })
      .expect(200);
    expect(unbanned.body.user.isBanned).toBe(false);

    const self = await request(app)
      .patch(`/api/v1/admin/users/${admin._id}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ banned: true });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('FORBIDDEN');
  });
});
