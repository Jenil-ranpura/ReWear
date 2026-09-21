/**
 * Auth service (§5.1/§5.2/§10/§11): business logic for registration, login,
 * refresh, and logout, plus the safe user serializer used by every auth
 * response. Email uniqueness is enforced by the DB unique index — the E11000
 * duplicate error bubbles to the global handler, which maps it to 409
 * EMAIL_TAKEN (§11).
 */

import bcrypt from 'bcryptjs';

import { User, PointsTransaction } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { withTransactionRetry } from '../../lib/withTransaction.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  sessionDeadline,
  signAccessToken,
} from './tokens.js';
import { normalizePhone, SIGNUP_POINTS_GRANT } from '@rewear/shared-schemas';

const BCRYPT_COST = 10; // §11: cost factor 10–12

/**
 * Register (§5.1). Returns { user (safe shape), tokens: { accessToken, refreshToken } }.
 * The refresh token is persisted only as a SHA-256 hash (§15).
 */
export async function registerUser({ name, email, password, phone }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const refreshToken = generateRefreshToken();
  // Fixed session window starts NOW (§11, user request).
  const sessionExpiresAt = sessionDeadline();

  // The 25-point signup grant is LEDGER-BACKED (user decision, final):
  // user doc + the origin EARNED transaction commit ATOMICALLY, so the
  // §9.3 invariant (pointsBalance === Σ pointstransactions) holds for a
  // fresh account from the first millisecond — no "25 with an empty
  // ledger" window, no silent loss if anything recomputes the cache.
  // A registration failure rolls BOTH writes back together.
  const user = await withTransactionRetry(async (session) => {
    const doc = await User.create(
      [
        {
          name,
          email,
          passwordHash,
          // Contact reveal: optional signup phone. Schema-validated (real-phone
          // rules); stored E.164-normalized. Never rides public projections — the
          // item-detail owner query selects an explicit field list without it.
          ...(phone ? { phone: normalizePhone(phone) } : {}),
          refreshTokenHash: hashRefreshToken(refreshToken),
          sessionExpiresAt,
          pointsBalance: SIGNUP_POINTS_GRANT, // explicit — mirrors the EARNED doc below
        },
      ],
      { session }
    );

    await PointsTransaction.create(
      [
        {
          userId: doc[0]._id,
          amount: SIGNUP_POINTS_GRANT,
          type: 'EARNED', // signup grant — the ledger's origin entry for this account
        },
      ],
      { session }
    );

    return doc[0];
  });

  return {
    user: toSafeUser(user),
    tokens: { accessToken: signAccessToken(user), refreshToken },
    sessionExpiresAt,
  };
}

/** Strip every credential field before a user object may leave the API (§15). */
export function toSafeUser(user) {
  const obj = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  delete obj.passwordHash;
  delete obj.refreshTokenHash;
  return obj;
}

// §15: generic message on failed login — never reveal whether the email exists.
function invalidCredentials() {
  return new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
}

/**
 * Login (§5.2/§11): verify credentials, reject banned accounts, rotate the
 * refresh token, issue tokens. Returns { user (safe shape), tokens }.
 * Order matters: existence and password checks produce the SAME generic 401
 * (enumeration resistance); the ban check runs only AFTER valid credentials,
 * so ban status is never leaked to an attacker who doesn't know the password.
 */
export async function loginUser({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash +refreshTokenHash');
  if (!user) throw invalidCredentials();

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) throw invalidCredentials();

  if (user.isBanned) {
    throw new AppError(403, 'ACCOUNT_BANNED', 'This account has been suspended.');
  }

  // Rotate the refresh token on every login (§11 rotation principle) and
  // start a FRESH fixed session window (§11, user request): every login gets
  // exactly SESSION_TTL_MINUTES, regardless of any earlier session.
  const sessionExpiresAt = sessionDeadline();
  const refreshToken = generateRefreshToken();
  user.refreshTokenHash = hashRefreshToken(refreshToken);
  user.sessionExpiresAt = sessionExpiresAt;
  await user.save();

  return {
    user: toSafeUser(user),
    tokens: { accessToken: signAccessToken(user), refreshToken },
    sessionExpiresAt,
  };
}

/**
 * Refresh (§10/§11): the httpOnly cookie carries the current opaque refresh
 * token; we match its SHA-256 hash against users.refreshTokenHash, then ROTATE
 * (new refresh token + new hash + fresh access token). Reuse detection falls
 * out of the rotation: after a successful refresh the old token's hash matches
 * nothing, so replaying it gets a clean 401 INVALID_REFRESH.
 * Returns { accessToken, refreshToken }.
 */
export async function refreshTokens(refreshToken) {
  if (!refreshToken)
    throw new AppError(401, 'INVALID_REFRESH', 'Session expired. Please log in again.');

  const user = await User.findOne({ refreshTokenHash: hashRefreshToken(refreshToken) });
  if (!user) throw new AppError(401, 'INVALID_REFRESH', 'Session expired. Please log in again.');

  if (user.isBanned) {
    // Invalidate the banned user's session so a stolen cookie can't ride out
    // the ban (next refresh with the old cookie gets 401).
    user.refreshTokenHash = null;
    await user.save();
    throw new AppError(403, 'ACCOUNT_BANNED', 'This account has been suspended.');
  }

  // Fixed session window (§11, user request): rotation NEVER slides the
  // deadline. Once the window is over the session is rejected AND killed
  // server-side — a replayed/stolen cookie cannot ride it out either.
  if (user.sessionExpiresAt && user.sessionExpiresAt.getTime() <= Date.now()) {
    user.refreshTokenHash = null;
    await user.save();
    throw new AppError(401, 'INVALID_REFRESH', 'Session expired. Please log in again.');
  }

  // Preserve the ORIGINAL deadline (no sliding). Sessions created before the
  // cap existed (deadline null) adopt it at their next refresh.
  const sessionExpiresAt = user.sessionExpiresAt ?? sessionDeadline();
  user.sessionExpiresAt = sessionExpiresAt;

  const newRefreshToken = generateRefreshToken();
  user.refreshTokenHash = hashRefreshToken(newRefreshToken);
  await user.save();

  return { accessToken: signAccessToken(user), refreshToken: newRefreshToken, sessionExpiresAt };
}

/**
 * Logout (§10/§11): invalidates the refresh session server-side by nulling
 * the stored hash — the cookie alone becomes useless immediately. The access
 * token simply expires on its own (≤15 min); requireAuth's fresh user fetch
 * means a banned/deleted user loses access sooner than that.
 */
export async function logoutUser(userId) {
  await User.updateOne({ _id: userId }, { $set: { refreshTokenHash: null } });
}
