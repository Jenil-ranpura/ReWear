/**
 * Users resource client (§12: one file per resource). Mirrors the §10 users
 * endpoints as they come online — /users/me/items feeds the swap dialog's
 * offered-item picker (P5-T3) and the dashboard (P5-T5).
 */

import { apiFetch } from './client.js';

/** The caller's own items (all statuses, primary image first). */
export function listMyItems() {
  return apiFetch('/users/me/items');
}

/**
 * The caller's append-only points ledger (§9.3), paginated. query:
 * { page, pageSize } (see pointsHistoryQuerySchema).
 */
export function pointsHistory(query = {}) {
  return apiFetch('/users/me/points/history', { query });
}

/**
 * Profile self-service (§10 PATCH /users/me). payload: { name, phone?,
 * currentPassword?, password? } — validated by the SAME shared
 * profileUpdateSchema the API enforces. Returns the updated safe user.
 */
export function updateProfile(payload) {
  return apiFetch('/users/me', { method: 'PATCH', body: payload });
}
