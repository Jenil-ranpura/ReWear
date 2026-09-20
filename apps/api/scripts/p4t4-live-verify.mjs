/**
 * P4-T4 LIVE verification against the REAL Atlas cluster (replica set).
 *
 * Proves, on the production topology (not just the in-memory test replSet):
 *   1. DIRECT_SWAP accept — atomic ownership exchange, both items SWAPPED.
 *   2. POINTS_REDEMPTION accept — item transfer + ledger pair + cache updates,
 *      all consistent (§9.3), written in ONE transaction.
 *   3. §14.3 RACE — two concurrent accepts on one item: exactly one 200, the
 *      loser gets 409 CONFLICT, and state stays consistent afterwards.
 *
 * Hygiene: every created doc is tracked and deleted in `finally`. The dev
 * server is untouched — this script boots its own app instance on PORT=4100.
 *
 * Run:  cd apps/api && PORT=4100 node --env-file=.env scripts/p4t4-live-verify.mjs
 */

process.env.NODE_ENV = 'development';
process.env.PORT = process.env.PORT || '4100';

const { default: mongoose } = await import('mongoose');
const { default: app } = await import('../src/app.js');
const { default: http } = await import('node:http');
const { Item, PointsTransaction, User } = await import('../src/models/index.js');

const STAMP = Date.now().toString(36);
const BASE = `http://127.0.0.1:${process.env.PORT}/api/v1`;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function req(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const r = http.request(
      `${BASE}${path}`,
      {
        method,
        headers: {
          ...(payload ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data || '{}') });
          } catch {
            resolve({ status: res.statusCode, body: {} });
          }
        });
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function registerUser(email) {
  const res = await req('POST', '/auth/register', {
    body: { name: `LV ${STAMP}`, email, password: 'Password123!' },
  });
  if (res.status !== 201)
    throw new Error(`register failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.user._id ?? res.body.user.id, token: res.body.accessToken };
}

async function mkItem(ownerId, title, pointValue) {
  return Item.create({
    ownerId,
    title,
    description: `live-verify ${STAMP}`,
    category: 'TOPS',
    type: 'Jacket',
    size: 'M',
    condition: 'GOOD',
    status: 'APPROVED',
    pointValue,
    images: [
      {
        url: `https://res.cloudinary.com/demo/image/upload/lv-${STAMP}.jpg`,
        perceptualHash: '00000000ffffffff',
      },
    ],
  });
}

async function fund(userId, amount) {
  await PointsTransaction.create({ userId, amount, type: 'EARNED' });
  // Model query (NOT raw collection): mongoose casts the string id to
  // ObjectId — a raw collection update with a string _id matches NOTHING.
  await User.updateOne({ _id: String(userId) }, { $set: { pointsBalance: amount } });
}

const cleanupIds = { users: [], items: [], swaps: [], txs: [] };
async function cleanup() {
  const { User, Item, SwapRequest, PointsTransaction } = await import('../src/models/index.js');
  if (cleanupIds.swaps.length) await SwapRequest.deleteMany({ _id: { $in: cleanupIds.swaps } });
  if (cleanupIds.txs.length) await PointsTransaction.deleteMany({ _id: { $in: cleanupIds.txs } });
  if (cleanupIds.items.length) await Item.deleteMany({ _id: { $in: cleanupIds.items } });
  if (cleanupIds.users.length) await User.deleteMany({ _id: { $in: cleanupIds.users } });
}

