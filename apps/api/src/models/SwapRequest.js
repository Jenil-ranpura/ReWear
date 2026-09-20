/**
 * P2-T1 — SwapRequest model (implementation.md §9.1 "swaprequests").
 * Status transitions go exclusively through the guarded accept/reject/cancel
 * flow (§5.7/§14.3) — the highest-risk logic in the system.
 */

import mongoose from 'mongoose';
import { SWAP_TYPE, SWAP_STATUS, DIRECT_SWAP } from '@rewear/shared-schemas';

const swapRequestSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true }, // item being requested
    requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Contact reveal (user-requested): both parties snapshotted AT CREATION —
    // the counterparty can never be derived from item ownership after an
    // accept, because accept TRANSFERS ownership (the owner of record flips
    // to the requester). participants[1] is always the requester.
    // Strictness lives in createSwapRequest (always writes exactly [owner,
    // requester]); the model validates SHAPE when present so direct-model
    // fixtures (PENDING lock setups) stay valid.
    participants: {
      type: [mongoose.Schema.Types.ObjectId],
      default: undefined,
      validate: {
        validator: (v) => v == null || (Array.isArray(v) && v.length === 2),
        message: 'participants must be exactly [ownerId, requesterId]',
      },
    },
    // Requester-volunteered phone for THIS exchange (shared real-phone
    // validation). Owner sees it ONLY on ACCEPT; scrubbed on REJECT/CANCEL —
    // dead consent must not persist on the document.
    requesterPhone: { type: String, default: null },
    // Required only for direct swaps — enforced by the conditional validator below (§9.1: "required if type = DIRECT_SWAP")
    offeredItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      default: null,
      required: function isDirectSwap() {
        return this.type === DIRECT_SWAP;
      },
    },
    type: { type: String, enum: SWAP_TYPE, required: true },
    status: { type: String, enum: SWAP_STATUS, default: 'PENDING' },
  },
  { timestamps: true } // createdAt, updatedAt (§9.1)
);

swapRequestSchema.index({ itemId: 1 });
swapRequestSchema.index({ requesterId: 1 });

export default mongoose.model('SwapRequest', swapRequestSchema);
