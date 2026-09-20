/**
 * P3-T5 unit tests — requireAdmin semantics + the mounting convention
 * Phase 4's admin router must follow (requireAuth → requireAdmin).
 */

import requireAdmin from '../../../src/middleware/requireAdmin.js';
import requireAuth from '../../../src/middleware/requireAuth.js';
import { AppError } from '../../../src/middleware/errorHandler.js';

function run(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (err) => resolve(err ?? null));
  });
}

describe('requireAdmin middleware', () => {
  it('calls next() with no error for an ADMIN', async () => {
    const err = await run(requireAdmin, { user: { id: 'u1', role: 'ADMIN' } });
    expect(err).toBeNull();
  });

  it('403 FORBIDDEN for an authenticated plain USER', async () => {
    const err = await run(requireAdmin, { user: { id: 'u2', role: 'USER' } });
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('403 (defensive) when requireAuth was not mounted first — no req.user', async () => {
    const err = await run(requireAdmin, {});
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(403);
  });
});

// Convention guard: both guards are standard (req, res, next) request
// middlewares — arity 3, so Express composes them in the documented order
// requireAuth → requireAdmin and neither is a 4-arg error handler by accident.
describe('middleware chain convention (§11)', () => {
  it('requireAuth is a standard (req, res, next) middleware (arity 3)', () => {
    expect(requireAuth.length).toBe(3);
  });

  it('requireAdmin is a standard (req, res, next) middleware (arity 3)', () => {
    expect(requireAdmin.length).toBe(3);
  });
});
