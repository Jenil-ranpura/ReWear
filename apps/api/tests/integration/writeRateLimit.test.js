/**
 * P7-T2 integration tests — per-USER rate limiting on write endpoints (§11).
 * Same env-before-import pattern as tests/integration/auth/rateLimit.test.js:
 * tight limits are set via env BEFORE importing app.js (the config module
 * reads env at boot). Each request from a supertest call comes from the same
 * IP, but these limiters key on req.user.id — so separate accounts get
 * separate budgets, which is exactly what these tests pin down.
 *
 * Write = POST/PATCH/DELETE on items + swap-requests (GETs are never limited).
 * classify has its OWN tighter bucket and is NOT counted against the write
 * budget — a user uploading several photos must not starve their swap
 * requests, and vice versa (mount-order comment in itemsRoutes.js).
 */

process.env.WRITE_RATE_LIMIT_MAX = '3';
process.env.CLASSIFY_RATE_LIMIT_MAX = '2';
process.env.WRITE_RATE_LIMIT_WINDOW_MS = '60000';

const request = (await import('supertest')).default;
const crypto = (await import('node:crypto')).default;
const { default: app } = await import('../../src/app.js'); // env set above, before this import
const { startTestDb, stopTestDb } = await import('../helpers/testDb.js');

const ITEMS = '/api/v1/items';
const CLASSIFY = '/api/v1/items/classify';

function validItemPayload(tag) {
  return {
    title: `Rate limit test item ${tag}`,
    description: 'Created only to exercise the write-endpoint rate limiter.',
    category: 'TOPS',
    type: 'T-shirt',
    size: 'M',
    condition: 'GOOD',
    tags: [],
    images: [
      {
        url: `https://res.cloudinary.com/demo/image/upload/rewear/test/rl-${crypto.randomUUID()}.jpg`,
        isPrimary: true,
      },
    ],
  };
}

async function registerAndGetToken(name) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      name,
      email: `rlw-${crypto.randomUUID()}@example.com`,
      password: 'sup3rSecret!',
    });
  expect(res.status).toBe(201);
  return res.body.accessToken;
}

beforeAll(async () => {
  await startTestDb();
});

afterAll(async () => {
  await stopTestDb();
});

describe('per-user write rate limiting (P7-T2)', () => {
  it('429s after the user exhausts their write budget, with the §10 error shape', async () => {
    const tokenA = await registerAndGetToken('RL Writer');

    // 3 = full budget (successful 201 writes consume it).
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .post(ITEMS)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validItemPayload(i));
      expect(res.status).toBe(201);
    }

    // 4th write: limited.
    const res = await request(app)
      .post(ITEMS)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validItemPayload('over'));
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.message).toMatch(/write requests/i);
  });

  it('keys the bucket per USER: another account still writes while user A is limited', async () => {
    // User A's write budget was exhausted by the previous test.
    const tokenB = await registerAndGetToken('RL Other User');
    const res = await request(app)
      .post(ITEMS)
      .set('Authorization', `Bearer ${tokenB}`)
      .send(validItemPayload('user-b'));

    expect(res.status).toBe(201); // would be 429 if the limiter keyed per IP
  });

  it('classify has its own tighter bucket, independent of the write budget', async () => {
    // User A is write-limited, but classify must still work — separate bucket.
    const tokenA = await registerAndGetToken('RL Classifier');
    // The classify ownership rule (P6-T3) 404s arbitrary URLs — use the
    // caller's OWN upload-folder URL shape, no real upload needed since the
    // provider is unconfigured in tests (advisory-only, §14.4).
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenA}`);
    const userId = me.body.user._id;
    const ownFolderUrl = (n) =>
      `https://res.cloudinary.com/demo/image/upload/rewear/items/${userId}/rl-${n}.jpg`;
    const first = await request(app)
      .post(CLASSIFY)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ imageUrl: ownFolderUrl(1) });
    expect(first.status).toBe(200); // not 429 — proves independence from the write budget
    expect(first.body).toEqual({ suggestion: null }); // no provider configured in tests (§14.4 advisory-only)

    // 2 = full classify budget.
    const second = await request(app)
      .post(CLASSIFY)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ imageUrl: ownFolderUrl(2) });
    expect(second.status).toBe(200);

    // 3rd classify: limited, with its own message.
    const third = await request(app)
      .post(CLASSIFY)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ imageUrl: ownFolderUrl(3) });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    expect(third.body.error.message).toMatch(/classification/i);
  });

  it('never limits reads: GET /items passes for a user with an exhausted write budget', async () => {
    const tokenA = await registerAndGetToken('RL Reader');
    // Burn the write budget (3 + 1 limited — the limited one costs nothing extra).
    for (let i = 0; i < 4; i += 1) {
      await request(app)
        .post(ITEMS)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validItemPayload(`reader-${i}`));
    }
    const res = await request(app).get(ITEMS).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200); // GETs are not limited (§10 browse is public)
  });
});
