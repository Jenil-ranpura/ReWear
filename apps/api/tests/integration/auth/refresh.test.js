/**
 * P3-T3 integration tests — POST /api/v1/auth/refresh (§10/§11).
 * Covers the rotation chain across register → login → refresh, old-token
 * reuse rejection (the §11 rotation payoff), and banned-user session
 * invalidation.
 */

import crypto from 'node:crypto';
import request from 'supertest';

import app from '../../../src/app.js';
import { User } from '../../../src/models/index.js';
import { startTestDb, stopTestDb } from '../../helpers/testDb.js';

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';

const password = 'sup3rSecret!';

const extractRefreshCookie = (res) =>
  res.headers['set-cookie'].find((c) => c.startsWith('rewear_refreshToken='));

function cookieValue(res) {
  return extractRefreshCookie(res).split(';')[0].split('=').slice(1).join('=');
}

async function registerTestUser(email) {
  const res = await request(app).post(REGISTER).send({ name: 'Refresh Tester', email, password });
  expect(res.status).toBe(201);
  return res;
}

beforeAll(async () => {
  await startTestDb();
  await User.init();
});

afterAll(async () => {
  await stopTestDb();
});

describe('POST /api/v1/auth/refresh', () => {
  it('issues a new access token, rotates the cookie, and the new token works again', async () => {
    const email = `refresh-${crypto.randomUUID()}@example.com`;
    await registerTestUser(email);

    const login1 = await request(app).post(LOGIN).send({ email, password });
    const res = await request(app).post(REFRESH).set('Cookie', extractRefreshCookie(login1));

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body).not.toHaveProperty('user'); // §10: refresh returns only the access token
    expect(res.body.accessToken).not.toBe(''); // real token

    // Cookie must rotate on refresh (§11).
    const nextCookie = extractRefreshCookie(res);
    expect(nextCookie).toBeDefined();
    expect(cookieValue(res)).not.toBe(cookieValue(login1));

    // The chain continues: refreshing AGAIN with the newest cookie also works.
    const res2 = await request(app).post(REFRESH).set('Cookie', nextCookie);
    expect(res2.status).toBe(200);
    expect(typeof res2.body.accessToken).toBe('string');
  });

  it('rejects reuse of an already-rotated (old) refresh token with 401 INVALID_REFRESH', async () => {
    const email = `reuse-${crypto.randomUUID()}@example.com`;
    await registerTestUser(email);

    const login = await request(app).post(LOGIN).send({ email, password });
    const originalCookie = extractRefreshCookie(login);

    // First refresh consumes the original token...
    const first = await request(app).post(REFRESH).set('Cookie', originalCookie);
    expect(first.status).toBe(200);

    // ...replaying the SAME cookie must now fail (rotation = old token dead).
    const replay = await request(app).post(REFRESH).set('Cookie', originalCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_REFRESH');
  });

  it('rejects a missing cookie with 401 INVALID_REFRESH and clears the cookie', async () => {
    const res = await request(app).post(REFRESH);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH');
    expect(res.headers['set-cookie'].join()).toContain('rewear_refreshToken=;');
  });

  it('rejects a garbage cookie value with 401 INVALID_REFRESH', async () => {
    const res = await request(app)
      .post(REFRESH)
      .set('Cookie', 'rewear_refreshToken=not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH');
  });

  it('blocks a banned user from refreshing AND invalidates their session', async () => {
    const email = `banrefresh-${crypto.randomUUID()}@example.com`;
    await registerTestUser(email);

    const login = await request(app).post(LOGIN).send({ email, password });
    const validCookie = extractRefreshCookie(login);

    // Ban arrives via the admin action in Phase 4 — flip the flag directly.
    await User.updateOne({ email }, { $set: { isBanned: true } });

    const res = await request(app).post(REFRESH).set('Cookie', validCookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BANNED');

    // Session invalidation: the (formerly valid) cookie is now dead —
    // a stolen cookie cannot ride out the ban.
    const again = await request(app).post(REFRESH).set('Cookie', validCookie);
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('INVALID_REFRESH');
  });
});
