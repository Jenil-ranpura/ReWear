/**
 * Shared test-database helper (§17): a real, ephemeral mongod via
 * mongodb-memory-server — no Docker, no external DB. Each test suite gets a
 * unique database name on a shared per-run server instance (fast + isolated).
 *
 * TRANSACTION NOTE (bit us in P4-T4): the swap-accept flow requires
 * multi-document transactions, which need a REPLICA SET. Verified facts:
 *  1. MongoMemoryServer.create({ replicaSet: 'rs0' }) does NOT reliably
 *     start a replica set (hello reported setName: NONE).
 *  2. MongoMemoryReplSet.create({ replSet: { count: 1 } }) does — but its
 *     getUri() already ENDS with "?replicaSet=testset", so appending a db
 *     name would corrupt the query string. The db name must be injected
 *     BEFORE the '?' (uri ends with '/'; we insert 'dbName?' → '/db?params').
 *  3. An EMPTY transaction can "succeed" on a standalone (driver short-
 *     circuits no-op commits) — topology probes must WRITE or they lie.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import crypto from 'node:crypto';

import { connectDb, disconnectDb } from '../../src/lib/db.js';

let replSet;

export async function startTestDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const baseUri = replSet.getUri(); // mongodb://127.0.0.1:PORT/?replicaSet=testset
  const dbName = `rewear-test-${crypto.randomUUID()}`;
  const uri = baseUri.includes('?') ? baseUri.replace('?', `${dbName}?`) : `${baseUri}${dbName}`;
  await connectDb(uri);
}

export async function stopTestDb() {
  await disconnectDb();
  if (replSet) {
    await replSet.stop();
    replSet = undefined;
  }
}
