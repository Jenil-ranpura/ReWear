/**
 * Perceptual image hashing (P4-T2, §14.1 duplicate detection, §9.1 index).
 *
 * Pipeline: decode with sharp → auto-rotate (EXIF) → strip metadata → resize
 * to a fixed 16×16 grayscale → 64-bit average-hash (aHash), hex-encoded.
 *
 * Why this shape:
 * - The multikey index { 'images.perceptualHash': 1 } (§9.1) supports exact
 *   matches on these hex strings — identical images hash identically.
 * - Normalizing (rotate + fixed size + grayscale) before hashing makes the
 *   hash robust to EXIF rotation and rescaling, the two variations re-uploads
 *   of the SAME photo typically have.
 * - aHash is deliberately approximate: near-duplicates (re-encodes, slight
 *   crops) usually produce hashes within a small Hamming distance. Exact
 *   match is the §14.1 flag; Hamming distance is available for future
 *   "similar items" work without re-hashing.
 *
 * Pure function over a Buffer — trivially unit-testable, no I/O.
 */

import sharp from 'sharp';

const HASH_SIZE = 8; // 8×8 = 64 pixels → 1 bit each → 64-bit hash (classic aHash)

/**
 * Normalize a buffer for hashing (shared by hashing and any future
 * thumbnail/derivative work): EXIF-safe rotate, cap size. Metadata note:
 * sharp writes EXIF/metadata into output ONLY when .withMetadata() is
 * requested — by default output buffers are already metadata-free, so no
 * explicit strip call is needed (and .removeMetadata() does not exist).
 */
export async function normalizeForHash(buffer) {
  return sharp(buffer)
    .rotate() // honor EXIF orientation, output upright pixels
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .toBuffer();
}

/**
 * Compute the 64-bit perceptual hash of an image buffer.
 * @param {Buffer} buffer raw image bytes (JPEG/PNG/WebP)
 * @returns {Promise<string>} 16-char hex string
 */
export async function computePerceptualHash(buffer) {
  const normalized = await normalizeForHash(buffer);

  const { data, info } = await sharp(normalized)
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' }) // fixed grid, no aspect distortion
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Average luminance → bits: 1 for above-average pixels (aHash).
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i];
  const mean = sum / data.length;

  // 64 pixels → 64 bits → 16 hex chars (4 bits per nibble), MSB-first,
  // row-major over the 8×8 grid.
  let hex = '';
  for (let i = 0; i < data.length; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4 && i + b < data.length; b += 1) {
      nibble = (nibble << 1) | (data[i + b] > mean ? 1 : 0);
    }
    hex += nibble.toString(16);
  }
  void info; // dimensions not needed; kept for debugging clarity
  return hex;
}

/**
 * Hamming distance between two equal-length hex hashes — how many bits differ.
 * 0 = identical. Small values (≈ ≤10 of 64) suggest near-duplicates.
 */
export function hammingDistance(hashA, hashB) {
  if (hashA.length !== hashB.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < hashA.length; i += 1) {
    let x = Number.parseInt(hashA[i], 16) ^ Number.parseInt(hashB[i], 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}
