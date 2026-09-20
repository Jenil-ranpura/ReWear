/**
 * P0-T3 / Phase-0 completion check: verify the dev Atlas database is reachable
 * from the backend, and that it runs as a replica set (multi-document
 * transactions — the swap-accept flow, implementation.md §5.7 — require this).
 *
 * Usage:  npm run verify:db   (from apps/api, or via the root workspace)
 *
 * Safety: reads MONGODB_URI from the environment (.env). NEVER prints the URI
 * or any credential — only the target database name and topology facts.
 * Per §8, this lives in scripts/ as a one-off diagnostic; the real connection
 * module (lib/db.js) arrives with P2-T2.
 */

import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;

function describeUri(u) {
  const srv = typeof u === 'string' && u.startsWith('mongodb+srv://');
  try {
    const parsed = new URL(u);
    const dbName =
      parsed.pathname && parsed.pathname.length > 1 ? parsed.pathname.slice(1) : '(default)';
    return { dbName, srv };
  } catch {
    return { dbName: '(unparsable)', srv };
  }
}

const ERROR_HINTS = [
  {
    match: /ServerSelectionError|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i,
    hint: 'Could not reach the cluster. Check Atlas → Network Access (your current IP must be allow-listed, or 0.0.0.0/0 for hackathon mode) and that the URI hostname is correct.',
  },
  {
    match: /Authentication|bad auth|auth failed/i,
    hint: 'Authentication failed. Check Atlas → Database Access: username/password in the URI, and that the user has access to this database.',
  },
  {
    match: /querySrv|ESERVFAIL|ENODATA|srv/i,
    hint: 'DNS SRV lookup failed. Try the non-SRV connection string format (Atlas → Connect → Drivers → pick an older driver version for the mongodb:// form).',
  },
  {
    match: /whitelist|not authorized|IP/i,
    hint: 'Your IP is likely not allow-listed. Atlas → Network Access → Add IP address.',
  },
];

if (!uri) {
  console.error('❌ MONGODB_URI is not set.');
  console.error(
    '   Fix: cp apps/api/.env.example apps/api/.env  — then fill in the Atlas connection string.'
  );
  process.exit(1);
}

const { dbName, srv } = describeUri(uri);
console.log(`→ Connecting to database "${dbName}" (${srv ? 'mongodb+srv' : 'mongodb'} scheme)…`);

let hello;
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const admin = mongoose.connection.db.admin();
  hello = await admin.command({ hello: 1 });
  await admin.command({ ping: 1 });
} catch (err) {
  console.error(`❌ Connection failed: ${err.codeName || err.name}: ${err.message.split('\n')[0]}`);
  const hint = ERROR_HINTS.find((h) => h.match.test(err.message) || h.match.test(err.name || ''));
  if (hint) console.error(`   Hint: ${hint.hint}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}

const isReplicaSet = Boolean(hello.setName);
const readyState = mongoose.connection.readyState; // 1 = connected

console.log(`✅ Connected. (readyState=${readyState}, ping ok)`);
console.log(`✅ Topology: ${isReplicaSet ? `replica set "${hello.setName}"` : 'STANDALONE'}`);

if (!isReplicaSet) {
  console.error('');
  console.error('⚠️  PROBLEM: this server is NOT a replica set. Multi-document transactions');
  console.error('   are unsupported, and the swap-accept flow (§5.7) depends on them.');
  console.error('   Per implementation.md §9.4, dev must use Atlas (replica set), not a local');
  console.error('   standalone mongod. P0-T3 acceptance FAILS until this is a replica set.');
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}

console.log('');
console.log('🎉 P0-T3 verification PASSED — cluster reachable and transaction-capable.');
await mongoose.disconnect().catch(() => {});
process.exit(0);
