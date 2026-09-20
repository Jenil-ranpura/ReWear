/**
 * Swap-request schemas (implementation.md §5.5/§5.6/§14.2/§10, shared web↔api).
 * The API validates the PATCH action with swapRequestActionSchema; the web
 * swap panel reuses both schemas so the two sides never drift (§8).
 */

import { object, string } from 'yup';

import { SWAP_TYPE, DIRECT_SWAP, POINTS_REDEMPTION } from './constants.js';
import { optionalPhoneSchema } from './phone.js';

export { DIRECT_SWAP, POINTS_REDEMPTION };

export const SWAP_ACTIONS = Object.freeze(['ACCEPT', 'REJECT', 'CANCEL']);

/**
 * POST /items/:id/swap-requests body. offeredItemId is REQUIRED in the URL
 * param sense for DIRECT_SWAP — the conditional Yup test enforces it here so
 * the client gets a field-level error, not a 500 from the service.
 */
export const swapRequestCreateSchema = object({
  type: string()
    .oneOf(SWAP_TYPE, 'Type must be DIRECT_SWAP or POINTS_REDEMPTION')
    .required('Swap type is required'),
  // Contact reveal (user-requested): the REQUESTER may volunteer a phone for
  // THIS exchange — the owner sees it ONLY if they accept; it is scrubbed
  // from the document on reject/cancel (dead consent must not persist).
  // Validated by the shared real-phone rules (numbering plan + junk guards).
  requesterPhone: optionalPhoneSchema,
  offeredItemId: string()
    .trim()
    .when('type', {
      is: DIRECT_SWAP,
      then: (s) => s.required('An offered item is required for a direct swap'),
      otherwise: (s) => s.notRequired(),
    }),
});

/** PATCH /swap-requests/:id body (§10: ACCEPT|REJECT by owner, CANCEL by requester). */
export const swapRequestActionSchema = object({
  action: string()
    .oneOf(SWAP_ACTIONS, 'Action must be ACCEPT, REJECT, or CANCEL')
    .required('Action is required'),
});
