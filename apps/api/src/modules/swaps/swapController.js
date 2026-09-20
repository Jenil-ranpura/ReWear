/**
 * Swap-request controller (§10): thin HTTP layer — bodies validated by the
 * shared Yup schemas via validate middleware; auth via requireAuth.
 */

import {
  acceptSwapRequest,
  createSwapReport,
  createSwapRequest,
  getSwapRequest,
  listSwapRequests,
  resolveSwapRequest,
} from './swapService.js';

export async function createOnItem(req, res) {
  const swapRequest = await createSwapRequest(req.params.id, req.body, req.user);
  res.status(201).json({ swapRequest });
}

export async function action(req, res) {
  const { action } = req.body;
  const swapRequest =
    action === 'ACCEPT'
      ? await acceptSwapRequest(req.params.id, req.user)
      : await resolveSwapRequest(req.params.id, action, req.user);
  res.status(200).json({ swapRequest });
}

export async function list(req, res) {
  const data = await listSwapRequests(req.query.direction ?? 'outgoing', req.user);
  res.status(200).json(data);
}

export async function getOne(req, res) {
  const swapRequest = await getSwapRequest(req.params.id, req.user);
  res.status(200).json({ swapRequest });
}

/** POST /swap-requests/:id/report — dispute a completed swap (§ fraud kit). */
export async function report(req, res) {
  const created = await createSwapReport(req.params.id, req.body, req.user);
  res.status(201).json({ report: created });
}
