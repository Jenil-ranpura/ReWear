/**
 * POST /items/images (P4-T2): upload 1–5 images for a (not yet created) item.
 * The client uploads FIRST, receives [{ url, perceptualHash }], then submits
 * them in the POST /items payload — matching §5.3's flow (upload → create).
 *
 * Order: requireAuth → multer (MIME/size/count) → sharp content check →
 * isConfigured (503) → hash → Cloudinary upload → 201.
 * Per §14.1: any upload failure rejects the whole request — the client gets
 * nothing half-done, and no item references a missing image.
 */

import { computePerceptualHash } from '../../lib/imageHash.js';
import { isCloudinaryConfigured, uploadImage } from '../../lib/cloudinary.js';
import { AppError } from '../../middleware/errorHandler.js';

export async function uploadItemImages(req, res) {
  if (!isCloudinaryConfigured()) {
    throw new AppError(
      503,
      'IMAGE_SERVICE_UNAVAILABLE',
      'Image uploads are not configured on this server.'
    );
  }

  const files = req.files ?? [];
  if (files.length === 0) {
    throw new AppError(400, 'IMAGE_INVALID', 'At least one image file is required.');
  }

  const images = [];
  for (const file of files) {
    const perceptualHash = await computePerceptualHash(file.buffer);
    const { url } = await uploadImage(file.buffer, String(req.user.id));
    images.push({ url, perceptualHash, isPrimary: images.length === 0 });
  }

  res.status(201).json({ images });
}
