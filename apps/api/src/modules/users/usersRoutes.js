/**
 * Users routes (§10). Everything here is per-user private data — all routes
 * require auth; ownership is implicit in the "me" scoping (§15 IDOR: the
 * viewer id comes from the token, never the request).
 */

import { Router } from 'express';

import requireAuth from '../../middleware/requireAuth.js';
import validateQuery from '../../middleware/validateQuery.js';
import { pointsHistoryQuerySchema } from '@rewear/shared-schemas';
import { getMyItems, getMyPointsHistory } from './usersController.js';

const router = Router();

router.use(requireAuth);
// Mounted at /api/v1/users in app.js (same convention as adminRouter).
router.get('/me/items', getMyItems);
router.get('/me/points/history', validateQuery(pointsHistoryQuerySchema), getMyPointsHistory);

export default router;
