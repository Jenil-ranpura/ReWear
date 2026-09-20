/**
 * Items resource client (§12: one file per resource; components never call
 * fetch directly). Mirrors the §10 items endpoints exactly — including the
 * P4-T2 upload flow: images are uploaded FIRST, then the item is created with
 * the returned {url, perceptualHash} pairs (§5.3/§14.1).
 */

import { apiFetch } from './client.js';

/** Public browse. query is the filter-panel state (matches browseItemsSchema). */
export function list(query) {
  return apiFetch('/items', { query });
}

/**
 * Public detail. 404 (NOT_FOUND) for unapproved items the caller can't see —
 * callers should show the §5.9 "no longer available" state, not a raw error.
 */
export function getOne(id) {
  return apiFetch(`/items/${id}`);
}

/**
 * Create (auth). payload matches itemCreateSchema; images come from
 * uploadImages() first. Server forces status=PENDING regardless of payload.
 */
export function create(payload) {
  return apiFetch('/items', { method: 'POST', body: payload });
}

/** Owner-only update (auth). Same schema as create, all fields optional. */
export function update(id, payload) {
  return apiFetch(`/items/${id}`, { method: 'PATCH', body: payload });
}

/** Owner-only soft delete (auth) → 204 / null. */
export function remove(id) {
  return apiFetch(`/items/${id}`, { method: 'DELETE' });
}

/**
 * P4-T2 upload: POST /items/images with multipart FormData. Returns
 * [{ url, perceptualHash }] — callers attach these to the item payload.
 * No Content-Type header is set; the browser adds the multipart boundary.
 */
export function uploadImages(files) {
  const form = new FormData();
  for (const file of files) form.append('images', file, file.name);
  return apiFetch('/items/images', { method: 'POST', body: form });
}

/**
 * P6-T5 AI suggestion (§14.4): POST /items/classify { imageUrl } →
 * `{ suggestion: { suggestedCategory, suggestedCondition, suggestedPoints,
 * confidence } | null }`. ADVISORY-ONLY by contract: every failure is a
 * 200 with suggestion null (never an error), so callers treat null as
 * "fill the form manually", not as a failure state.
 */
export function classify(imageUrl) {
  return apiFetch('/items/classify', { method: 'POST', body: { imageUrl } });
}
