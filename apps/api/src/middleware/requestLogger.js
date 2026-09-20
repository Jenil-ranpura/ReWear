/**
 * P1-T3 — Request logger middleware (implementation.md §20).
 * One structured JSON line per finished request:
 * { requestId, method, route, status, durationMs, userId? }
 * userId is attached later by requireAuth (Phase 3); stays null until then.
 */

import { randomUUID } from 'node:crypto';
import logger from '../lib/logger.js';

export default function requestLogger(req, res, next) {
  req.requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    logger.info('request', {
      requestId: req.requestId,
      method: req.method,
      route: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      userId: req.user?.id ?? null,
    });
  });

  next();
}
