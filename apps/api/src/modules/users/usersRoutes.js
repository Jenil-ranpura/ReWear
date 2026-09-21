/**
 * Users routes (§10). Everything here is per-user private data — all routes
 * require auth; ownership is implicit in the "me" scoping (§15 IDOR: the
 * viewer id comes from the token, never the request).
 */

import { Router } from 'express';

import requireAuth from '../../middleware/requireAuth.js';
import validateQuery from '../../middleware/validateQuery.js';
import validate from '../../middleware/validate.js';
// P7-T2: per-USER write limit — MUST mount after requireAuth (bucket key is
// req.user.id; earlier would degrade every request to the per-IP fallback).
import { writeLimiter } from '../../middleware/rateLimit.js';
import { pointsHistoryQuerySchema, profileUpdateSchema } from '@rewear/shared-schemas';
import { getMyItems, getMyPointsHistory, updateMe } from './usersController.js';

const router = Router();

router.use(requireAuth);
// Mounted at /api/v1/users in app.js (same convention as adminRouter).
router.get('/me/items', getMyItems);
router.get('/me/points/history', validateQuery(pointsHistoryQuerySchema), getMyPointsHistory);
// Profile self-service: write-limited (it can change the credential) and
// validated by the SHARED profileUpdateSchema (web form uses the same rules).
router.patch('/me', writeLimiter, validate(profileUpdateSchema), updateMe);

export default router;
