/**
 * Shared transaction helper (extracted from swapService for the dispute-kit
 * refund remedy — the refund needs the SAME retry discipline as the swap
 * accept, and duplicating it would be a second competing pattern).
 *
 * Retry wrapper for transient transaction failures (Mongo's
 * TransientTransactionError / WriteConflict): retries a few times before
 * surfacing. Genuine races exit earlier via their own conditional-update
 * checks inside the callback (the §5.7/§14.3 pattern).
 */

import mongoose from 'mongoose';

const TX_RETRIES = 3;

export async function withTransactionRetry(fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await mongoose.connection.transaction(async (session) => fn(session), {
        readPreference: 'primary',
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });
    } catch (err) {
      const isTransient =
        err?.hasErrorLabel?.('TransientTransactionError') ||
        err?.errorLabels?.includes('TransientTransactionError');
      if (isTransient && attempt < TX_RETRIES) continue;
      throw err;
    }
  }
}
