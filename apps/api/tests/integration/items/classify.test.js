/**
 * P6-T3 — POST /items/classify integration tests (on mongodb-memory-server).
 * The vision provider is STUBBED via setProvider (no real Groq key burned,
 * no network) — these tests pin the ENDPOINT contract: auth, ownership
 * scoping, validation, and the advisory-only "always 200, null on any
 * failure" shape (§14.4/§16).
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../../../src/app.js';
import { startTestDb, stopTestDb } from '../../../tests/helpers/testDb.js';
import { Item, User } from '../../../src/models/index.js';
import { signAccessToken } from '../../../src/modules/auth/tokens.js';
import { setProvider, resetProvider } from '../../../src/lib/visionClassificationService.js';

const IMAGE_URL = 'https://res.cloudinary.com/demo/image/upload/classify-me.jpg';
const UPLOAD_URL = (userId) =>
  `https://res.cloudinary.com/rewear-cloud/image/upload/v1/rewear/items/${userId}/abc123.jpg`;

let owner;
let other;
let tokenFor;

async function createItem(overrides = {}) {
  const base = {
    ownerId: owner._id,
    title: 'Classify target',
    description: 'An item whose image will be classified.',
    category: 'TOPS',
    type: 'T_SHIRT',
    size: 'M',
    condition: 'GOOD',
    pointValue: 20,
    status: 'APPROVED',
    images: [{ url: IMAGE_URL, isPrimary: true }],
  };
  return Item.create({ ...base, ...overrides });
}

beforeAll(async () => {
  await startTestDb();
  const passwordHash = await bcrypt.hash('Password123!', 4);
  owner = await User.create({
    name: 'Owner',
    email: `owner-${Date.now()}@test.dev`,
    passwordHash,
  });
  other = await User.create({
    name: 'Other',
    email: `other-${Date.now()}@test.dev`,
    passwordHash,
  });
  tokenFor = (user) => signAccessToken(user);
});

afterAll(async () => {
  await stopTestDb();
});

afterEach(() => {
  resetProvider();
});

describe('POST /items/classify (P6-T3)', () => {
  it('returns the suggestion for an image the caller owns (200, advisory shape)', async () => {
    const item = await createItem();
    setProvider({
      classify: async () => ({
        suggestedCategory: 'JACKETS',
        suggestedCondition: 'LIKE_NEW',
        confidence: 0.9,
      }),
    });

    const res = await request(app)
      .post('/api/v1/items/classify')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ imageUrl: IMAGE_URL })
      .expect(200);

    // suggestedPoints is FORMULA-derived (JACKETS × LIKE_NEW = 48) — the
    // endpoint's suggestion is directly form-fillable (§14.4).
    expect(res.body.suggestion).toEqual({
      suggestedCategory: 'JACKETS',
      suggestedCondition: 'LIKE_NEW',
      suggestedPoints: 48,
      confidence: 0.9,
    });
    void item;
  });

  it('returns 200 { suggestion: null } when the AI has no suggestion (low confidence/timeout)', async () => {
    await createItem();
    setProvider({ classify: async () => null });

    const res = await request(app)
      .post('/api/v1/items/classify')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ imageUrl: IMAGE_URL })
      .expect(200);

    expect(res.body).toEqual({ suggestion: null });
  });

  it('returns 200 { suggestion: null } even when classification throws (never a 500)', async () => {
    await createItem();
    setProvider({
      classify: async () => {
        throw new Error('provider exploded');
      },
    });

    const res = await request(app)
      .post('/api/v1/items/classify')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ imageUrl: IMAGE_URL })
      .expect(200);

    expect(res.body).toEqual({ suggestion: null });
  });

  it('returns 200 { suggestion: null } when NO provider is configured', async () => {
    await createItem(); // no setProvider call — the advisory-only boot state

    const res = await request(app)
      .post('/api/v1/items/classify')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ imageUrl: IMAGE_URL })
      .expect(200);

    expect(res.body).toEqual({ suggestion: null });
  });

  it('requires authentication (401)', async () => {
    await createItem();

    await request(app).post('/api/v1/items/classify').send({ imageUrl: IMAGE_URL }).expect(401);
  });

  it('rejects an image URL the caller does NOT own (404 — anti-proxy scoping)', async () => {
    await createItem(); // owned by `owner`

    // `other` tries to classify owner's image — and an arbitrary public URL.
    const foreign = await request(app)
      .post('/api/v1/items/classify')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .send({ imageUrl: IMAGE_URL })
      .expect(404);
    expect(foreign.body.error.code).toBe('NOT_FOUND');

    const arbitrary = await request(app)
      .post('/api/v1/items/classify')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .send({ imageUrl: 'https://example.com/not-mine.jpg' })
      .expect(404);
    expect(arbitrary.body.error.code).toBe('NOT_FOUND');
  });

  it("allows a FRESH upload: a URL in the caller's own Cloudinary upload folder (§5.3 upload-first, no item yet)", async () => {
    // No Item exists referencing this image — the §5.3 create flow classifies
    // the photo BETWEEN upload and item creation. The upload folder is
    // per-owner (`rewear/items/{userId}/`), which is the ownership proof.
    const freshUrl = UPLOAD_URL(owner._id);
    setProvider({
      classify: async () => ({
        suggestedCategory: 'DRESSES',
        suggestedCondition: 'GOOD',
        confidence: 0.8,
      }),
    });

    const res = await request(app)
      .post('/api/v1/items/classify')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ imageUrl: freshUrl })
      .expect(200);

    // DRESSES × GOOD = 45 × 1.0 = 45 (formula-derived, P6-T4).
    expect(res.body.suggestion).toEqual({
      suggestedCategory: 'DRESSES',
      suggestedCondition: 'GOOD',
      suggestedPoints: 45,
      confidence: 0.8,
    });
  });

  it("rejects a fresh-upload URL from ANOTHER user's upload folder (folder-scoped, not cloud-scoped)", async () => {
    const foreignUpload = UPLOAD_URL(other._id);

    const res = await request(app)
      .post('/api/v1/items/classify')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ imageUrl: foreignUpload })
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('validates the body (missing/invalid imageUrl → 400 VALIDATION)', async () => {
    await createItem();
    const token = tokenFor(owner);

    const missing = await request(app)
      .post('/api/v1/items/classify')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    expect(missing.body.error.code).toBe('VALIDATION');

    const malformed = await request(app)
      .post('/api/v1/items/classify')
      .set('Authorization', `Bearer ${token}`)
      .send({ imageUrl: 'not a url' })
      .expect(400);
    expect(malformed.body.error.code).toBe('VALIDATION');
  });
});
