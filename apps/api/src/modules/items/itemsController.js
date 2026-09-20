/**
 * Items controller (§10): thin HTTP layer — query already validated and
 * normalized by validateQuery (shared browseItemsSchema), auth state already
 * attached by requireAuth when present (see optionalAuth below).
 */

import {
  browseItems,
  createItem,
  getItemById,
  softDeleteItem,
  updateItem,
} from './itemsService.js';

export async function browse(req, res) {
  // req.user exists only when a valid Bearer token was provided (optionalAuth);
  // guests pass through with req.user === undefined. The normalized filters
  // live on req.validatedQuery (Express 5 makes req.query read-only).
  // NOTE: services receive the auth WRAPPER ({ id, role }) — never req.user.user
  // (a lean doc has no .id virtual; that inconsistency cost us an hour).
  const data = await browseItems(req.validatedQuery, req.user);
  res.status(200).json(data);
}

export async function getById(req, res) {
  const item = await getItemById(req.params.id, req.user);
  res.status(200).json({ item });
}

export async function create(req, res) {
  // requireAuth guarantees req.user on this route (§10: user role required).
  const { item, duplicateImageFlagged } = await createItem(req.body, req.user);
  res.status(201).json({ item, duplicateImageFlagged });
}

export async function update(req, res) {
  const item = await updateItem(req.params.id, req.body, req.user);
  res.status(200).json({ item });
}

export async function remove(req, res) {
  await softDeleteItem(req.params.id, req.user);
  res.status(204).send();
}
