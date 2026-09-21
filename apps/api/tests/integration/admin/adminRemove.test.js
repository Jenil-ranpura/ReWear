/**
 * Admin REMOVE — post-approval takedown of live listings.
 *
 * Problem statement: "Remove inappropriate or spam items." Until now an
 * admin could only act on PENDING items; a listing that passed review and
 * THEN turned out to be spam/inappropriate was untouchable. REMOVE closes
 * that gap: it strikes APPROVED (or PENDING) listings, REQUIRES a reason
 * (the owner deserves an explanation; the audit row carries it), and keeps
 * the §5.7 conditional-update race discipline.
 *
 * Covered: happy path from APPROVED + audit row, reason required (shared
 * schema + service gate), non-admin 403, REMOVE-from-SWAPPED → 409 (never
 * undo a completed swap's ledger effects), REJECT-from-APPROVED still 409
 * (transition table didn't loosen the guard), owner visibility of the
 * removal, and browse hiding.
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

function moderate(itemId, body, token = adminToken) {
  return request(app)
    .patch(`/api/v1/admin/items/${itemId}/moderate`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

describe('PATCH /admin/items/:id/moderate — REMOVE (post-approval takedown)', () => {
  it('removes a LIVE (APPROVED) listing: status REMOVED, reason stored, audit row written', async () => {
    const owner = await createUser('RemoveOwner');
    const item = await createItem(owner, { status: 'APPROVED', title: 'Counterfeit jacket' });

    const res = await moderate(item._id, {
      action: 'REMOVE',
      reason: 'Counterfeit brand listing',
    }).expect(200);

    expect(res.body.item.status).toBe('REMOVED');
    expect(res.body.item.moderationReason).toBe('Counterfeit brand listing');

    const auditRow = await AdminAction.findOne({ targetId: item._id, action: 'REMOVE' }).lean();
    expect(auditRow).toBeTruthy();
    expect(String(auditRow.adminId)).toBe(String(admin._id));
    expect(auditRow.reason).toBe('Counterfeit brand listing');
    expect(auditRow.targetType).toBe('Item');
  });

  it('REQUIRES a reason — 400 VALIDATION without one (shared schema, REMOVE-specific)', async () => {
    const owner = await createUser('RemoveNoReason');
    const item = await createItem(owner, { status: 'APPROVED' });

    const res = await moderate(item._id, { action: 'REMOVE' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/reason is required/i);

    // The item is untouched.
    const doc = await Item.findById(item._id).lean();
    expect(doc.status).toBe('APPROVED');
    expect(doc.moderationReason).toBeNull();
  });

  it('is admin-only (non-admin → 403 FORBIDDEN, same as the other actions)', async () => {
    const owner = await createUser('RemovePlebe');
    const item = await createItem(owner, { status: 'APPROVED' });

    const res = await moderate(item._id, { action: 'REMOVE', reason: 'nope' }, userToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const doc = await Item.findById(item._id).lean();
    expect(doc.status).toBe('APPROVED');
  });

  it('cannot remove an already-SWAPPED item (409 — never undoes a completed swap)', async () => {
    const owner = await createUser('RemoveSwapped');
    const item = await createItem(owner, { status: 'SWAPPED' });

    const res = await moderate(item._id, { action: 'REMOVE', reason: 'too late' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
    expect(res.body.error.message).toMatch(/REMOVE applies to PENDING\/APPROVED/);

    const doc = await Item.findById(item._id).lean();
    expect(doc.status).toBe('SWAPPED');
  });

  it('transition table did not loosen the guard: REJECT on an APPROVED item still 409s', async () => {
    const owner = await createUser('RejectApproved');
    const item = await createItem(owner, { status: 'APPROVED' });

    const res = await moderate(item._id, { action: 'REJECT', reason: 'too late' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('REMOVE from PENDING also works (e.g. queue + live-monitoring overlap)', async () => {
    const owner = await createUser('RemovePending');
    const item = await createItem(owner); // PENDING

    const res = await moderate(item._id, { action: 'REMOVE', reason: 'Banned seller' }).expect(200);
    expect(res.body.item.status).toBe('REMOVED');
  });

  it('race safety: two concurrent REMOVEs on one APPROVED item — exactly one 200 + one 409, one audit row', async () => {
    const owner = await createUser('RemoveRace');
    const item = await createItem(owner, { status: 'APPROVED' });

    const [a, b] = await Promise.all([
      moderate(item._id, { action: 'REMOVE', reason: 'admin a' }),
      moderate(item._id, { action: 'REMOVE', reason: 'admin b' }),
    ]);

    const ok = [a.status, b.status].filter((s) => s === 200);
    const conflict = [a.status, b.status].filter((s) => s === 409);
    expect(ok).toHaveLength(1);
    expect(conflict).toHaveLength(1);

    const auditRows = await AdminAction.find({ targetId: item._id, action: 'REMOVE' }).lean();
    expect(auditRows).toHaveLength(1);

    const doc = await Item.findById(item._id).lean();
    expect(doc.status).toBe('REMOVED');
  });

  it('the OWNER still sees the removed item with the reason (own-items view is all-status)', async () => {
    const owner = await createUser('RemoveOwnerSees');
    const item = await createItem(owner, { status: 'APPROVED', title: 'My live jacket' });

    await moderate(item._id, { action: 'REMOVE', reason: 'Prohibited item' }).expect(200);

    const res = await request(app)
      .get('/api/v1/users/me/items')
      .set('Authorization', `Bearer ${signAccessToken(owner)}`)
      .expect(200);

    const removed = res.body.items.find((i) => i.title === 'My live jacket');
    expect(removed).toBeTruthy();
    expect(removed.status).toBe('REMOVED');
    expect(removed.moderationReason).toBe('Prohibited item');
  });

  it('a REMOVED item no longer appears in public browse', async () => {
    const owner = await createUser('RemovedFromBrowse');
    const item = await createItem(owner, {
      status: 'APPROVED',
      title: 'Soon-to-vanish item',
    });

    await moderate(item._id, { action: 'REMOVE', reason: 'Spam' }).expect(200);

    const res = await request(app).get('/api/v1/items?q=Soon-to-vanish').expect(200);
    expect(res.body.items.some((i) => i.title === 'Soon-to-vanish item')).toBe(false);
  });
});

describe('GET /admin/items — live-monitoring list (post-approval oversight)', () => {
  it('lists APPROVED items (default) with owner info, newest first — not PENDING/REMOVED ones', async () => {
    const owner = await createUser('MonitorOwner');
    await createItem(owner, { status: 'APPROVED', title: 'Live alpha' });
    await new Promise((r) => setTimeout(r, 5));
    await createItem(owner, { status: 'APPROVED', title: 'Live beta' });
    await createItem(owner, { status: 'PENDING', title: 'Waiting gamma' });
    await createItem(owner, { status: 'REMOVED', title: 'Gone delta' });

    const res = await request(app)
      .get('/api/v1/admin/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const titles = res.body.items.map((i) => i.title);
    expect(titles).toContain('Live alpha');
    expect(titles).toContain('Live beta');
    expect(titles).not.toContain('Waiting gamma');
    expect(titles).not.toContain('Gone delta');
    // Newest first.
    expect(titles.indexOf('Live beta')).toBeLessThan(titles.indexOf('Live alpha'));
    expect(res.body.items[0].ownerId?.name).toBe('MonitorOwner');
  });

  it('filters status=REMOVED (takedown trail) and searches by title q', async () => {
    const owner = await createUser('MonitorRemoved');
    await createItem(owner, { status: 'REMOVED', title: 'Struck spam one' });
    await createItem(owner, { status: 'REMOVED', title: 'Struck spam two' });
    await createItem(owner, { status: 'APPROVED', title: 'Still live' });

    const removed = await request(app)
      .get('/api/v1/admin/items?status=REMOVED')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const removedTitles = removed.body.items.map((i) => i.title);
    expect(removedTitles).toContain('Struck spam one');
    expect(removedTitles).toContain('Struck spam two');
    expect(removedTitles).not.toContain('Still live');

    // q searches WITHIN the selected status tab (Live tab searches live
    // items; Removed tab searches the takedown trail).
    const searched = await request(app)
      .get('/api/v1/admin/items?status=REMOVED&q=spam%20two')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(searched.body.items.map((i) => i.title)).toEqual(['Struck spam two']);

    // The same q on the default APPROVED tab finds nothing (the item is gone).
    const liveOnly = await request(app)
      .get('/api/v1/admin/items?q=spam%20two')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(liveOnly.body.items).toEqual([]);
  });

  it('rejects an unknown status filter with 400 and hides the list from non-admins', async () => {
    await request(app)
      .get('/api/v1/admin/items?status=SWAPPED')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    await request(app)
      .get('/api/v1/admin/items')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });
});
