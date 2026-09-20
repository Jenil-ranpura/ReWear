/**
 * Item schemas (implementation.md §8/§10/§14.1).
 * browseItemsSchema powers GET /items on BOTH sides (§8): the API validates
 * the query string with it; the web app will reuse it for the filter panel
 * and for building the querystring (P5-T2), so the two can never drift.
 */

import { array, boolean, number, object, string } from 'yup';

import { ITEM_CATEGORIES, ITEM_CONDITION, ITEM_STATUS } from './constants.js';

/**
 * Browse query contract (§10 GET /items row):
 *   category, size, condition, tags, q, page, pageSize (+status for admin).
 * Repeated params (`condition=NEW&condition=GOOD`) or comma lists
 * (`condition=NEW,GOOD`) both arrive as arrays.
 */
/**
 * A single embedded image as submitted by the client (P4-T1: URLs from the
 * client; Cloudinary upload + perceptual hashing land in P4-T2).
 */
const imageInputSchema = object({
  url: string().trim().url('Image must be a valid URL').required('Image URL is required'),
  isPrimary: boolean().default(false),
  // Echoed back from POST /items/images (P4-T2). Format-validated 16-hex
  // (64-bit aHash). Advisory-only: feeds the duplicate-image FLAG (§14.1),
  // which never blocks — a spoofed hash can at worst skew a flag.
  perceptualHash: string()
    .trim()
    .matches(/^[0-9a-f]{16}$/, 'Invalid perceptual hash')
    .notRequired(),
});

/**
 * Item FIELDS only (no images). Split out because the web form (P5-T4)
 * manages images in separate uploader state, not in React-Hook-Form values —
 * validating the image list inside the form resolver would fail even when a
 * photo IS attached. The API still validates the FULL composite schemas
 * below (server-side §15 validation is unchanged); the form checks image
 * count explicitly before submit.
 */
/**
 * POST /items/classify body (§14.4/§10): just the image URL to classify —
 * the upload must already exist (created via POST /items/images).
 */
export const itemClassifySchema = object({
  imageUrl: string().trim().url('imageUrl must be a valid URL').required('imageUrl is required'),
});

export const itemFieldsSchema = object({
  title: string()
    .trim()
    .min(3, 'Title must be at least 3 characters')
    .max(100)
    .required('Title is required'),
  description: string()
    .trim()
    .min(10, 'Description must be at least 10 characters')
    .max(2000)
    .required('Description is required'),
  // Constrained to the canonical list (Session 12): the web form renders it
  // as a dropdown like Condition, and the AI already picks from this exact
  // enum (§14.4) — browse chips would fragment otherwise.
  category: string()
    .trim()
    .oneOf(ITEM_CATEGORIES, `Category must be one of: ${ITEM_CATEGORIES.join(', ')}`)
    .required('Category is required'),
  type: string().trim().min(2).max(60).required('Type is required'),
  size: string().trim().min(1).max(20).required('Size is required'),
  condition: string()
    .oneOf(ITEM_CONDITION, 'Condition must be one of: NEW, LIKE_NEW, GOOD, FAIR, WORN')
    .required('Condition is required'),
  tags: array().of(string().trim().min(1).max(40)).max(10, 'At most 10 tags').default([]),
  // NOT client-settable (Session 13, §14.4 revised): the API derives pointValue
  // as basePoints[category] × conditionMultiplier[condition] and IGNORES the
  // client copy — the economy cannot be skewed by smuggling 3000. The schema
  // intentionally does NOT 400 on odd client values: the transform fails
  // closed, dropping garbage (non-integer, <1, >1000) to undefined so the
  // request validates and the smuggled number simply never reaches storage.
  // The service OVERWRITES whatever arrives with the derived value.
  pointValue: number()
    .transform((_v, orig) => {
      if (orig === '' || orig == null) return undefined;
      const n = typeof orig === 'number' ? orig : Number(orig);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 1000) {
        return undefined;
      }
      return n;
    })
    .notRequired(),
});

