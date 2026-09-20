/**
 * Health check (implementation.md §20): GET /health returns
 * { status: "ok", db: "connected" } — 200 when Mongoose is connected
 * (readyState 1), 503 otherwise so orchestrators can detect DB loss.
 */

import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

const READY_STATE_LABEL = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

router.get('/', (_req, res) => {
  const state = mongoose.connection.readyState;
  const db = READY_STATE_LABEL[state] ?? `unknown(${state})`;
  res.status(state === 1 ? 200 : 503).json({ status: state === 1 ? 'ok' : 'degraded', db });
});

export default router;
