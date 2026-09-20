/**
 * Optional-auth variant of requireAuth (§10: GET /items is PUBLIC, but a
 * logged-in admin must be able to pass ?status=...). Verifies the Bearer
 * token when present and attaches req.user; never blocks. Invalid/expired
 * tokens are treated as anonymous rather than a 401 — browsing must not
 * require an account, and a stale token must not break the read path.
 */

import { User } from '../models/index.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

export default async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (token) {
    try {
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.userId).lean();
      if (user && !user.isBanned) {
        req.user = { id: String(user._id), role: user.role, user };
      }
    } catch {
      // Invalid/expired token → anonymous (deliberate: optionalAuth never fails).
    }
  }

  next();
}
