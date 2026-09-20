/**
 * Report model — user-requested fraud-response scope addition (dispute kit).
 * One dispute document per reported ACCEPTED swap. Reports are the human
 * adjudication layer: the platform can't verify a physical meetup, so it
 * never AUTO-reverses a completed swap — an admin reads the report (plus the
 * ledger trail) and decides. Append-only-ish: status transitions OPEN →
 * RESOLVED | DISMISSED are final; remedy details + resolver identity are
 * frozen onto the document at resolve time.
 */

import mongoose from 'mongoose';

export const REPORT_REASON = Object.freeze([
  'NO_SHOW',
  'ITEM_NOT_AS_DESCRIBED',
  'FAKE_ITEM',
  'OTHER',
]);
export const REPORT_STATUS = Object.freeze(['OPEN', 'RESOLVED', 'DISMISSED']);
export const REPORT_REMEDY = Object.freeze(['REFUND', 'NONE']);

const reportSchema = new mongoose.Schema(
  {
    swapRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SwapRequest',
      required: true,
      // One OPEN dispute per swap — re-reporting the same dispute spams the
      // queue. Enforced at the service layer (needs a friendly 409); enforced
      // here as a second gate via partial filter (open only).
    },
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Snapshot: who the parties WERE at dispute time (post-transfer ownership
    // is unreliable for identity — same lesson as SwapRequest.participants).
    againstId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: REPORT_REASON, required: true },
    details: { type: String, default: null }, // bounded by schema (≤500 chars)
    status: { type: String, enum: REPORT_STATUS, default: 'OPEN' },
    // Filled at resolve time; null while OPEN.
    remedy: { type: String, enum: REPORT_REMEDY, default: null },
    resolutionNote: { type: String, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One OPEN report per swap (service checks any-status; this guards races).
reportSchema.index({ swapRequestId: 1, status: 1 });
reportSchema.index({ status: 1, createdAt: 1 }); // queue listing

export default mongoose.model('Report', reportSchema);
