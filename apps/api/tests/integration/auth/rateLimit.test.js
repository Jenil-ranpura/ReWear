/**
 * P3-T6 integration tests — auth rate limiting (§11/§15/§17).
 * Tight limits are set via env BEFORE importing app.js — the config module
 * reads env at boot (fail-fast module), so env must exist first. Supertest's
 * agent shares one IP (stack), which is exactly what the per-IP limiter keys
 * on — perfect for exhausting the budget deterministically.
 */

process.env.AUTH_RATE_LIMIT_MAX = '3';
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';

const request = (await import('supertest')).default;
const crypto = (await import('node:crypto')).default;
const { default: app } = await import('../../../src/app.js'); // default export — env was set above, before this import
const { User } = await import('../../../src/models/index.js');
const { startTestDb, stopTestDb } = await import('../../helpers/testDb.js');

const LOGIN = '/api/v1/auth/login';
const REGISTER = '/api/v1/auth/register';

beforeAll(async () => {
  await startTestDb();
  await User.init();
});

afterAll(async () => {
  await stopTestDb();
});

describe('auth rate limiting (P3-T6)', () => {
  it('429s after the login budget is exhausted, with the §10 error shape', async () => {
    const email = `rl-${crypto.randomUUID()}@example.com`;

    // 3 = full budget (401s — unknown user, but they consume the budget by design).
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).post(LOGIN).send({ email, password: 'whatever123' });
      expect(res.status).toBe(401);
    }

    // 4th attempt: limited.
    const res = await request(app).post(LOGIN).send({ email, password: 'whatever123' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.message).toMatch(/login attempts/i);
  });

  it('keeps per-route counters independent: register still works when login is limited', async () => {
    // Login budget was burned by the previous test (same module-level limiter).
    const res = await request(app)
      .post(REGISTER)
      .send({
        name: 'RL Tester',
        email: `rl-reg-${crypto.randomUUID()}@example.com`,
        password: 'sup3rSecret!',
      });

    expect(res.status).toBe(201); // would be 429 if limiters shared a bucket
  });

  it('429s the register budget too, with its own message', async () => {
    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post(REGISTER)
        .send({
          name: `RL ${i}`,
          email: `rl-burn-${crypto.randomUUID()}@example.com`,
          password: 'sup3rSecret!',
        });
    }
    const res = await request(app)
      .post(REGISTER)
      .send({
        name: 'RL Over',
        email: `rl-over-${crypto.randomUUID()}@example.com`,
        password: 'sup3rSecret!',
      });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.message).toMatch(/signup attempts/i);
  });

  it('exposes standard rate-limit headers on the limited response', async () => {
    const res = await request(app)
      .post(LOGIN)
      .send({ email: 'x@example.com', password: 'whatever123' });
    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.headers['ratelimit']).toBeDefined();
  });
});
