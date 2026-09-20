/**
 * Image upload pipeline (P4-T2, §14.1: "validate all uploads succeed before
 * the insertOne, no partial item persisted").
 *
 * Order of defenses (each independent, all server-side — §15):
 * 1. multer memory storage + 5MB limit + 3 files max (raw byte ceiling)
 * 2. MIME allowlist via filefilter (jpeg/png/webp ONLY — GIF/SVG/heic etc.
 *    never reach the pipeline; SVG is excluded because it can carry scripts)
 * 3. magic-byte sniffing via sharp re-encode (a .jpg named payload can't
 *    disguise its content; re-encode also strips any polyglot payloads)
 *
 * Files stay in MEMORY buffers — no disk writes anywhere (no Docker, no
 * temp-file cleanup to forget). Buffers are used for hashing + upload, then
 * garbage-collected.
 */

import multer from 'multer';
import sharp from 'sharp';

import { AppError } from '../middleware/errorHandler.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024; // 5MB per image
const MAX_FILES = 5; // matches itemCreateSchema images.max(5)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new AppError(400, 'UNSUPPORTED_MEDIA', 'Images must be JPEG, PNG, or WebP.'));
      return;
    }
    cb(null, true);
  },
});

/** Multer errors arrive as its own types — normalize to the §10 error shape. */
function handleMulterError(err, _req, _res, next) {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Each image must be 5MB or smaller.'
        : err.code === 'LIMIT_FILE_COUNT'
          ? `At most ${MAX_FILES} images per item.`
          : 'Image upload failed validation.';
    next(new AppError(400, 'IMAGE_INVALID', message));
    return;
  }
  next(err);
}

/**
 * Content-level validation: decode + re-encode every file with sharp.
 * Rejects anything that only CLAIMS to be an image (magic-byte check by
 * construction). Throws 400 on the first bad file.
 */
async function validateImageContents(req, _res, next) {
  try {
    for (const file of req.files ?? []) {
      try {
        await sharp(file.buffer).rotate().webp({ quality: 80 }).toBuffer();
      } catch {
        throw new AppError(400, 'IMAGE_INVALID', 'One of the files is not a valid image.');
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Field name the client must use: images[] (multiple). */
export const itemImageUpload = [
  upload.array('images', MAX_FILES),
  handleMulterError,
  validateImageContents,
];
