/**
 * Fixed session window (§11, user request): every login session lives exactly
 * SESSION_TTL_MINUTES from login — refresh rotates the token but NEVER extends
 * the window, and once it is over BOTH /auth/refresh and every protected route
 * reject, even with a still-cryptographically-valid access token. Expiry is
 * simulated by pulling the stored deadline into the past (no waiting).
 */

import crypto from 'node:crypto';
import request from 'supertest';

import app from '../../../src/app.js';
import env from '../../../src/config/env.js';
import { User } from '../../../src/models/index.js';
import { startTestDb, stopTestDb } from '../../helpers/testDb.js';

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const ME = '/api/v1/auth/me';

const password = 'sup3rSecret!';

const extractRefreshCookie = (res) =>
  res.headers['set-cookie'].find((c) => c.startsWith('rewear_refreshToken='));

async function registerAndLogin(email) {
  await request(app).post(REGISTER).send({ name: 'Session Tester', email, password });
  return request(app).post(LOGIN).send({ email, password });
}

beforeAll(async () => {
  await startTestDb();
  await User.init();
});

afterAll(async () => {
  await stopTestDb();
});

describe('fixed session window (§11, user request)', () => {
  it('login stamps an absolute deadline ~SESSION_TTL_MINUTES out (response + DB + cookie)', async () => {
    const email = `sess-stamp-${crypto.randomUUID()}@example.com`;
    const before = Date.now();
    const login = await registerAndLogin(email);

    // The response carries the deadline so the client can arm its auto-logout.
    expect(typeof login.body.sessionExpiresAt).toBe('string');
    const deadline = new Date(login.body.sessionExpiresAt).getTime();
    const ttlMs = env.SESSION_TTL_MINUTES * 60_000;
    expect(deadline).toBeGreaterThanOrEqual(before + ttlMs - 1000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + ttlMs + 1000);

    // The DB holds the same absolute deadline (the server-side source of truth).
    const doc = await User.findOne({ email });
    expect(doc.sessionExpiresAt).not.toBeNull();
    expect(doc.sessionExpiresAt.getTime()).toBe(deadline);

    // The refresh cookie cannot outlive the window.
    const cookie = extractRefreshCookie(login);
    const maxAge = Number(cookie.match(/Max-Age=(\d+)/)?.[1]);
    expect(maxAge).toBe(env.SESSION_TTL_MINUTES * 60);
  });

  it('refresh ROTATES but does NOT extend the window (no sliding session)', async () => {
    const email = `sess-noslide-${crypto.randomUUID()}@example.com`;
    const login = await registerAndLogin(email);
    const original = login.body.sessionExpiresAt;

    const first = await request(app).post(REFRESH).set('Cookie', extractRefreshCookie(login));
    expect(first.status).toBe(200);
    expect(first.body.sessionExpiresAt).toBe(original);

    const second = await request(app).post(REFRESH).set('Cookie', extractRefreshCookie(first));
    expect(second.status).toBe(200);
    expect(second.body.sessionExpiresAt).toBe(original);

    // The DB still holds the ORIGINAL deadline after two rotations.
    const doc = await User.findOne({ email });
    expect(doc.sessionExpiresAt.getTime()).toBe(new Date(original).getTime());
  });

  it('once the window is over, refresh is 401 INVALID_REFRESH and the session is killed server-side', async () => {
    const email = `sess-expired-${crypto.randomUUID()}@example.com`;
    const login = await registerAndLogin(email);
    const cookie = extractRefreshCookie(login);

    // Time-travel: force the deadline into the past (no waiting out the TTL).
    await User.updateOne({ email }, { $set: { sessionExpiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app).post(REFRESH).set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH');

    // Killed, not just rejected: the stored hash is gone, so a replayed or
    // stolen cookie cannot ride the session out either.
    const doc = await User.findOne({ email }).select('+refreshTokenHash');
    expect(doc.refreshTokenHash).toBeNull();

    // The stale cookie is cleared for the browser as well.
    expect(res.headers['set-cookie'].join()).toContain('rewear_refreshToken=;');
  });

  it('once the window is over, protected routes 401 even with a still-valid access token', async () => {
    const email = `sess-auth401-${crypto.randomUUID()}@example.com`;
    const login = await registerAndLogin(email);
    const { accessToken } = login.body;

    // Before the deadline the same token works fine.
    const ok = await request(app).get(ME).set('Authorization', `Bearer ${accessToken}`);
    expect(ok.status).toBe(200);

    await User.updateOne({ email }, { $set: { sessionExpiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app).get(ME).set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