/**
 * Item creation (§14.1): all required fields, condition in enum, ≥1 image.
 * NOTE: status is deliberately NOT in the schema — creation always lands in
 * PENDING (§5.3) and the server sets it; the client can never submit it.
 */
export const itemCreateSchema = itemFieldsSchema.concat(
  object({
    images: array()
      .of(imageInputSchema)
      .min(1, 'At least one image is required')
      .max(5, 'At most 5 images')
      .required('At least one image is required'),
  })
);

/**
 * Item update (§10 PATCH /items/:id): all fields optional, same constraints.
 * Status is NOT updatable here — transitions belong to the swap state machine
 * (§5.7) and admin moderation (§5.8).
 */
export const itemUpdateSchema = object({
  title: string().trim().min(3, 'Title must be at least 3 characters').max(100),
  description: string().trim().min(10, 'Description must be at least 10 characters').max(2000),
  // Same canonical constraint as create (single source of truth).
  category: string()
    .trim()
    .oneOf(ITEM_CATEGORIES, `Category must be one of: ${ITEM_CATEGORIES.join(', ')}`),
  type: string().trim().min(2).max(60),
  size: string().trim().min(1).max(20),
  condition: string().oneOf(
    ITEM_CONDITION,
    'Condition must be one of: NEW, LIKE_NEW, GOOD, FAIR, WORN'
  ),
  tags: array().of(string().trim().min(1).max(40)).max(10, 'At most 10 tags'),
  // Same derivation rule as create (Session 13): PATCH payloads never set
  // points — the service strips the client copy BEFORE Object.assign and
  // recomputes from the merged category × condition when either changes.
  pointValue: number()
    .transform((_v, orig) => {
      if (orig === '' || orig == null) return undefined;
      const n = typeof orig === 'number' ? orig : Number(orig);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 1000) {
        return undefined;
      }
      return n;
    })
    .notRequired(),
  images: array()
    .of(imageInputSchema)
    .min(1, 'At least one image is required')
    .max(5, 'At most 5 images'),
});

/**
 * GET /users/me/points/history query (§10 users rows): paginated ledger,
 * never unbounded. shape mirrors the admin pagination convention.
 */
export const pointsHistoryQuerySchema = object({
  page: number()
    .transform((v, orig) => (orig === '' || orig == null ? undefined : v))
    .integer()
    .min(1)
    .default(1),
  pageSize: number()
    .transform((v, orig) => (orig === '' || orig == null ? undefined : v))
    .integer()
    .min(1)
    .max(60)
    .default(20),
});

export const browseItemsSchema = object({
  category: array().of(string().trim().max(60)).default([]),
  size: array().of(string().trim().max(20)).default([]),
  condition: array().of(string().oneOf(ITEM_CONDITION, 'Unknown condition filter')).default([]),
  tags: array().of(string().trim().max(40)).default([]),
  q: string().trim().max(120).default(''),
  // Location filter (user-requested scope addition): free-text contains-match
  // against the OWNER'S profile location. Free-text (not an enum) on purpose —
  // User.location is free text today, so "mumbai" must match "Mumbai, MH".
  // Bounded like q; the service turns it into a sanitize-safe owner-id list.
  location: string().trim().max(120).default(''),
  // Admin-only override; validated as a valid status but AUTHORIZED in the
  // service layer (non-admins are force-forced to APPROVED regardless).
  status: string().oneOf(ITEM_STATUS).notRequired(),
  featured: boolean().notRequired(),
  page: number()
    .transform((v, orig) => (orig === '' || orig == null ? undefined : v))
    .integer()
    .min(1)
    .default(1),
  pageSize: number()
    .transform((v, orig) => (orig === '' || orig == null ? undefined : v))
    .integer()
    .min(1)
    .max(60) // hard ceiling — never return unbounded lists (§ "never unbounded")
    .default(20),
});
