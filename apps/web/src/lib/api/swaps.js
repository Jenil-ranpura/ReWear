/**
 * Swap-request resource client (§12). Mirrors the §10 swap endpoints: create
 * on an item, list incoming/outgoing, detail, and the PATCH actions (accept
 * is owner-only; reject owner; cancel requester — server enforces, §5.7).
 * Optimistic updates for accept/reject land in P5-T5 via TanStack Query's
 * onMutate/onError rollback pattern.
 */

import { apiFetch } from './client.js';

/** Create a request on someone's item: { type, offeredItemId? }. */
export function createOnItem(itemId, payload) {
  return apiFetch(`/items/${itemId}/swap-requests`, { method: 'POST', body: payload });
}

/** direction: 'incoming' (on MY items) | 'outgoing' (mine). */
export function list(direction) {
  return apiFetch('/swap-requests', { query: { direction } });
}

export function getOne(id) {
  return apiFetch(`/swap-requests/${id}`);
}

/** action: ACCEPT | REJECT | CANCEL (§10). */
export function act(id, action) {
  return apiFetch(`/swap-requests/${id}`, { method: 'PATCH', body: { action } });
}

/** Report a completed swap (fraud kit): { reason, details? }. */
export function report(id, payload) {
  return apiFetch(`/swap-requests/${id}/report`, { method: 'POST', body: payload });
}
