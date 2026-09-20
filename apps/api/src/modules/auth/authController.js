/**
 * Auth controller (§5.1/§5.2/§10): thin HTTP layer — req.body is already
 * validated and normalized by the validate middleware (shared Yup schemas);
 * delegate to the service, manage the refresh cookie, respond. Express 5
 * forwards rejected async handlers to the global error middleware (§16).
 */

import { loginUser, logoutUser, refreshTokens, registerUser, toSafeUser } from './authService.js';
import { REFRESH_COOKIE, refreshCookieOptions } from './tokens.js';

export async function register(req, res) {
  const { user, tokens, sessionExpiresAt } = await registerUser(req.body);

  res
    .status(201)
    .cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions())
    .json({ user, accessToken: tokens.accessToken, sessionExpiresAt });
}

export async function login(req, res) {
  const { user, tokens, sessionExpiresAt } = await loginUser(req.body);

  res
    .status(200)
    .cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions())
    .json({ user, accessToken: tokens.accessToken, sessionExpiresAt });
}

export async function refresh(req, res) {
  try {
    const tokens = await refreshTokens(req.cookies?.[REFRESH_COOKIE]);

    // §11: rotate the cookie on every refresh. sessionExpiresAt echoes the
    // (unchanged) absolute session deadline — the client arms its auto-logout
    // timer from it and can see that rotation never extended the window.
    res
      .status(200)
      .cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions())
      .json({ accessToken: tokens.accessToken, sessionExpiresAt: tokens.sessionExpiresAt });
  } catch (err) {
    // A stale/invalid cookie should not linger in the browser — clear it so
    // the client falls back to a clean login on its next attempt.
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    throw err;
  }
}

/**
 * POST /auth/logout (§10): 204. Requires auth; server-side session
 * invalidation plus clearing the refresh cookie. Idempotent.
 */
export async function logout(req, res) {
  await logoutUser(req.user.id);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  res.status(204).send();
}

/**
 * GET /auth/me (§10): 200 { user } — the safe serialization, credentials
 * stripped (§15). req.user.user was fetched fresh by requireAuth.
 */
export async function me(req, res) {
  res.status(200).json({ user: toSafeUser(req.user.user) });
}
