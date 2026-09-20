/**
 * P2-T2 — DB connection module (implementation.md §27 P2-T2).
 * Single connection path for the real server, the seed script, and (from
 * Phase 3) integration tests passing a mongodb-memory-server URI.
 */

import mongoose from 'mongoose';
import logger from './logger.js';

export async function connectDb(uri = process.env.MONGODB_URI, options = {}) {
  if (!uri || !uri.trim()) {
    throw new Error('[db] connectDb requires MONGODB_URI (env or explicit argument).');
  }

  // §15 NoSQL-injection mitigation: wraps filter values in $eq so injected
  // selectors are inert. Set once here so every consumer inherits it.
  mongoose.set('sanitizeFilter', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    ...options,
  });

  logger.info('db_connected', {
    // Never log the URI/credentials — only the target database name (§15).
    db: mongoose.connection.name,
  });
  return mongoose.connection;
}

export async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => {});
  }
}
