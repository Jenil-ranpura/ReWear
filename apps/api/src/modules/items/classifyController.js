/**
 * P6-T3 — POST /items/classify controller (§14.4/§16).
 *
 * Advisory-only by contract: EVERY failure path returns 200 { suggestion:
 * null } — a flaky/absent AI must never look like an error to the client,
 * and the form must always stay submittable manually. Abuse surface is
 * bounded: classification is expensive (an outbound model call), so it is
 * (a) authenticated, (b) limited to images the CALLER owns — never an open
 * proxy, and (c) rate-limited like other item writes.
 *
 * OWNERSHIP, two tiers (the §5.3 flow is UPLOAD-FIRST: the user picks a
 * photo → POST /items/images → gets a URL → classifies it → THEN creates
 * the item — so at classify time the image usually belongs to NO item yet):
 * 1. The URL is stored in `images[]` of one of the caller's items (edit
 *    flow, or a re-classify of an already-listed image), OR
 * 2. The URL is a Cloudinary URL from the caller's OWN upload folder
 *    (`rewear/items/{userId}/…` — the folder uploadImage() fixes per §4-T2).
 *    ASSUMPTION: folder-path matching is advisory-surface only — it is
 *    spoofable in principle but classify() yields a category/condition/
 *    confidence for ONE photo and writes nothing; worst case is a free
 *    image description of a photo in the spoofed folder, never data access.
 *    Unowned, non-upload URLs (arbitrary public images) still 404.
 */

import { Item } from '../../models/index.js';
import { classify } from '../../lib/visionClassificationService.js';

/** The per-owner upload folder the images endpoint pins (see lib/cloudinary.js). */
export function isOwnFreshUpload(imageUrl, userId) {
  try {
    return new URL(imageUrl).pathname.includes(`/rewear/items/${userId}/`);
  } catch {
    return false; // not a parseable URL — schema validation already rejects these
  }
}

export async function classifyItem(req, res) {
  const { imageUrl } = req.body;

  const ownsImage =
    (await Item.exists({
      ownerId: req.user.id,
      'images.url': imageUrl,
    })) || isOwnFreshUpload(imageUrl, req.user.id);
  if (!ownsImage) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'No of your items contains this image URL.' },
    });
  }

  const suggestion = await classify(imageUrl); // never throws (P6-T1)

  return res.status(200).json({ suggestion });
}
