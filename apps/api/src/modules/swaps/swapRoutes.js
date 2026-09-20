/**
 * Swap-request routes (§10). All require an authenticated user; ownership /
 * role rules are enforced in the service (§15 IDOR — two independent guards).
 */

import { Router } from 'express';

import requireAuth from '../../middleware/requireAuth.js';
// P7-T2: per-USER write limit — MUST mount after requireAuth (bucket key is
// req.user.id; earlier would degrade every request to the per-IP fallback).
import { writeLimiter } from '../../middleware/rateLimit.js';
import validate from '../../middleware/validate.js';
import {
  reportCreateSchema,
  swapRequestActionSchema,
  swapRequestCreateSchema,
} from '@rewear/shared-schemas';
import { action, createOnItem, getOne, list, report } from './swapController.js';

const router = Router();

// Mounted at /api/v1 — /items/:id/swap-requests lives on this router too.
router.post(
  '/items/:id/swap-requests',
  requireAuth,
  writeLimiter,
  validate(swapRequestCreateSchema),
  createOnItem
);
router.get('/swap-requests', requireAuth, list);
router.get('/swap-requests/:id', requireAuth, getOne);
router.patch(
  '/swap-requests/:id',
  requireAuth,
  writeLimiter,
  validate(swapRequestActionSchema),
  action
);
// Dispute kit: report a completed swap (participants only — service-enforced).
router.post(
  '/swap-requests/:id/report',
  requireAuth,
  writeLimiter,
  validate(reportCreateSchema),
  report
);

export default router;
