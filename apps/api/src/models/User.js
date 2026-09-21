/**
 * P2-T1 — User model (implementation.md §9.1 "users").
 * pointsBalance is a denormalized CACHE of the pointstransactions ledger
 * (§9.3) — never written outside the same session/transaction as a
 * corresponding ledger document.
 */

import mongoose from 'mongoose';
import { USER_ROLE } from '@rewear/shared-schemas';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true }, // uniqueness enforced by the index below (§11: E11000 → 409)
    // select:false — credentials never ride along on casual queries (§15).
    // Login must explicitly .select('+passwordHash'); toSafeUser strips both.
    passwordHash: { type: String, required: true, select: false },
    refreshTokenHash: { type: String, default: null, select: false }, // SHA-256 of the current refresh token (§11)
    // Fixed session window (§11, user request): absolute deadline stamped at
    // login/register. Refresh rotates the token but NEVER extends this — once
    // it passes, refresh and every protected route reject (auto-logout).
    sessionExpiresAt: { type: Date, default: null },
    avatarUrl: { type: String, default: null },
    location: { type: String, default: null },
    // Contact reveal (user-requested): optional, volunteered at signup.
    // NEVER rides public projections (owner selects an explicit field list);
    // revealed to a swap counterparty ONLY on ACCEPT, via toSafeUser.
    phone: { type: String, default: null },
    role: { type: String, enum: USER_ROLE, default: 'USER' },
    pointsBalance: { type: Number, default: 25 }, // denormalized ledger cache (§9.3)
    isBanned: { type: Boolean, default: false },
  },
  { timestamps: true } // createdAt, updatedAt (§9.1)
);

userSchema.index({ email: 1 }, { unique: true });

export default mongoose.model('User', userSchema);
