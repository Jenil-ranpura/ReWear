/**
 * P4-T2 — POST /items/images integration tests. Cloudinary is MOCKED (no
 * network in tests); hashing runs for real (sharp). Covers: auth, MIME
 * allowlist, size ceiling, invalid content, unconfigured 503, happy path,
 * and hash persistence through item creation (the §14.1 flag now live).
 */

import request from 'supertest';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

/**
 * Jest ESM mocking: unstable_mockModule MUST be registered BEFORE the target
 * module graph is imported — and since ES static imports all evaluate first,
 * EVERYTHING that (transitively) imports cloudinary.js must be imported
 * dynamically after this call. Getting this wrong silently leaves the route
 * wired to the REAL Cloudinary (it actually uploaded once — logged below).
 * Mocks the network boundary only; lib logic (config checks, params) stays real.
 */
jest.unstable_mockModule('../../../src/lib/cloudinary.js', () => ({
  isCloudinaryConfigured: jest.fn(() => true),
  uploadImage: jest.fn(async (buffer, ownerId) => ({
    publicId: `rewear/items/${ownerId}/fake-${Date.now()}`,
    url: `https://res.cloudinary.com/demo/image/upload/rewear/fake-${Date.now()}.jpg`,
    bytes: buffer.length,
  })),
}));

const { isCloudinaryConfigured, uploadImage } = await import('../../../src/lib/cloudinary.js');
const { default: app } = await import('../../../src/app.js');
const { startTestDb, stopTestDb } = await import('../../../tests/helpers/testDb.js');
const { Item, User } = await import('../../../src/models/index.js');
const { signAccessToken } = await import('../../../src/modules/auth/tokens.js');

async function makeJpeg({
  width = 400,
  height = 300,
  background = { r: 120, g: 80, b: 200 },
} = {}) {
  return sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer();
}

let user;
let token;

beforeAll(async () => {
  await startTestDb();
  const created = await User.create({
    name: 'Uploader',
    email: `uploader-${Date.now()}@test.dev`,
    passwordHash: await bcrypt.hash('Password123!', 4),
  });
  user = await User.findById(created._id);
  token = signAccessToken(user);
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(() => {
  jest.clearAllMocks();
  isCloudinaryConfigured.mockReturnValue(true);
});

describe('POST /items/images (P4-T2)', () => {
  it('uploads, hashes, and returns {url, perceptualHash} pairs — 201', async () => {
    const img = await makeJpeg();

    const res = await request(app)
      .post('/api/v1/items/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('images', img, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(res.body.images).toHaveLength(1);
    expect(res.body.images[0].url).toMatch(/^https:\/\/res\.cloudinary\.com/);
    expect(res.body.images[0].perceptualHash).toMatch(/^[0-9a-f]{16}$/);
    expect(res.body.images[0].isPrimary).toBe(true);
    expect(uploadImage).toHaveBeenCalledTimes(1);
  });

  it('requires authentication', async () => {
    const img = await makeJpeg();
    await request(app)
      .post('/api/v1/items/images')
      .attach('images', img, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(401);
  });

  it('rejects disallowed MIME types (gif/svg/heic) before any processing', async () => {
    const gif = await sharp(await makeJpeg())
      .gif()
      .toBuffer();
    const res = await request(app)
      .post('/api/v1/items/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('images', gif, { filename: 'a.gif', contentType: 'image/gif' })
      .expect(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA');
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('rejects files over the 5MB ceiling', async () => {
    // Random noise: JPEG cannot compress it away (a solid color crushed to
    // ~200KB — useless as an oversized fixture).
    const w = 2000;
    const h = 2000;
    const raw = Buffer.alloc(w * h * 3);
    for (let i = 0; i < raw.length; i += 1) raw[i] = Math.floor(Math.random() * 256);
    const big = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 100 })
      .toBuffer();
    expect(big.length).toBeGreaterThan(5 * 1024 * 1024);

    const res = await request(app)
      .post('/api/v1/items/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('images', big, { filename: 'big.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(res.body.error.code).toBe('IMAGE_INVALID');
    expect(res.body.error.message).toMatch(/5MB/);
  });

  it('rejects non-image content even when the MIME type claims jpeg', async () => {
    const fake = Buffer.from('definitely not an image, just text pretending');

    const res = await request(app)
      .post('/api/v1/items/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('images', fake, { filename: 'fake.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(res.body.error.code).toBe('IMAGE_INVALID');
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('returns 503 IMAGE_SERVICE_UNAVAILABLE when Cloudinary is not configured', async () => {
    isCloudinaryConfigured.mockReturnValue(false);
    const img = await makeJpeg();

    const res = await request(app)
      .post('/api/v1/items/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('images', img, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(503);
    expect(res.body.error.code).toBe('IMAGE_SERVICE_UNAVAILABLE');
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('flows into item creation: persisted hash powers the duplicate-image flag', async () => {
    const img = await makeJpeg({ background: { r: 10, g: 200, b: 10 } });

    const up = await request(app)
      .post('/api/v1/items/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('images', img, { filename: 'green.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const { url, perceptualHash } = up.body.images[0];

    // First item: no flag.
    const first = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Green item',
        description: 'An item with a hashed image attachment.',
        category: 'TOPS',
        type: 'T_SHIRT',
        size: 'M',
        condition: 'GOOD',
        pointValue: 10,
        images: [{ url, perceptualHash }],
      })
      .expect(201);
    expect(first.body.duplicateImageFlagged).toBe(false);

    // The hash really persisted.
    const stored = await Item.findById(first.body.item._id).lean();
    expect(stored.images[0].perceptualHash).toBe(perceptualHash);

    // Second item with the SAME image → flagged (201, never blocked — §14.1).
    const second = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Green item again',
        description: 'Same image attached to a second item listing.',
        category: 'TOPS',
        type: 'T_SHIRT',
        size: 'M',
        condition: 'GOOD',
        pointValue: 10,
        images: [{ url, perceptualHash }],
      })
      .expect(201);
    expect(second.body.duplicateImageFlagged).toBe(true);

    // §14.5: the flag lives where the admin queue reads it — moderationReason
    // is pre-filled on the duplicate, and untouched (null) on the original.
    const dupStored = await Item.findById(second.body.item._id).lean();
    expect(dupStored.moderationReason).toMatch(/duplicate/i);
    expect(stored.moderationReason).toBeNull();
  });
});
