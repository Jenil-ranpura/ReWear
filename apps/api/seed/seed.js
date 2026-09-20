/**
 * P2-T3 — Minimal deterministic seed script (implementation.md §27 P2-T3:
 * "start minimal — 2 users, 3 items — expand in Phase 10" per §21).
 *
 * Re-runnable: drops and reseeds the database named in MONGODB_URI.
 * Safety (§21): refuses to run when NODE_ENV=production unless --force is
 * passed explicitly — never nuke production by accident.
 *
 * Usage: npm run seed  (from apps/api, or `npm run seed` at the root)
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import env from '../src/config/env.js';
import logger from '../src/lib/logger.js';
import { connectDb, disconnectDb } from '../src/lib/db.js';
import { computeSuggestedPoints } from '@rewear/shared-schemas';
import { User, Item, PointsTransaction } from '../src/models/index.js';

async function main() {
  if (env.isProduction && !process.argv.includes('--force')) {
    logger.error('seed_refused', {
      reason:
        'NODE_ENV=production — refusing to drop/reseed. Re-run with --force if you REALLY mean it.',
    });
    process.exit(1);
  }

  await connectDb(env.MONGODB_URI);
  const db = mongoose.connection;

  logger.info('seed_start', { db: db.name });

  // Deterministic drop-and-reseed (§21).
  await db.dropDatabase();

  const passwordHash = await bcrypt.hash('Password123!', 10); // demo-only creds, same for all seeded users
  const users = await User.insertMany([
    {
      name: 'Admin Demo',
      email: 'admin@rewear.test',
      passwordHash,
      role: 'ADMIN',
      pointsBalance: 0,
    },
    {
      name: 'Demo User',
      email: 'demo@rewear.test',
      passwordHash,
      role: 'USER',
      pointsBalance: 120,
    },
  ]);
  const [admin, demoUser] = users;

  const items = await Item.insertMany([
    {
      ownerId: demoUser._id,
      title: 'Denim Jacket',
      description: 'Classic blue denim jacket, lightly worn, size M.',
      category: 'JACKETS',
      type: 'Jacket',
      size: 'M',
      condition: 'GOOD',
      tags: ['denim', 'casual'],
      // §14.4 revised: formula-derived (40 × 1.0 = 40) — all seed items use
      // the same table the API enforces, so they can never drift.
      pointValue: computeSuggestedPoints('JACKETS', 'GOOD'),
      status: 'APPROVED',
      images: [
        { url: 'https://res.cloudinary.com/demo/image/upload/denim-jacket.jpg', isPrimary: true },
      ],
    },
    {
      ownerId: demoUser._id,
      title: 'Summer Floral Dress',
      description: 'Floral midi dress, worn once for a wedding.',
      category: 'DRESSES',
      type: 'Dress',
      size: 'S',
      condition: 'LIKE_NEW',
      tags: ['floral', 'summer'],
      // §14.4 revised: formula-derived (45 × 1.2) — matches what the API
      // would compute for this category/condition pair.
      pointValue: computeSuggestedPoints('DRESSES', 'LIKE_NEW'),
      status: 'PENDING', // shows up in the admin moderation queue
      images: [
        { url: 'https://res.cloudinary.com/demo/image/upload/floral-dress.jpg', isPrimary: true },
      ],
    },
    {
      ownerId: admin._id,
      title: 'Wool Winter Coat',
      description: 'Warm wool coat, some pilling under the arms.',
      category: 'COATS',
      type: 'Coat',
      size: 'L',
      condition: 'FAIR',
      tags: ['wool', 'winter'],
      // §14.4 revised: formula-derived (55 × 0.7 = 39, was 55).
      pointValue: computeSuggestedPoints('COATS', 'FAIR'),
      status: 'APPROVED',
      images: [
        { url: 'https://res.cloudinary.com/demo/image/upload/wool-coat.jpg', isPrimary: true },
      ],
    },
  ]);

  // §9.3: a seeded points balance MUST have a matching ledger document,
  // otherwise the reconciliation check (P2-T4) fails by construction.
  await PointsTransaction.insertMany([
    { userId: demoUser._id, amount: 120, type: 'EARNED', relatedSwapRequestId: null },
  ]);

  logger.info('seed_done', { users: users.length, items: items.length });
  await disconnectDb();
  process.exit(0);
}

main().catch(async (err) => {
  logger.error('seed_failed', { error: err });
  await disconnectDb();
  process.exit(1);
});
