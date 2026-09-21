/**
 * Admin moderation schemas (implementation.md §5.8/§9.1/§10, shared web↔api).
 * The API validates the moderate/ban bodies and the users-list query with
 * these; the web admin panel (Phase 5/7) reuses them so the two sides never
 * drift (§8). User search is intentionally LENIENT (§3 "lightweight
 * oversight") — same spirit as the browse q filter.
 */

import { object, string, boolean, number } from 'yup';

import { ADMIN_ACTIONS } from './constants.js';

export { ADMIN_ACTIONS };

/**
 * PATCH /admin/items/:id/moderate body (§5.8): action required, reason
 * optional for APPROVE/REJECT (but encouraged for REJECT — the UI nudges).
 * REMOVE (post-approval takedown of live items) REQUIRES a reason: removing
 * an already-public listing is consequential — the owner deserves an
 * explanation and the audit trail must carry one. Status itself is never
 * client-submitted; the action decides it.
 */
export const moderateItemSchema = object({
  action: string()
    .oneOf(ADMIN_ACTIONS, 'Action must be one of: APPROVE, REJECT, REMOVE')
    .required('Action is required'),
  reason: string()
    .trim()
    .max(500, 'Reason must be at most 500 characters')
    .when('action', {
      is: 'REMOVE',
      then: (s) => s.required('A reason is required when removing a live listing'),
      otherwise: (s) => s.notRequired(),
    }),
});

/**
 * GET /admin/items query — the live-monitoring list (post-approval
 * oversight). status defaults to APPROVED (what's public RIGHT NOW); REMOVED
 * shows the takedown trail; q searches title (escaped server-side). Bounded
 * pagination like every list.
 */
export const adminItemsQuerySchema = object({
  status: string().oneOf(['APPROVED', 'REMOVED'], 'Unknown status filter').default('APPROVED'),
  q: string().trim().max(120).default(''),
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

/**
 * GET /admin/items/pending query (§10): pagination only — the queue has no
 * filters by design (§3 "lightweight oversight", oldest-first fair order).
 */
export const adminQueueQuerySchema = object({
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

/**
 * GET /admin/users query (§10: "search/filter"): q matches name/email,
 * role/banned are exact filters, page/pageSize bounded (never unbounded).
 */
export const adminUsersQuerySchema = object({
  q: string().trim().max(120).default(''),
  role: string().oneOf(['USER', 'ADMIN'], 'Unknown role filter').notRequired(),
  banned: boolean().notRequired(),
  page: number()
    .transform((v, orig) => (orig === '' || orig == null ? undefined : v))
    .integer()
    .min(1)
    .default(1),
  pageSize: number()
    .transform((v, orig) => (orig === '' || orig == null ? undefined : v))
    .integer()
    .min(1)
    .max(60) // same ceiling as browse — never unbounded (§ "never unbounded")
    .default(20),
});

/**
 * PATCH /admin/users/:id/ban body (§10): banned required; reason stored on
 * the AdminAction audit row. Unban passes banned:false (reason optional).
 */
export const adminBanSchema = object({
  banned: boolean().required('Banned flag is required'),
  reason: string().trim().max(500, 'Reason must be at most 500 characters').notRequired(),
});
