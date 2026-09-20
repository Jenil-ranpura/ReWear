/**
 * JWT helpers (implementation.md §11).
 * Access token: short-lived, carries { userId, role }, sent in JSON bodies.
 * Refresh token: longer-lived, random + opaque, stored HASHED in the users
 * collection and delivered via httpOnly cookie — never in response bodies.
 */

import { randomBytes, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';

import env from '../../config/env.js';

export function signAccessToken(user) {
  return jwt.sign({ userId: String(user._id), role: user.role }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

/** Opaque refresh token (§11: rotated on every refresh — rotation lands in P3-T3). */
export function generateRefreshToken() {
  return randomBytes(48).toString('hex');
}

/** Only the SHA-256 hash of a refresh token is ever persisted (§15). */
export function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export const REFRESH_COOKIE = 'rewear_refreshToken';

/**
 * Fixed session window (§11, user request): absolute deadline stamped at
 * login/register. Refresh rotates the token but never extends this — once it
 * passes, refresh and every protected route reject (auto-logout).
 */
export function sessionDeadline() {
  return new Date(Date.now() + env.SESSION_TTL_MINUTES * 60 * 1000);
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction, // https-only in production (§11)
    sameSite: 'strict', // §11/§15 CSRF mitigation
    path: '/api/v1/auth', // scoped to the auth routes that use it
    // The cookie cannot outlive the fixed session window (§11, user request):
    // a browser that kept the tab open past the deadline must not be able to
    // silently ride a long-lived cookie into a new session.
    maxAge: env.SESSION_TTL_MINUTES * 60 * 1000,
  };
}
