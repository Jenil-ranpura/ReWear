/**
 * Cloudinary wrapper (P4-T2, §6/§18). Centralizes:
 * - isConfigured(): the CLOUDINARY_URL credential is OPTIONAL at boot (§14.4/
 *   §16 — advisory services never block core flows). The upload ENDPOINT is
 *   the one place that hard-requires it; it returns 503 when absent so the
 *   failure is explicit and debuggable rather than a mysterious upload error.
 * - uploadImage(): promise wrapper around cloudinary's upload_stream.
 *
 * Upload params (§6 free tier, cost-aware): fixed folder, overwrite=false,
 * enforced client-side transforms so re-serves stay cached/cheap.
 */

import { v2 as cloudinary } from 'cloudinary';

import env from '../config/env.js';

let configured = false;

function ensureConfigured() {
  if (configured) return;
  if (!env.CLOUDINARY_URL) {
    throw new AppErrorShape(
      503,
      'IMAGE_SERVICE_UNAVAILABLE',
      'Image uploads are not configured on this server.'
    );
  }
  cloudinary.config(true); // load from CLOUDINARY_URL exactly once
  configured = true;
}

// Local shape to avoid importing AppError from middleware into lib (keeps the
// dependency direction lib ← modules, not lib ← middleware). errorHandler
// forwards unknown error shapes with their .status/.code intact.
function AppErrorShape(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.isExpected = true;
  return err;
}

export function isCloudinaryConfigured() {
  try {
    ensureConfigured();
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload a Buffer to Cloudinary.
 * @param {Buffer} buffer raw image bytes (validated by the route first)
 * @param {string} ownerId used for folder organization
 * @returns {Promise<{ publicId: string, url: string, bytes: number }>}
 */
export async function uploadImage(buffer, ownerId) {
  ensureConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `rewear/items/${ownerId}`,
        overwrite: false,
        unique_filename: true,
        resource_type: 'image',
        // Delivery transforms: browser-sized and thumbnail variants are the
        // only forms the frontend needs (§13); originals stay untouched.
        eager: [
          { width: 1200, height: 1200, crop: 'limit', fetch_format: 'auto', quality: 'auto' },
          { width: 400, height: 400, crop: 'limit', fetch_format: 'auto', quality: 'auto' },
        ],
        eager_async: false, // small counts; wait so URLs are immediately usable
      },
      (error, result) => {
        if (error) {
          const err = AppErrorShape(
            502,
            'IMAGE_UPLOAD_FAILED',
            'Image upload failed. Please try again.'
          );
          err.cause = error;
          reject(err);
        } else {
          resolve({ publicId: result.public_id, url: result.secure_url, bytes: result.bytes });
        }
      }
    );
    stream.end(buffer);
  });
}
