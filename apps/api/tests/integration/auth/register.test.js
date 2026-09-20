/**
 * P3-T1 integration tests — POST /api/v1/auth/register (§5.1/§10/§11/§17).
 * Runs against a real in-memory mongod (mongodb-memory-server): the unique
 * email index, E11000 mapping, and persistence are all exercised for real.
 */

import crypto from 'node:crypto';
import request from 'supertest';

import app from '../../../src/app.js';
import { User } from '../../../src/models/index.js';
import { startTestDb, stopTestDb } from '../../helpers/testDb.js';
import { verifyAccessToken } from '../../../src/modules/auth/tokens.js';

const ROUTE = '/api/v1/auth/register';

const validPayload = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'sup3rSecret!',
};

beforeAll(async () => {
  await startTestDb();
  await User.init(); // wait for the unique email index to be built
});

afterAll(async () => {
  await stopTestDb();
});

describe('POST /api/v1/auth/register', () => {
  it('creates a user: 201, safe user object, usable access token, refresh cookie', async () => {
    const res = await request(app).post(ROUTE).send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'USER',
    });

    // §15: credentials never in response bodies.
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.refreshTokenHash).toBeUndefined();

    // Access token carries { userId, role } (§11) and verifies with our secret.
    const payload = verifyAccessToken(res.body.accessToken);
    expect(payload.role).toBe('USER');

    // §11: refresh token arrives as httpOnly, sameSite=strict cookie — not JSON.
    const cookies = res.headers['set-cookie'];
    const refreshCookie = cookies.find((c) => c.startsWith('rewear_refreshToken='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('SameSite=Strict');
    expect(JSON.stringify(res.body)).not.toContain('refreshToken');

    // Persisted state: lowercased email, default points balance (§5.1).
    const dbUser = await User.findOne({ email: 'ada@example.com' });
    expect(dbUser).not.toBeNull();
    expect(dbUser.pointsBalance).toBe(0);
  });

  it('rejects a short password with 400 VALIDATION (§11: min 8, server-side)', async () => {
    const res = await request(app)
      .post(ROUTE)
      .send({
        ...validPayload,
        email: `short-${crypto.randomUUID()}@example.com`,
        password: 'short',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    const count = await User.countDocuments({ email: /short-/ });
    expect(count).toBe(0);
  });

  it('rejects missing fields with 400 and a field message', async () => {
    const res = await request(app).post(ROUTE).send({ email: 'not-a-user@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/name/i);
  });

  it('maps the Mongo unique index to 409 EMAIL_TAKEN (case-insensitive)', async () => {
    await request(app)
      .post(ROUTE)
      .send({ ...validPayload, email: 'dupe@example.com' });
    const res = await request(app)
      .post(ROUTE)
      .send({ ...validPayload, email: 'DUPE@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects injection-shaped input (§17 security row): object where a string belongs', async () => {
    const res = await request(app)
      .post(ROUTE)
      .send({ name: { $gt: '' }, email: { $gt: '' }, password: { $gt: '' } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(await User.countDocuments({})).toBeLessThan(3); // nothing new created
  });

  it('strips unknown fields from the payload (role escalation attempt)', async () => {
    const res = await request(app)
      .post(ROUTE)
      .send({ ...validPayload, email: `admin-${crypto.randomUUID()}@example.com`, role: 'ADMIN' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('USER'); // §4/§15: never trust client-supplied role
  });

  it('accepts an optional phone, stores it E.164-normalized, and exposes it via the safe user', async () => {
    const res = await request(app)
      .post(ROUTE)
      .send({
        ...validPayload,
        email: `phone-${crypto.randomUUID()}@example.com`,
        phone: '+91 98765 43211',
      });

    expect(res.status).toBe(201);
    expect(res.body.user.phone).toBe('+919876543211');
    const dbUser = await User.findOne({ email: res.body.user.email });
    expect(dbUser.phone).toBe('+919876543211');
  });

  it('rejects junk phones (1234567890 / sequential / same-digit) with 400 — never stored', async () => {
    for (const phone of ['1234567890', '9876543210', '7777777777']) {
      const res = await request(app)
        .post(ROUTE)
        .send({ ...validPayload, email: `junk-${crypto.randomUUID()}@example.com`, phone });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/country code/i);
    }
    expect(await User.countDocuments({ phone: '1234567890' })).toBe(0);
  });

  it('registration works fine WITHOUT a phone (optional stays optional)', async () => {
    const res = await request(app)
      .post(ROUTE)
      .send({
        name: 'No Phone',
        email: `nophone-${crypto.randomUUID()}@example.com`,
        password: 'sup3rSecret!',
      });
    expect(res.status).toBe(201);
    expect(res.body.user.phone ?? null).toBeNull();
  });
});
