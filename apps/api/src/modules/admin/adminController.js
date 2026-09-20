/**
 * P4-T6 — Admin controller (§10 response envelopes). Thin: validated input →
 * service → JSON. All handlers sit behind requireAuth + requireAdmin
 * (mounted in adminRoutes.js).
 */

import {
  getUserDetail,
  listPendingItems,
  listReports,
  listUsers,
  moderateItem,
  resolveReport,
  setUserBanned,
} from './adminService.js';

/** GET /admin/items/pending */
export async function pendingQueue(req, res) {
  const data = await listPendingItems(req.validatedQuery ?? req.query);
  res.status(200).json(data);
}

/** PATCH /admin/items/:id/moderate */
export async function moderate(req, res) {
  const item = await moderateItem(req.params.id, req.body, req.user);
  res.status(200).json({ item });
}

/** GET /admin/users */
export async function users(req, res) {
  const data = await listUsers(req.validatedQuery ?? req.query);
  res.status(200).json(data);
}

/** GET /admin/users/:id — investigation view (evidence kit). */
export async function userDetail(req, res) {
  const data = await getUserDetail(req.params.id, req.validatedQuery ?? req.query);
  res.status(200).json(data);
}

/** PATCH /admin/users/:id/ban */
export async function ban(req, res) {
  const { user, changed } = await setUserBanned(req.params.id, req.body, req.user);
  res.status(200).json({ user, changed });
}

/** GET /admin/reports — the dispute queue (§ fraud kit). */
export async function reports(req, res) {
  const data = await listReports(req.validatedQuery ?? req.query);
  res.status(200).json(data);
}

/** PATCH /admin/reports/:id — the human remedy (dismiss or refund). */
export async function resolve(req, res) {
  const { report: updated, refund } = await resolveReport(req.params.id, req.body, req.user);
  res.status(200).json({ report: updated, refund });
}
