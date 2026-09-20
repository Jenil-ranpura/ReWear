/**
 * requireAdmin (§4/§11): role gate for admin-only routes.
 *
 * MUST be mounted AFTER requireAuth (which guarantees req.user):
 *
 *   router.use('/admin', requireAuth, requireAdmin, adminRouter);
 *   // or per-route: router.post('/x', requireAuth, requireAdmin, handler);
 *
 * Semantics: authenticated but insufficient role → 403 FORBIDDEN (§11: the
 * frontend shows a 403 page for authenticated non-admins). Unauthenticated →
 * 401 from requireAuth. Re-validation happens again in services for anything
 * that mutates state (§15: never trust a single middleware check for IDOR).
 */

import { AppError } from './errorHandler.js';

export default function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'ADMIN') {
    next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
    return;
  }
  next();
}
