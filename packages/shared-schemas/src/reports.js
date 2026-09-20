/**
 * Report schemas — user-requested fraud-response scope addition (dispute kit).
 * Shared web↔api (§8): the report dialog and the admin remedy form validate
 * with the EXACT rules the API enforces.
 */

import { object, string } from 'yup';

import { REPORT_REASON, REPORT_REMEDY, REPORT_STATUS } from './constants.js';

export { REPORT_REASON, REPORT_STATUS, REPORT_REMEDY };

/**
 * POST /swap-requests/:id/report body. `details` is bounded like the
 * moderation reason — enough to explain, too long to dump logs into.
 */
export const reportCreateSchema = object({
  reason: string()
    .oneOf(REPORT_REASON, `Reason must be one of: ${REPORT_REASON.join(', ')}`)
    .required('Reason is required'),
  details: string().trim().max(500, 'Details must be at most 500 characters').notRequired(),
});

/**
 * PATCH /admin/reports/:id body — the human remedy. REFUND moves points back
 * via ADJUSTED ledger entries (admin-only path, audited); NONE closes the
 * dispute with a note and no ledger effect. `resolutionNote` is required so
 * every closed dispute carries a human explanation (audit trail).
 */
export const reportResolveSchema = object({
  remedy: string()
    .oneOf(REPORT_REMEDY, 'Remedy must be REFUND or NONE')
    .required('Remedy is required'),
  resolutionNote: string()
    .trim()
    .min(10, 'Resolution note must be at least 10 characters')
    .max(500, 'Resolution note must be at most 500 characters')
    .required('Resolution note is required'),
});
