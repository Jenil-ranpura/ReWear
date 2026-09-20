/**
 * @rewear/shared-schemas — shared Yup schemas + status-enum constants.
 * See implementation.md §8: this package keeps web and api from drifting
 * apart on what a valid status value is.
 *
 * Structure note: constants live in constants.js; schema modules import them
 * from there (NOT from this file) — ESM import hoisting makes re-export
 * cycles a TDZ hazard (learned the hard way in P4-T3).
 */

// --- Constants (single source of truth for enums) ---
export * from './constants.js';

// --- §14.4 points formula (shared so the web form renders the SAME fixed
// tables the API computes suggestedPoints from — the AI never sets points) ---
export { BASE_POINTS, CONDITION_MULTIPLIERS, computeSuggestedPoints } from './pointsFormula.js';

// --- Yup validation schemas (shared web ↔ api, §8/§12) ---
export { registerSchema, loginSchema } from './auth.js';
export {
  browseItemsSchema,
  itemFieldsSchema,
  itemCreateSchema,
  itemUpdateSchema,
  itemClassifySchema,
  pointsHistoryQuerySchema,
} from './items.js';
export { swapRequestCreateSchema, swapRequestActionSchema } from './swaps.js';
export {
  reportCreateSchema,
  reportResolveSchema,
  REPORT_REASON,
  REPORT_STATUS,
  REPORT_REMEDY,
} from './reports.js';
export {
  isValidRealPhone,
  normalizePhone,
  PHONE_ERROR,
  optionalPhoneSchema,
  requiredPhoneSchema,
} from './phone.js';
export {
  moderateItemSchema,
  adminQueueQuerySchema,
  adminUsersQuerySchema,
  adminBanSchema,
} from './admin.js';
