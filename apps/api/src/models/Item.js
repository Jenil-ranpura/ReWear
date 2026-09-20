/**
 * P2-T1 — Item model (implementation.md §9.1 "items").
 * Images are embedded (§9.1 rationale: never queried independently of their
 * parent item). Status transitions are owned by the swap state machine (§5.7)
 * and the admin moderation flow (§5.8) — nothing else may change status.
 */

import mongoose from 'mongoose';
import { ITEM_STATUS, ITEM_CONDITION } from '@rewear/shared-schemas';

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    isPrimary: { type: Boolean, default: false },
    perceptualHash: { type: String, default: null }, // nullable — duplicate detection (§14.5)
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    type: { type: String, required: true },
    size: { type: String, required: true },
    condition: { type: String, enum: ITEM_CONDITION, required: true },
    tags: { type: [String], default: [] },
    pointValue: { type: Number, required: true }, // SERVER-derived: base(category) × multiplier(condition) (§14.4 revised) — never client-set
    // Audit trail of the AI suggestion — nullable (§9.1)
    aiSuggestedCategory: { type: String, default: null },
    aiSuggestedCondition: { type: String, default: null },
    aiConfidence: { type: Number, default: null },
    images: { type: [imageSchema], default: [] },
    status: { type: String, enum: ITEM_STATUS, default: 'PENDING' },
    moderationReason: { type: String, default: null },
  },
  { timestamps: true } // createdAt, updatedAt (§9.1)
);

// Indexes per §9.1: browse queries, owner dashboard, duplicate detection.
itemSchema.index({ status: 1, category: 1 }); // compound — browse/filter path (§23)
itemSchema.index({ ownerId: 1 });
itemSchema.index({ 'images.perceptualHash': 1 }); // multikey across embedded images

export default mongoose.model('Item', itemSchema);
