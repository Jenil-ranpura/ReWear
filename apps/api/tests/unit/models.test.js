/**
 * P2-T1 tests — schema-level validation for the five §9.1 models.
 * These run without a database: they exercise Mongoose schema validation,
 * defaults, the DIRECT_SWAP conditional requirement, and index definitions.
 * Database-backed behavior lands in Phase 3 integration tests.
 */

import { User, Item, SwapRequest, PointsTransaction, AdminAction } from '../../src/models/index.js';
import { ITEM_STATUS, ITEM_CONDITION } from '@rewear/shared-schemas';

const validItem = {
  ownerId: '507f1f77bcf86cd799439011',
  title: 'Denim jacket',
  description: 'Lightly worn denim jacket, size M.',
  category: 'JACKETS',
  type: 'Jacket',
  size: 'M',
  condition: 'GOOD',
  pointValue: 40,
  images: [{ url: 'https://res.cloudinary.com/demo/image/upload/jacket.jpg' }],
};

describe('Item schema (§9.1)', () => {
  it('applies spec defaults on a valid document', () => {
    const item = new Item(validItem);
    const err = item.validateSync();
    expect(err).toBeUndefined();
    expect(item.status).toBe('PENDING');
    expect(item.tags).toEqual([]);
    expect(item.images[0].isPrimary).toBe(false);
    expect(item.images[0].perceptualHash).toBeNull();
  });

  it('rejects a condition outside the enum', () => {
    const item = new Item({ ...validItem, condition: 'PRISTINE' });
    const err = item.validateSync();
    expect(err?.errors.condition).toBeDefined();
  });

  it('rejects an invalid status value', () => {
    const item = new Item({ ...validItem, status: 'APPROVED_BY_VIBE' });
    expect(item.validateSync()?.errors.status).toBeDefined();
  });

  it('rejects a missing required field (pointValue)', () => {
    const { pointValue: _pointValue, ...withoutPointValue } = validItem;
    const item = new Item(withoutPointValue);
    expect(item.validateSync()?.errors.pointValue).toBeDefined();
  });

  it('defines the §9 indexes (compound browse, owner, perceptual-hash multikey)', () => {
    const specs = Item.schema.indexes().map(([, options]) => options);
    const keys = Item.schema.indexes().map(([spec]) => spec);
    expect(keys).toContainEqual({ status: 1, category: 1 });
    expect(keys).toContainEqual({ ownerId: 1 });
    expect(keys).toContainEqual({ 'images.perceptualHash': 1 });
    expect(specs.find((o) => o.unique)).toBeUndefined(); // no unique index on items
  });

  it('exposes every §9 status value through the shared enums package', () => {
    expect(ITEM_STATUS).toContain('PENDING_TRANSFER');
    expect(ITEM_CONDITION).toContain('LIKE_NEW');
  });
});

describe('SwapRequest schema (§9.1)', () => {
  const base = {
    itemId: '507f1f77bcf86cd799439012',
    requesterId: '507f1f77bcf86cd799439013',
  };

  it('requires offeredItemId for DIRECT_SWAP (conditional validator)', () => {
    const swap = new SwapRequest({ ...base, type: 'DIRECT_SWAP' });
    expect(swap.validateSync()?.errors.offeredItemId).toBeDefined();
  });

  it('does NOT require offeredItemId for POINTS_REDEMPTION', () => {
    const swap = new SwapRequest({ ...base, type: 'POINTS_REDEMPTION' });
    const err = swap.validateSync();
    expect(err).toBeUndefined();
    expect(swap.status).toBe('PENDING');
  });

  it('rejects an unknown swap type', () => {
    const swap = new SwapRequest({ ...base, type: 'TRADE_CASH' });
    expect(swap.validateSync()?.errors.type).toBeDefined();
  });
});

describe('User schema (§9.1)', () => {
  const validUser = {
    name: 'Ada',
    email: 'ada@example.com',
    passwordHash: '$2a$10$exampleexampleexampleexampleexampleexampleexampleexam',
  };

  it('defaults role to USER, pointsBalance to 0, isBanned to false', () => {
    const user = new User(validUser);
    expect(user.validateSync()).toBeUndefined();
    expect(user.role).toBe('USER');
    expect(user.pointsBalance).toBe(0);
    expect(user.isBanned).toBe(false);
  });

  it('rejects an invalid role', () => {
    const user = new User({ ...validUser, role: 'SUPERUSER' });
    expect(user.validateSync()?.errors.role).toBeDefined();
  });

  it('declares a unique index on email (§11: uniqueness at the DB level)', () => {
    const emailIndex = User.schema.indexes().find(([spec]) => spec.email === 1);
    expect(emailIndex).toBeDefined();
    expect(emailIndex[1].unique).toBe(true);
  });
});

describe('PointsTransaction schema (§9.1, §9.3)', () => {
  it('records credits and debits with a valid ledger type', () => {
    const tx = new PointsTransaction({
      userId: '507f1f77bcf86cd799439014',
      amount: -40,
      type: 'SPENT',
    });
    expect(tx.validateSync()).toBeUndefined();
  });

  it('rejects an unknown ledger type', () => {
    const tx = new PointsTransaction({
      userId: '507f1f77bcf86cd799439014',
      amount: 10,
      type: 'REFUND',
    });
    expect(tx.validateSync()?.errors.type).toBeDefined();
  });

  it('is append-only: schema tracks createdAt but not updatedAt', () => {
    expect(PointsTransaction.schema.options.timestamps).toEqual({
      createdAt: true,
      updatedAt: false,
    });
  });
});

describe('AdminAction schema (§9.1)', () => {
  it('creates an audit doc with a nullable reason and createdAt-only timestamps', () => {
    const action = new AdminAction({
      adminId: '507f1f77bcf86cd799439015',
      targetType: 'Item',
      targetId: '507f1f77bcf86cd799439016',
      action: 'APPROVE',
    });
    expect(action.validateSync()).toBeUndefined();
    expect(action.reason).toBeNull();
    expect(AdminAction.schema.options.timestamps).toEqual({
      createdAt: true,
      updatedAt: false,
    });
  });
});
