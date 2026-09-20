/**
 * Rate limiting (§11/§15): /auth/login and /auth/register are limited per IP
 * to slow credential stuffing and bulk account creation. P7-T2 adds the
 * per-user write-endpoint limits (writeLimiter / classifyLimiter).
 *
 * Bucket map (each is a SEPARATE express-rate-limit instance so budgets
 * never bleed into each other):
 * - registerLimiter / loginLimiter — per IP (no session exists yet).
 * - writeLimiter  — per USER, shared by item + swap write endpoints.
 * - classifyLimiter — per USER, classify only: the one write-adjacent call
 *   that fans out to a paid/latency-bound external API (§23: the highest-
 *   latency endpoint), so it gets the tightest bucket and its own budget.
 *   It is deliberately NOT counted against the plain write budget — a user
 *   uploading several photos must not starve their own swap requests.
 *
 * Design notes:
 * - Separate limiter instances per route: exhausting the login budget must
 *   not lock a legitimate user out of registering (and vice versa).
 * - The limiter runs BEFORE body validation, so garbage-payload spam counts
 *   toward the budget too.
 * - Limited responses keep the §10 error shape and expose draft-7 rate-limit
 *   headers (Retry-After) so well-behaved clients can back off.
 * - `trust proxy` is set (app.js) — required for correct per-IP keying behind
 *   Railway/Render/Vercel; express-rate-limit refuses to trust X-Forwarded-For
 *   otherwise.
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import env from '../config/env.js';

export function createRateLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message },
      });
    },
  });
}

/**
 * Per-user variant (P7-T2): keys the bucket on the authenticated user id.
 * Must be mounted AFTER requireAuth — req.user does not exist before it, so
 * an earlier mount would silently degrade every request to the req.ip
 * fallback and lump all anonymous traffic into one bucket.
 */
export function createUserRateLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // ipKeyGenerator: express-rate-limit's validation requires IPv6 addresses
    // to go through this helper (ERR_ERL_KEY_GEN_IPV6) — a plain req.ip
    // fallback lets IPv6 users spread across subnets bypass the bucket.
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message },
      });
    },
  });
}

const AUTH_WINDOW = env.AUTH_RATE_LIMIT_WINDOW_MS;

export const registerLimiter = createRateLimiter({
  windowMs: AUTH_WINDOW,
  max: env.AUTH_RATE_LIMIT_MAX,
  message: 'Too many signup attempts. Please try again later.',
});

export const loginLimiter = createRateLimiter({
  windowMs: AUTH_WINDOW,
  max: env.AUTH_RATE_LIMIT_MAX,
  message: 'Too many login attempts. Please try again later.',
});

// ── P7-T2: per-USER write-endpoint limits (§11: "write endpoints limited
// per user"). These run AFTER requireAuth (mount order in the route files)
// so the bucket key is the authenticated user id — token-based, not IP-based
// (a shared office/NAT IP must not lump colleagues into one budget).
const WRITE_WINDOW = env.WRITE_RATE_LIMIT_WINDOW_MS;

export const writeLimiter = createUserRateLimiter({
  windowMs: WRITE_WINDOW,
  max: env.WRITE_RATE_LIMIT_MAX,
  message: 'Too many write requests. Please slow down and try again shortly.',
});

export const classifyLimiter = createUserRateLimiter({
  windowMs: WRITE_WINDOW,
  max: env.CLASSIFY_RATE_LIMIT_MAX,
  message: 'Too many classification requests. Please wait a moment before trying again.',
});