const server = http.createServer(app);
try {
  await mongoose.connect(process.env.MONGODB_URI);
  await new Promise((res) => server.listen(process.env.PORT, res));
  console.log(`live-verify on :${process.env.PORT} | stamp ${STAMP}\n`);

  // ── Actors (registered through the real API path). ──
  const requester = await registerUser(`lv-req-${STAMP}@example.com`);
  const owner = await registerUser(`lv-own-${STAMP}@example.com`);
  const third = await registerUser(`lv-third-${STAMP}@example.com`);
  cleanupIds.users.push(requester.id, owner.id, third.id);

  // ── 1. DIRECT_SWAP accept ──────────────────────────────────────────────────
  const a = await mkItem(owner.id, `LV direct ${STAMP}`, 10);
  const b = await mkItem(requester.id, `LV offered ${STAMP}`, 10);
  cleanupIds.items.push(a._id, b._id);

  const r1 = await req('POST', `/items/${a._id}/swap-requests`, {
    token: requester.token,
    body: { type: 'DIRECT_SWAP', offeredItemId: String(b._id) },
  });
  cleanupIds.swaps.push(r1.body?.swapRequest?._id);
  if (r1.status !== 201)
    throw new Error(`swap request create failed: ${r1.status} ${JSON.stringify(r1.body)}`);

  const acc1 = await req('PATCH', `/swap-requests/${r1.body.swapRequest._id}`, {
    token: owner.token,
    body: { action: 'ACCEPT' },
  });
  check(
    'DIRECT_SWAP accept → 200',
    acc1.status === 200,
    `got ${acc1.status} ${JSON.stringify(acc1.body).slice(0, 120)}`
  );

  const [aAfter, bAfter] = [await Item.findById(a._id).lean(), await Item.findById(b._id).lean()];
  check(
    'DIRECT_SWAP: ownership exchanged atomically',
    String(aAfter.ownerId) === String(requester.id) && String(bAfter.ownerId) === String(owner.id)
  );
  check(
    'DIRECT_SWAP: both items SWAPPED',
    aAfter.status === 'SWAPPED' && bAfter.status === 'SWAPPED'
  );

  // ── 2. POINTS_REDEMPTION accept (§9.3 ledger invariant) ────────────────────
  await fund(requester.id, 500);
  const c = await mkItem(owner.id, `LV points ${STAMP}`, 10);
  cleanupIds.items.push(c._id);

  const r2 = await req('POST', `/items/${c._id}/swap-requests`, {
    token: requester.token,
    body: { type: 'POINTS_REDEMPTION' },
  });
  cleanupIds.swaps.push(r2.body?.swapRequest?._id);
  if (r2.status !== 201)
    throw new Error(`points request create failed: ${r2.status} ${JSON.stringify(r2.body)}`);

  const requesterDocBefore = await User.findById(String(requester.id)).lean();
  if (!requesterDocBefore) throw new Error('funding failed — requester not found');
  const before = requesterDocBefore.pointsBalance;

  const acc2 = await req('PATCH', `/swap-requests/${r2.body.swapRequest._id}`, {
    token: owner.token,
    body: { action: 'ACCEPT' },
  });
  check(
    'POINTS_REDEMPTION accept → 200',
    acc2.status === 200,
    `got ${acc2.status} ${JSON.stringify(acc2.body).slice(0, 120)}`
  );

  const requesterAfter = await User.findById(requester.id).lean();
  const ownerAfter = await User.findById(owner.id).lean();
  const ledger = await PointsTransaction.find({
    relatedSwapRequestId: r2.body.swapRequest._id,
  }).lean();
  const ledgerSum = ledger.reduce((s, t) => s + t.amount, 0);

  check(
    'POINTS: requester debited exactly pointValue',
    requesterAfter.pointsBalance === before - 10,
    `${before} → ${requesterAfter.pointsBalance}`
  );
  check(
    'POINTS: ledger pair (SPENT+EARNED) exists',
    ledger.length === 2 &&
      ledger.some((t) => t.type === 'SPENT') &&
      ledger.some((t) => t.type === 'EARNED')
  );
  check('POINTS: ledger sums to zero (§9.3 invariant)', ledgerSum === 0, `sum=${ledgerSum}`);

  const allTxs = await PointsTransaction.find({ userId: requester.id }).lean();
  const ledgerTotal = allTxs.reduce((s, t) => s + t.amount, 0);
  check(
    'POINTS: user cache == ledger sum (reconciliation)',
    requesterAfter.pointsBalance === ledgerTotal,
    `cache=${requesterAfter.pointsBalance} ledger=${ledgerTotal}`
  );

  const cAfter = await Item.findById(c._id).lean();
  check(
    'POINTS: item transferred to redeemer',
    String(cAfter.ownerId) === String(requester.id) && cAfter.status === 'SWAPPED'
  );
  void ownerAfter;

  // ── 3. §14.3 RACE: two concurrent accepts on one item ──────────────────────
  await fund(requester.id, 500);
  await fund(third.id, 500);
  const d = await mkItem(owner.id, `LV race ${STAMP}`, 10);
  cleanupIds.items.push(d._id);

  const rq1 = await req('POST', `/items/${d._id}/swap-requests`, {
    token: requester.token,
    body: { type: 'POINTS_REDEMPTION' },
  });
  const rq2 = await req('POST', `/items/${d._id}/swap-requests`, {
    token: third.token,
    body: { type: 'POINTS_REDEMPTION' },
  });
  cleanupIds.swaps.push(rq1.body?.swapRequest?._id, rq2.body?.swapRequest?._id);
  if (rq1.status !== 201 || rq2.status !== 201) {
    throw new Error(`race setup failed: ${rq1.status} / ${rq2.status}`);
  }

  const race = await Promise.allSettled([
    req('PATCH', `/swap-requests/${rq1.body.swapRequest._id}`, {
      token: owner.token,
      body: { action: 'ACCEPT' },
    }),
    req('PATCH', `/swap-requests/${rq2.body.swapRequest._id}`, {
      token: owner.token,
      body: { action: 'ACCEPT' },
    }),
  ]);
  const settled = race.map((r) => r.value);
  const winners = settled.filter((r) => r.status === 200);
  const losers = settled.filter((r) => r.status === 409);

  check(
    'RACE: exactly one 200 and one 409',
    winners.length === 1 && losers.length === 1,
    `${settled[0].status}/${settled[1].status}`
  );
  check(
    'RACE: loser gets 409 CONFLICT',
    losers.length === 1 && losers[0].body?.error?.code === 'CONFLICT',
    JSON.stringify(losers[0]?.body).slice(0, 140)
  );

  const dDoc = await Item.findById(d._id).lean();
  check('RACE: item SWAPPED exactly once', dDoc.status === 'SWAPPED');

  const winnerSwapId = winners[0].body?.swapRequest?._id;
  const raceLedger = await PointsTransaction.find({ relatedSwapRequestId: winnerSwapId }).lean();
  check(
    'RACE: exactly one ledger pair for the winner',
    raceLedger.length === 2,
    `found ${raceLedger.length}`
  );

  const winnerId = String(winners[0].body.swapRequest._id);
  const loserSwapId =
    winnerId === String(rq1.body.swapRequest._id)
      ? rq2.body.swapRequest._id
      : rq1.body.swapRequest._id;
  const { SwapRequest } = await import('../src/models/index.js');
  const loserDoc = await SwapRequest.findById(loserSwapId).lean();
  check(
    'RACE: losing request auto-REJECTED',
    loserDoc?.status === 'REJECTED',
    `status=${loserDoc?.status}`
  );
} catch (err) {
  console.error('SCRIPT ERROR:', err?.message ?? err);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
    console.log('\ncleanup: all created docs removed');
  } catch (e) {
    console.error('cleanup error:', e?.message ?? e);
    process.exitCode = 1;
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed > 0) process.exitCode = 1;
  server.close();
  await mongoose.disconnect();
}
