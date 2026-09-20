/**
 * @rewear/shared-schemas — frozen enum constants (single source of truth, §8).
 * Constants live in their OWN module so schema files (items.js) can import
 * them without going through index.js — index.js re-exports schema modules,
 * and ESM import hoisting would otherwise create a circular-init (TDZ) error.
 */

// --- Swap types (Item→SwapRequest flows, §5.5/§5.6) ---
export const DIRECT_SWAP = 'DIRECT_SWAP';
export const POINTS_REDEMPTION = 'POINTS_REDEMPTION';
export const SWAP_TYPE = Object.freeze([DIRECT_SWAP, POINTS_REDEMPTION]);

export const ITEM_STATUS = Object.freeze([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'RESERVED',
  'PENDING_TRANSFER',
  'SWAPPED',
  'REMOVED',
]);

export const ITEM_CONDITION = Object.freeze(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'WORN']);

/**
 * Canonical item categories (§14.4 constrained AI choice + browse chips).
 * The vision classifier MUST pick from this list (never free-form — browse
 * filters are chip-based and would fragment); nuance belongs in `tags`.
 * OTHER is the escape hatch so the model is never forced to mislabel.
 */
export const ITEM_CATEGORIES = Object.freeze([
  'JACKETS',
  'DRESSES',
  'COATS',
  'TOPS',
  'SHOES',
  'ACCESSORIES',
  'OTHER',
]);

export const SWAP_STATUS = Object.freeze(['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED']);

export const USER_ROLE = Object.freeze(['USER', 'ADMIN']);

export const POINTS_TX_TYPE = Object.freeze(['EARNED', 'SPENT', 'ADJUSTED']);

// --- Admin moderation (§5.8/§10 PATCH /admin/items/:id/moderate) ---
export const ADMIN_ACTIONS = Object.freeze(['APPROVE', 'REJECT']);

// --- Dispute reports (user-requested fraud-response scope addition) ---
export const REPORT_REASON = Object.freeze([
  'NO_SHOW',
  'ITEM_NOT_AS_DESCRIBED',
  'FAKE_ITEM',
  'OTHER',
]);
export const REPORT_STATUS = Object.freeze(['OPEN', 'RESOLVED', 'DISMISSED']);
export const REPORT_REMEDY = Object.freeze(['REFUND', 'NONE']);
