/**
 * requireAuth (§11): verifies the Bearer access token and attaches
 * req.user = { id, role } for downstream handlers (and the request logger).
 *
 * Design note: the user is re-fetched from the DB on every request rather
 * than trusting the JWT payload. This makes bans and role changes take
 * effect immediately (a banned user's still-valid access token dies at the
 * next request) at the cost of one indexed findById — the right trade at
 * MVP scale. [ASSUMPTION recorded in progress.md, Session 5.]
 */

import { User } from '../models/index.js';
import { AppError } from './errorHandler.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

export default async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Please log in to continue.');
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      // expired, malformed, wrong signature — all the same to the client
      throw new AppError(401, 'UNAUTHENTICATED', 'Please log in to continue.');
    }

    const user = await User.findById(payload.userId);
    if (!user || user.isBanned) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Please log in to continue.');
    }

    // Fixed session window (§11, user request): hard server-side cutoff. The
    // access token may still be cryptographically valid, but once the login
    // session's window is over the request is unauthenticated — the client's
    // refresh attempt then fails too and the UI auto-logs-out.
    if (user.sessionExpiresAt && user.sessionExpiresAt.getTime() <= Date.now()) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Please log in to continue.');
    }

    // id as a plain string: clean for logs (requestLogger) and Mongoose
    // re-casts it to ObjectId in queries; the full doc rides along as .user.
    req.user = { id: String(user._id), role: user.role, user };
    next();
  } catch (err) {
    next(err);
  }
}
