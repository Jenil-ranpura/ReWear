/**
 * P3-T2 integration tests — POST /api/v1/auth/login (§5.2/§10/§11/§15/§17).
 * Runs against a real in-memory mongod. Key guarantees covered:
 *  - credential verification + token issuance (§5.2)
 *  - refresh-token rotation on login (§11)
 *  - enumeration resistance: unknown email and wrong password are
 *    indistinguishable — same status, same code, same message (§15)
 *  - banned users cannot log in (§17 manual QA row) and the ban is only
 *    revealed to someone who already knows the correct password
 */

import crypto from 'node:crypto';
import request from 'supertest';

import app from '../../../src/app.js';
import { User } from '../../../src/models/index.js';
import { startTestDb, stopTestDb } from '../../helpers/testDb.js';

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';

const password = 'sup3rSecret!';

async function registerUser(email) {
  const res = await request(app).post(REGISTER).send({ name: 'Login Tester', email, password });
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

describe('POST /api/v1/auth/login', () => {
  it('logs in with valid credentials: 200, safe user, access token, fresh refresh cookie', async () => {
    const email = `login-${crypto.randomUUID()}@example.com`;
    const registered = await registerUser(email);

    const res = await request(app).post(LOGIN).send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.refreshTokenHash).toBeUndefined();
    expect(typeof res.body.accessToken).toBe('string');

    // §11: the refresh cookie is rotated — its value differs from the
    // registration-time cookie.
    const regCookie = registered.headers['set-cookie'].find((c) =>
      c.startsWith('rewear_refreshToken=')
    );
    const loginCookie = res.headers['set-cookie'].find((c) => c.startsWith('rewear_refreshToken='));
    expect(loginCookie).toBeDefined();
    expect(loginCookie).not.toBe(regCookie);
  });

  it('stores only a hash of the rotated refresh token (never the raw token)', async () => {
    const email = `hashcheck-${crypto.randomUUID()}@example.com`;
    await registerUser(email);

    const res = await request(app).post(LOGIN).send({ email, password });
    const raw = res.headers['set-cookie']
      .find((c) => c.startsWith('rewear_refreshToken='))
      .split(';')[0]
      .split('=')[1];

    const dbUser = await User.findOne({ email }).select('+refreshTokenHash');
    expect(dbUser.refreshTokenHash).toBeDefined();
    expect(dbUser.refreshTokenHash).not.toBe(raw);
    expect(dbUser.refreshTokenHash).toHaveLength(64); // sha256 hex
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    const email = `wrongpw-${crypto.randomUUID()}@example.com`;
    await registerUser(email);

    const res = await request(app).post(LOGIN).send({ email, password: 'definitely-wrong' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('Invalid email or password.');
  });

  it('is enumeration-resistant: unknown email is indistinguishable from wrong password (§15)', async () => {
    const email = `exists-${crypto.randomUUID()}@example.com`;
    await registerUser(email);

    const wrongPassword = await request(app)
      .post(LOGIN)
      .send({ email, password: 'definitely-wrong' });
    const unknownEmail = await request(app)
      .post(LOGIN)
      .send({ email: `ghost-${crypto.randomUUID()}@example.com`, password: 'definitely-wrong' });

    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('blocks a banned user with 403 ACCOUNT_BANNED (§17), but only after valid credentials', async () => {
    const email = `banned-${crypto.randomUUID()}@example.com`;
    await registerUser(email);

    // Admin ban action arrives in Phase 4 — flip the flag directly for now.
    await User.updateOne({ email }, { $set: { isBanned: true } });

    const res = await request(app).post(LOGIN).send({ email, password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BANNED');

    // An attacker with the wrong password still gets the generic 401,
    // never the 403 — ban status leaks nothing.
    const attacker = await request(app).post(LOGIN).send({ email, password: 'definitely-wrong' });
    expect(attacker.status).toBe(401);
    expect(attacker.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('normalizes the email (uppercase input logs in the lowercase account)', async () => {
    const email = `normalize-${crypto.randomUUID()}@example.com`;
    await registerUser(email);

    const res = await request(app).post(LOGIN).send({ email: email.toUpperCase(), password });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  it('rejects malformed payloads with 400 VALIDATION', async () => {
    const noPassword = await request(app).post(LOGIN).send({ email: 'x@example.com' });
    expect(noPassword.status).toBe(400);
    expect(noPassword.body.error.code).toBe('VALIDATION');

    const badEmail = await request(app).post(LOGIN).send({ email: 'not-an-email', password });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error.code).toBe('VALIDATION');
  });
});
