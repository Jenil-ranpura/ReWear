/**
 * P4-T6 — Admin routes (§10), mounted at /api/v1/admin in app.js behind the
 * P3-T5 convention: requireAuth → requireAdmin (role check, 403 FORBIDDEN).
 * Body/query validation uses the SHARED admin schemas (§8 — the web admin
 * panel reuses the exact same rules).
 */

import { Router } from 'express';

import requireAuth from '../../middleware/requireAuth.js';
import requireAdmin from '../../middleware/requireAdmin.js';
import validate from '../../middleware/validate.js';
import validateQuery from '../../middleware/validateQuery.js';
import {
  adminBanSchema,
  adminItemsQuerySchema,
  adminQueueQuerySchema,
  adminUsersQuerySchema,
  moderateItemSchema,
  reportResolveSchema,
} from '@rewear/shared-schemas';
import {
  adminItems,
  ban,
  moderate,
  pendingQueue,
  reports,
  resolve,
  userDetail,
  users,
} from './adminController.js';

const router = Router();

// Everything below is admin-only (§10 role column).
router.use(requireAuth, requireAdmin);

router.get('/items/pending', validateQuery(adminQueueQuerySchema), pendingQueue);
// Live-monitoring list (post-approval oversight) — BEFORE any /:id route
// pattern concerns (it's a distinct literal path, same convention as
// itemsRoutes' classify-before-:id).
router.get('/items', validateQuery(adminItemsQuerySchema), adminItems);

router.patch('/items/:id/moderate', validate(moderateItemSchema), moderate);

router.get('/users', validateQuery(adminUsersQuerySchema), users);

// Investigation view (evidence kit) — full context about ONE user: profile,
// items, swaps, points ledger, reports by/against them, admin actions.
// Declared BEFORE the ban route is unnecessary (different methods), but
// grouped with /users for readability.
router.get('/users/:id', userDetail);

router.patch('/users/:id/ban', validate(adminBanSchema), ban);

// Dispute queue + human remedy (§ fraud kit). Status filter validated
// inline in the controller path via listReports (only 'open' is offered by
// the UI; anything else lists all — admin-only surface, low risk).
router.get('/reports', reports);
router.patch('/reports/:id', validate(reportResolveSchema), resolve);

export default router;
