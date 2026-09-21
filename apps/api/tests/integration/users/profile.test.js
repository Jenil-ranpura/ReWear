/**
 * PATCH /users/me — profile self-service integration tests.
 *
 * Covers: auth required, whitelist trust model (role/pointsBalance/email
 * stripping), name/phone edits (E.164 normalization + clearing), the
 * password-change flow (re-authentication required, wrong password refused,
 * re-login with the new password), unknown-key stripping (validate
 * middleware), and the §10 error shape.
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../../../src/app.js';
import { startTestDb, stopTestDb } from '../../../tests/helpers/testDb.js';
import { User } from '../../../src/models/index.js';
import { signAccessToken } from '../../../src/modules/auth/tokens.js';

let admin;
let adminToken;

let me;
let token;

beforeAll(async () => {
  await startTestDb();
  me = await User.create({
    name: 'Ada Lovelace',
    email: `profile-${Date.now()}@test.dev`,
    passwordHash: await bcrypt.hash('OldPassword123!', 10),
    phone: '+919876543210',
    location: 'Mumbai',
  });
  token = signAccessToken(me);
  admin = await User.create({
    name: 'Admin',
    email: `profile-admin-${Date.now()}@test.dev`,
    passwordHash: await bcrypt.hash('AdminPassword123!', 10),
    role: 'ADMIN',
  });
  adminToken = signAccessToken(admin);
});

afterAll(async () => {
  await stopTestDb();
});

function patch(body) {
  return request(app).patch('/api/v1/users/me').set('Authorization', `Bearer ${token}`).send(body);
}

describe('PATCH /users/me — auth', () => {
  it('401s without a token', async () => {
    await request(app).patch('/api/v1/users/me').send({ name: 'New Name' }).expect(401);
  });

  it('403s an ADMIN — profile self-service is a USER-only feature (product decision)', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Admin Renamed' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    // The admin's account is untouched.
    const doc = await User.findById(admin._id).lean();
    expect(doc.name).toBe('Admin');
  });
});

describe('PATCH /users/me — name + phone edits', () => {
  it('updates name and returns the safe user shape', async () => {
    const res = await patch({ name: 'Ada K.' }).expect(200);

    expect(res.body.user.name).toBe('Ada K.');
    // §15: credentials never leave the API, even on a self-read/write.
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.refreshTokenHash).toBeUndefined();
    // Untouched fields survive.
    expect(res.body.user.email).toBe(me.email);
    expect(res.body.user.location).toBe('Mumbai');
  });

  it('normalizes a valid phone to E.164', async () => {
    const res = await patch({ name: me.name, phone: '+91 98765 43211' }).expect(200);
    expect(res.body.user.phone).toBe('+919876543211');

    const doc = await User.findById(me._id);
    expect(doc.phone).toBe('+919876543211');
  });

  it('clears the phone with an empty string', async () => {
    const res = await patch({ name: me.name, phone: '' }).expect(200);
    expect(res.body.user.phone).toBeNull();

    const doc = await User.findById(me._id);
    expect(doc.phone).toBeNull();
  });

  it('rejects junk phones with 400 VALIDATION (shared schema)', async () => {
    // The user's canonical junk number: format-plausible, heuristics-rejected.
    await patch({ name: me.name, phone: '1234567890' }).expect(400);
    await patch({ name: me.name, phone: '7777777777' }).expect(400);
    // No country code → not dialable → rejected.
    await patch({ name: me.name, phone: '9876543210' }).expect(400);
  });

  it('rejects a too-short name and strips unknown keys', async () => {
    await patch({ name: 'A' }).expect(400);
    await patch({ name: '' }).expect(400);

    // Unknown/derived keys are stripped (validate middleware), NOT persisted —
    // the request succeeds but role/points/email never move. Trust model:
    // same as item pointValue/ownerId.
    const res = await patch({
      name: 'Still Ada',
      role: 'ADMIN',
      pointsBalance: 999999,
      email: 'attacker@evil.dev',
      isBanned: false,
    }).expect(200);

    expect(res.body.user.role).toBe('USER');
    expect(res.body.user.pointsBalance).toBe(me.pointsBalance);
    expect(res.body.user.email).toBe(me.email);
  });
});

describe('PATCH /users/me — password change', () => {
  it('refuses a password change without currentPassword (400, shared schema)', async () => {
    await patch({ name: me.name, password: 'NewPassword123!' }).expect(400);
    const doc = await User.findById(me._id).select('+passwordHash');
    expect(bcrypt.compareSync('OldPassword123!', doc.passwordHash)).toBe(true);
  });

  it('refuses a WRONG currentPassword with 403 INVALID_CREDENTIALS', async () => {
    const res = await patch({
      name: me.name,
      currentPassword: 'WrongPassword!',
      password: 'NewPassword123!',
    }).expect(403);

    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    const doc = await User.findById(me._id).select('+passwordHash');
    expect(bcrypt.compareSync('OldPassword123!', doc.passwordHash)).toBe(true);
  });

  it('changes the password with a correct currentPassword; old stops working, new logs in', async () => {
    await patch({
      name: me.name,
      currentPassword: 'OldPassword123!',
      password: 'NewPassword123!',
    }).expect(200);

    const doc = await User.findById(me._id).select('+passwordHash');
    expect(bcrypt.compareSync('NewPassword123!', doc.passwordHash)).toBe(true);
    expect(bcrypt.compareSync('OldPassword123!', doc.passwordHash)).toBe(false);

    // The new password is live on the login path.
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: me.email, password: 'NewPassword123!' })
      .expect(200);
  });

  it('rejects a too-short new password (400, shared rule with register)', async () => {
    await patch({ name: me.name, currentPassword: 'NewPassword123!', password: 'short' }).expect(
      400
    );
  });

  it('accepts a password change together with name/phone in one request', async () => {
    const res = await patch({
      name: 'Ada Final',
      phone: '+919876543212',
      currentPassword: 'NewPassword123!',
      password: 'FinalPassword123!',
    }).expect(200);

    expect(res.body.user.name).toBe('Ada Final');
    expect(res.body.user.phone).toBe('+919876543212');
    const doc = await User.findById(me._id).select('+passwordHash');
    expect(bcrypt.compareSync('FinalPassword123!', doc.passwordHash)).toBe(true);
  });
});
