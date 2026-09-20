/**
 * P2-T1 — AdminAction model (implementation.md §9.1 "adminactions").
 * Audit trail for moderation actions (approve/reject items, ban users, §5.8).
 * Append-only by design — audit documents are never updated or deleted.
 */

import mongoose from 'mongoose';

const adminActionSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, required: true }, // e.g. "Item", "User"
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    action: { type: String, required: true }, // e.g. "APPROVE", "REJECT", "BAN"
    reason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } } // §9.1 lists createdAt only
);

export default mongoose.model('AdminAction', adminActionSchema);
