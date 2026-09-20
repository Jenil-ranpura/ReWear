/**
 * Auth resource client (§12). The items/swaps/admin clients land with the
 * full P5-T1 API layer — this file covers only what Phase 3 needs.
 */

import { apiFetch, refreshAccessToken, setAccessToken, setSessionExpiresAt } from './client.js';

/** Returns the safe user object; stores the access token + session deadline in memory. */
export async function register(payload) {
  const data = await apiFetch('/auth/register', { method: 'POST', body: payload });
  setAccessToken(data.accessToken);
  setSessionExpiresAt(data.sessionExpiresAt);
  return data.user;
}

/** Returns the safe user object; stores the access token + session deadline in memory. */
export async function login(payload) {
  const data = await apiFetch('/auth/login', { method: 'POST', body: payload });
  setAccessToken(data.accessToken);
  setSessionExpiresAt(data.sessionExpiresAt);
  return data.user;
}

/**
 * Silent restore: uses the refresh cookie to get a fresh in-memory token +
 * user. Must go through the SINGLE-FLIGHT refresh (not a plain apiFetch, and
 * never auto-retried) — StrictMode double-mounts would otherwise fire two
 * /auth/refresh calls and the second would consume an already-rotated
 * single-use cookie → 401 → session lost on every other reload.
 */
export async function restoreSession() {
  await refreshAccessToken();
  // /auth/me responds { user } — unwrap so the context stores the USER object
  // itself, matching what login()/register() return. (Returning the envelope
  // made user.name undefined after a reload: nav lost the name, the points
  // chip fell back to 0, while status was still 'authenticated'.)
  const data = await apiFetch('/auth/me');
  return data.user;
}

export async function fetchMe() {
  const data = await apiFetch('/auth/me');
  return data.user;
}

/** Logs out server-side (hash nulled) and drops the in-memory token + session deadline. */
export async function logout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    setAccessToken(null);
    setSessionExpiresAt(null);
  }
}
