/**
 * Items routes (§10):
 * - GET / and GET /:id are public (identity attached when a valid token is
 *   present; visibility enforced in the service).
 * - POST / PATCH /:id DELETE /:id require an authenticated user. Ownership
 *   and state guards are re-enforced in the service (§15 IDOR).
 * Status is never client-settable: creation auto-sets PENDING (§14.1), and
 * transitions belong to the swap state machine (§5.7) / admin flow (§5.8).
 */

import { Router } from 'express';

import { itemImageUpload } from '../../lib/imageUpload.js';
import optionalAuth from '../../middleware/optionalAuth.js';
import requireAuth from '../../middleware/requireAuth.js';
// P7-T2: per-USER write limits — MUST mount after requireAuth (bucket key is
// req.user.id; earlier would degrade every request to the per-IP fallback).
import { classifyLimiter, writeLimiter } from '../../middleware/rateLimit.js';
import validate from '../../middleware/validate.js';
import validateQuery from '../../middleware/validateQuery.js';
import {
  browseItemsSchema,
  itemClassifySchema,
  itemCreateSchema,
  itemUpdateSchema,
} from '@rewear/shared-schemas';
import { browse, create, getById, remove, update } from './itemsController.js';
import { uploadItemImages } from './imagesController.js';
import { classifyItem } from './classifyController.js';

const router = Router();

router.get('/', optionalAuth, validateQuery(browseItemsSchema), browse);
router.post('/images', requireAuth, writeLimiter, ...itemImageUpload, uploadItemImages);
// §14.4: BEFORE /:id — Express matches in order; classify is a literal path.
// classifyLimiter is its own tighter bucket (highest-latency endpoint, §23)
// and is deliberately NOT counted against the shared write budget.
router.post('/classify', requireAuth, classifyLimiter, validate(itemClassifySchema), classifyItem);
router.post('/', requireAuth, writeLimiter, validate(itemCreateSchema), create);
router.get('/:id', optionalAuth, getById);
router.patch('/:id', requireAuth, writeLimiter, validate(itemUpdateSchema), update);
router.delete('/:id', requireAuth, writeLimiter, remove);

export default router;
