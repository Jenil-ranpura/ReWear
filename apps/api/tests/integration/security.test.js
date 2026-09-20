/**
 * P8-T2 — consolidated security suite (§17 "Security" matrix row).
 *
 * PURPOSE: one suite a reviewer can read as the security index. Per the
 * P8-T1 audit, most §17 security rows are ALREADY pinned inside the feature
 * suites where the behavior lives (do NOT duplicate them here):
 *
 *   admin route gate (401 guest / 403 user) .... admin/admin.test.js
 *   register NoSQL-injection shape + role strip . auth/register.test.js
 *   item pointValue/ownerId smuggling ........... items/crud.test.js
 *   item PATCH/DELETE ownership (IDOR write) .... items/crud.test.js
 *   refresh/logout garbage tokens ............... auth/refresh|logout.test.js
 *   malformed Bearer on public read ............. items/browse.test.js
 *   report participant 403 ...................... reports/reports.test.js
 *   swap PATCH 403 (accept/reject by non-owner) . swaps/swaps.test.js
 *
 * This suite adds the four assertions the audit found MISSING and names the
 * row each one closes:
 *   1. IDOR — swap-detail READ path (GET /swap-requests/:id) for a
 *      non-participant: the write path 403 existed, the read 403 didn't.
 *   2. Token forgery — a STRUCTURALLY VALID JWT signed with the WRONG
 *      secret must 401 (existing tests only cover malformed garbage).
 *   3. NoSQL injection on the LOGIN body (register was probed; login is the
 *      classic operator-substitution target).
 *   4. Swap-create state smuggling — a client-sent `status` must never
 *      survive (same trust model as pointValue/ownerId).
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import app from '.././../src/app.js';
import env from '../../src/config/env.js';
import { startTestDb, stopTestDb } from '../helpers/testDb.js';
import { Item, SwapRequest, User } from '../../src/models/index.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';

let owner;
let outsider;
let bystander;
let ownerToken;
let outsiderToken;
let bystanderToken;

beforeAll(async () => {
  await startTestDb();
  const mk = async (name, points = 0) =>
    User.create({
      name,
      email: `${name.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.dev`,
      passwordHash: await bcrypt.hash('Password123!', 4),
      pointsBalance: points,
    });
  owner = await mk('SecOwner');
  // Files POINTS_REDEMPTION requests in this suite → needs a funded balance
  // (creation checks balance ≥ pointValue; a 0-balance requester 409s).
  outsider = await mk('SecOutsider', 100);
  bystander = await mk('SecBystander');
  ownerToken = signAccessToken(await User.findById(owner._id));
  outsiderToken = signAccessToken(await User.findById(outsider._id));
  bystanderToken = signAccessToken(await User.findById(bystander._id));
});

afterAll(async () => {
  await stopTestDb();
});

describe('§17 security — consolidated suite (P8-T2)', () => {
  it('IDOR (read path): GET /swap-requests/:id 403s a non-participant — the swap stays invisible', async () => {
    const target = await Item.create({
      ownerId: owner._id,
      title: 'Security swap target',
      description: 'A security-test fixture item with enough description.',
      category: 'TOPS',
      type: 'T_SHIRT',
      size: 'M',
      condition: 'GOOD',
      pointValue: 20,
      status: 'APPROVED',
      images: [{ url: 'https://example.com/x.jpg', isPrimary: true }],
    });
    const created = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${outsiderToken}`) // outsider = requester here
      .send({ type: 'POINTS_REDEMPTION' })
      .expect(201);
    const swapId = created.body.swapRequest._id;

    // A third party (neither participant) gets the §10 403 — not a 200 with
    // someone else's swap data, not a 5xx leak either.
    const res = await request(app)
      .get(`/api/v1/swap-requests/${swapId}`)
      .set('Authorization', `Bearer ${bystanderToken}`)
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.swapRequest).toBeUndefined();

    // …and BOTH participants still read their own swap — the 403 must not
    // over-block legitimate parties (requester + owner-of-record).
    await request(app)
      .get(`/api/v1/swap-requests/${swapId}`)
      .set('Authorization', `Bearer ${outsiderToken}`) // the requester
      .expect(200);
    await request(app)
      .get(`/api/v1/swap-requests/${swapId}`)
      .set('Authorization', `Bearer ${ownerToken}`) // the item owner
      .expect(200);
  });

  it('token forgery: a structurally valid JWT signed with the WRONG secret is rejected 401 everywhere', async () => {
    const forged = jwt.sign(
      { userId: String(outsider._id), role: 'ADMIN' }, // forged AND role-escalated
      'totally-wrong-secret',
      { expiresIn: '15m' }
    );

    // Authenticated route: refused.
    const me = await request(app)
      .get('/api/v1/users/me/items')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
    expect(me.body.error.code).toBe('UNAUTHENTICATED');

    // Privileged route: refused the same way (no admin bypass via forgery).
    await request(app)
      .get('/api/v1/admin/reports')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);

    // Public read: the invalid token degrades to anonymous — never an error.
    await request(app).get('/api/v1/items').set('Authorization', `Bearer ${forged}`).expect(200);

    void env;
  });

  it('NoSQL injection (login path): operator-substitution bodies are 400 VALIDATION, never evaluated', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $gt: '' }, password: { $gt: '' } })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION');

    // Mixed real/operator shape: same refusal.
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $regex: '.*' }, password: 'Password123!' })
      .expect(400);
  });

  it('swap-create smuggling: a client-sent status never survives (creation is always PENDING)', async () => {
    const target = await Item.create({
      ownerId: owner._id,
      title: 'Smuggle target',
      description: 'A security-test fixture item with enough description.',
      category: 'TOPS',
      type: 'T_SHIRT',
      size: 'M',
      condition: 'GOOD',
      pointValue: 20,
      status: 'APPROVED',
      images: [{ url: 'https://example.com/x.jpg', isPrimary: true }],
    });
    const res = await request(app)
      .post(`/api/v1/items/${target._id}/swap-requests`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ type: 'POINTS_REDEMPTION', status: 'ACCEPTED', requesterPhone: '+919876543211' })
      .expect(201);

    expect(res.body.swapRequest.status).toBe('PENDING'); // §15: server owns state
    const doc = await SwapRequest.findById(res.body.swapRequest._id).lean();
    expect(doc.status).toBe('PENDING');
  });
});
