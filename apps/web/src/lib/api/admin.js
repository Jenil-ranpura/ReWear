/**
 * Admin resource client (§12). Mirrors the four §10 admin endpoints. Every
 * call requires the ADMIN role — the server rejects anyone else (403), and
 * the UI gates the routes with ProtectedRoute requireAdmin (P3-T7).
 */

import { apiFetch } from './client.js';

/** GET /admin/items/pending — oldest-first moderation queue. */
export function pendingItems(query) {
  return apiFetch('/admin/items/pending', { query });
}

/**
 * GET /admin/items?status=APPROVED|REMOVED — the live-monitoring list
 * (post-approval oversight). q searches titles within the selected status.
 */
export function listItems(query) {
  return apiFetch('/admin/items', { query });
}

/** action: APPROVE | REJECT; reason optional (encouraged for REJECT, §5.8). */
export function moderate(itemId, action, reason) {
  return apiFetch(`/admin/items/${itemId}/moderate`, {
    method: 'PATCH',
    body: { action, ...(reason ? { reason } : {}) },
  });
}

/** q matches name/email; role: USER|ADMIN; banned: boolean. */
export function listUsers(query) {
  return apiFetch('/admin/users', { query });
}

/** GET /admin/users/:id — investigation view (evidence kit). */
export function getUser(userId, query) {
  return apiFetch(`/admin/users/${userId}`, { query });
}

/** banned: true | false (unban); reason stored on the AdminAction row. */
export function setBanned(userId, banned, reason) {
  return apiFetch(`/admin/users/${userId}/ban`, {
    method: 'PATCH',
    body: { banned, ...(reason ? { reason } : {}) },
  });
}

/** GET /admin/reports — the dispute queue (status: 'open' filters). */
export function listReports(query) {
  return apiFetch('/admin/reports', { query });
}

/** remedy: REFUND | NONE + required resolution note (audit trail). */
export function resolveReport(reportId, remedy, resolutionNote) {
  return apiFetch(`/admin/reports/${reportId}`, {
    method: 'PATCH',
    body: { remedy, resolutionNote },
  });
}
