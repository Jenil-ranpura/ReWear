/**
 * P2-T1 — PointsTransaction model (implementation.md §9.1 "pointstransactions").
 * APPEND-ONLY ledger (§9.3): documents are created inside the swap-accept
 * transaction and are never updated or deleted — no update endpoints may ever
 * exist for this collection. users.pointsBalance is only its cache.
 */

import mongoose from 'mongoose';
import { POINTS_TX_TYPE } from '@rewear/shared-schemas';

const pointsTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true }, // positive = credit, negative = debit
    type: { type: String, enum: POINTS_TX_TYPE, required: true },
    relatedSwapRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SwapRequest',
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } } // §9.1 lists createdAt only — append-only
);

pointsTransactionSchema.index({ userId: 1 });

export default mongoose.model('PointsTransaction', pointsTransactionSchema);
