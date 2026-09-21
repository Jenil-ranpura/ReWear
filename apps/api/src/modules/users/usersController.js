/**
 * Users controller (§10): thin HTTP layer, same convention as items.
 */

import { listMyItems, listMyPointsHistory, updateMyProfile } from './usersService.js';

export async function getMyItems(req, res) {
  const items = await listMyItems(req.user);
  res.status(200).json({ items });
}

export async function getMyPointsHistory(req, res) {
  const data = await listMyPointsHistory(req.validatedQuery, req.user);
  res.status(200).json(data);
}

/** PATCH /users/me — returns the updated safe user (AuthContext refreshes from it). */
export async function updateMe(req, res) {
  const user = await updateMyProfile(req.body, req.user);
  res.status(200).json({ user });
}
