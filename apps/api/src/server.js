/**
 * P1-T1 — Server entrypoint.
 * Boot order: validate env (config module) → connect Mongo → listen → log.
 * The DB connection is kept here (thin, direct mongoose.connect) until P2-T2
 * extracts lib/db.js; /health reports the live readyState either way.
 */

import env from './config/env.js';
import logger from './lib/logger.js';
import { connectDb, disconnectDb } from './lib/db.js';
import app from './app.js';

if (!env.MONGODB_URI) {
  logger.error('startup_aborted', {
    reason: 'MONGODB_URI is not set (tests set it dynamically; the real server needs it)',
  });
  process.exit(1);
}

const server = app.listen(env.PORT, () => {
  logger.info('server_listening', { port: env.PORT, env: env.NODE_ENV });
});

try {
  await connectDb(env.MONGODB_URI);
} catch (err) {
  logger.error('db_connect_failed', { error: err });
  server.close(() => process.exit(1));
  process.exitCode = 1;
}

async function shutdown(signal) {
  logger.info('shutdown', { signal });
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // hard-exit safety
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
