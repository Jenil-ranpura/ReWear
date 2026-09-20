/**
 * P3-T4 integration tests — POST /api/v1/auth/logout, GET /api/v1/auth/me
 * (§10/§11/§15), plus the requireAuth middleware behaviors both depend on.
 */

import crypto from 'node:crypto';
import request from 'supertest';

import app from '../../../src/app.js';
import { User } from '../../../src/models/index.js';
import { startTestDb, stopTestDb } from '../../helpers/testDb.js';

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const LOGOUT = '/api/v1/auth/logout';
const ME = '/api/v1/auth/me';

const password = 'sup3rSecret!';

async function registerAndLogin(email) {
  await request(app).post(REGISTER).send({ name: 'Me Tester', email, password });
  return request(app).post(LOGIN).send({ email, password });
}

const extractRefreshCookie = (res) =>
  res.headers['set-cookie'].find((c) => c.startsWith('rewear_refreshToken='));

beforeAll(async () => {
  await startTestDb();
  await User.init();
});

afterAll(async () => {
  await stopTestDb();
});

describe('GET /api/v1/auth/me', () => {
  it('returns the authenticated user with credentials stripped', async () => {
    const email = `me-${crypto.randomUUID()}@example.com`;
    const login = await registerAndLogin(email);
    const { accessToken } = login.body;

    const res = await request(app).get(ME).set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.role).toBe('USER');
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.refreshTokenHash).toBeUndefined();
  });

  it('401 UNAUTHENTICATED without a token', async () => {
    const res = await request(app).get(ME);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('401 with a garbage token', async () => {
    const res = await request(app).get(ME).set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('401 once the user is banned — even with a still-valid token (fresh fetch)', async () => {
    const email = `mebanned-${crypto.randomUUID()}@example.com`;
    const login = await registerAndLogin(email);
    const { accessToken } = login.body;

    expect((await request(app).get(ME).set('Authorization', `Bearer ${accessToken}`)).status).toBe(
      200
    );

    await User.updateOne({ email }, { $set: { isBanned: true } });
    const after = await request(app).get(ME).set('Authorization', `Bearer ${accessToken}`);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('401 once the user is deleted (token references a ghost)', async () => {
    const email = `meghost-${crypto.randomUUID()}@example.com`;
    const login = await registerAndLogin(email);
    const { accessToken } = login.body;

    await User.deleteOne({ email });
    const res = await request(app).get(ME).set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('204, clears the refresh cookie, and invalidates the stored session hash', async () => {
    const email = `logout-${crypto.randomUUID()}@example.com`;
    const login = await registerAndLogin(email);
    const { accessToken } = login.body;

    const res = await request(app).post(LOGOUT).set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(204);

    // Cookie cleared in the response.
    const cleared = res.headers['set-cookie']?.find((c) => c.startsWith('rewear_refreshToken='));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    // Server-side invalidation: the stored hash is gone.
    const dbUser = await User.findOne({ email }).select('+refreshTokenHash');
    expect(dbUser.refreshTokenHash).toBeNull();
  });

  it('after logout, refreshing with the old cookie fails (session is dead)', async () => {
    const email = `logoutsess-${crypto.randomUUID()}@example.com`;
    const login = await registerAndLogin(email);
    const cookie = extractRefreshCookie(login);

    await request(app).post(LOGOUT).set('Authorization', `Bearer ${login.body.accessToken}`);

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH');
  });

  it('is idempotent: a second logout with the same token still returns 204', async () => {
    const email = `logoutidem-${crypto.randomUUID()}@example.com`;
    const login = await registerAndLogin(email);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    expect((await request(app).post(LOGOUT).set(auth)).status).toBe(204);
    expect((await request(app).post(LOGOUT).set(auth)).status).toBe(204);
  });

  it('401 without authentication', async () => {
    const res = await request(app).post(LOGOUT);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
