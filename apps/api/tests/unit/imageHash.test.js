/**
 * Unit tests for the perceptual-hash lib (P4-T2). Pure buffer→hash, no DB,
 * no network. Fixtures are generated with sharp at runtime — no binary files
 * in the repo.
 */

import sharp from 'sharp';
import {
  computePerceptualHash,
  hammingDistance,
  normalizeForHash,
} from '../../src/lib/imageHash.js';

async function makeImage({ width = 400, height = 300 } = {}) {
  // Structured gradient + shapes, NOT a solid color: a solid image has zero
  // contrast (every pixel equals the mean), which degenerates aHash to all-zeros.
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e0a050"/><stop offset="100%" stop-color="#204080"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${Math.floor(width * 0.3)}" cy="${Math.floor(height * 0.4)}" r="${Math.floor(height * 0.25)}" fill="#ffffff"/>
    <rect x="${Math.floor(width * 0.55)}" y="${Math.floor(height * 0.2)}" width="${Math.floor(width * 0.3)}" height="${Math.floor(height * 0.6)}" fill="#102010"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

describe('computePerceptualHash (P4-T2)', () => {
  it('produces a 16-char hex string (64-bit aHash)', async () => {
    const hash = await computePerceptualHash(await makeImage());
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic: same pixels → same hash', async () => {
    const buf = await makeImage();
    expect(await computePerceptualHash(buf)).toBe(await computePerceptualHash(buf));
  });

  it('is invariant to rescaling of the same image', async () => {
    const big = await makeImage({ width: 1200, height: 900 });
    const small = await sharp(big).resize(300).jpeg().toBuffer();
    expect(await computePerceptualHash(small)).toBe(await computePerceptualHash(big));
  });

  it('is invariant to 90° EXIF rotation metadata', async () => {
    const base = await makeImage();
    // Orientation 6 = rotate 90 CW; value must be a STRING for sharp exif params.
    const rotated = await sharp(base)
      .withMetadata({ exif: { IFD0: { Orientation: '6' } } })
      .jpeg()
      .toBuffer();
    // Both must hash the UPRIGHT pixels: .rotate() at hash time normalizes.
    const h1 = await computePerceptualHash(base);
    const h2 = await computePerceptualHash(rotated);
    expect(h1).toBe(h2);
  });

  it('gives different images different hashes', async () => {
    // Two structurally different compositions (mirror images of each other).
    const svgA =
      '<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f0f0f0"/><rect x="20" y="20" width="160" height="260" fill="#101010"/><circle cx="300" cy="150" r="90" fill="#303030"/></svg>';
    const svgB =
      '<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f0f0f0"/><rect x="220" y="20" width="160" height="260" fill="#101010"/><circle cx="100" cy="150" r="90" fill="#303030"/></svg>';
    const red = await computePerceptualHash(await sharp(Buffer.from(svgA)).jpeg().toBuffer());
    const blue = await computePerceptualHash(await sharp(Buffer.from(svgB)).jpeg().toBuffer());
    expect(red).not.toBe(blue);
  });
});

describe('hammingDistance (P4-T2)', () => {
  it('is 0 for identical hashes', () => {
    expect(hammingDistance('abcd1234abcd1234', 'abcd1234abcd1234')).toBe(0);
  });

  it('counts differing bits', () => {
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
  });

  it('is Infinity for mismatched lengths', () => {
    expect(hammingDistance('abcd', 'abcdef')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('normalizeForHash (P4-T2)', () => {
  it('outputs metadata-free buffers (sharp default) regardless of input EXIF', async () => {
    const withExif = await sharp(await makeImage())
      .withMetadata({ exif: { IFD0: { Copyright: 'test' } } })
      .toBuffer();
    const normalized = await normalizeForHash(withExif);
    const meta = await sharp(normalized).metadata();
    expect(meta.exif).toBeUndefined();
  });
});
