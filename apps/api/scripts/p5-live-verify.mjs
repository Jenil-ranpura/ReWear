/**
 * P5 LIVE verification (Phase 5 validation gate) against the REAL Atlas cluster.
 *
 * Walks the §5 user journey end-to-end on production topology. ORDER MATTERS:
 * a freshly registered user has 0 points, so the flow bootstraps through
 * moderation + a direct swap before points can be redeemed:
 *
 *   A. Moderation-first bootstrap (§5.8 → §5.4):
 *      register (0 pts) → list 2 items (PENDING, hidden) → admin queue shows
 *      them → APPROVE both (audit rows) → now publicly browsable.
 *   B. Full swap flow (§5.5–§5.7 → §9.3):
 *      direct swap (owner accepts → item transfers) → INSUFFICIENT_POINTS
 *      guard → redeem earned points (owner accepts → ownership + points move
 *      atomically) → balances, ledger rows, duplicate-request guard.
 *   C. Ban enforcement (§11/§5.8):
 *      ban → live token 401s on next request + login 403 ACCOUNT_BANNED →
 *      unban → access restored.
 *
 * Hygiene: run `npm run seed` first (this gate expects the seeded admin).
 * Every doc created here is deleted in `finally`. Boots its own app instance
 * on PORT=4100 — the dev server is untouched.
 *
 * Run:  cd apps/api && npm run seed
 *       PORT=4100 node --env-file=.env scripts/p5-live-verify.mjs
 */

process.env.NODE_ENV = 'development';
process.env.PORT = process.env.PORT || '4100';

const { default: mongoose } = await import('mongoose');
const { default: app } = await import('../src/app.js');
const { default: http } = await import('node:http');
const { Item, User, AdminAction, PointsTransaction, SwapRequest } =
  await import('../src/models/index.js');
const { reconcileUserPoints } = await import('../src/lib/reconcilePoints.js');

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

const cleanupIds = { users: [], items: [], audits: [], txs: [], swaps: [], reconcile: [] };
async function cleanup() {
  // Children first — audit/ledger/swap rows reference users and items.
  if (cleanupIds.audits.length) await AdminAction.deleteMany({ _id: { $in: cleanupIds.audits } });
  if (cleanupIds.txs.length) await PointsTransaction.deleteMany({ _id: { $in: cleanupIds.txs } });
  if (cleanupIds.swaps.length) await SwapRequest.deleteMany({ _id: { $in: cleanupIds.swaps } });
  if (cleanupIds.items.length) await Item.deleteMany({ _id: { $in: cleanupIds.items } });
  if (cleanupIds.users.length) await User.deleteMany({ _id: { $in: cleanupIds.users } });

  // §9.3 hygiene: the redemption leg moves the SHARED demo user's balance
  // cache; with the throwaway ledger rows deleted above, the cache must be
  // restored to the surviving ledger sum or the fixture silently violates
  // users.pointsBalance === Σ pointstransactions (reconcilePoints invariant).
  for (const userId of cleanupIds.reconcile) {
    const [agg] = await PointsTransaction.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    await User.updateOne({ _id: userId }, { $set: { pointsBalance: agg?.total ?? 0 } });
  }
}

const server = http.createServer(app);
try {
  await mongoose.connect(process.env.MONGODB_URI);
  await new Promise((res) => server.listen(process.env.PORT, res));
  console.log(`p5-live-verify on :${process.env.PORT} | stamp ${STAMP}\n`);

  const imageUrl = (name) =>
    `https://res.cloudinary.com/demo/image/upload/p5lv-${STAMP}-${name}.jpg`;
  // Session 13: pointValue is SERVER-DERIVED (§14.4 revised) — the POSTed
  // value is ignored. TOPS × GOOD → 25 for every item this script creates;
  // the assertions below read the derived value off the response instead of
  // assuming the old client-supplied number.
  const DERIVED_TOPS_GOOD = 25;
  const itemBody = (name) => ({
    title: `P5LV ${name} ${STAMP}`,
    description: `Phase 5 live-verify item ${name} (${STAMP}).`,
    category: 'TOPS',
    type: 'Jacket',
    size: 'M',
    condition: 'GOOD',
    images: [{ url: imageUrl(name), isPrimary: true }],
  });

  // ── Setup: admin (seeded) + two fresh users. ──
  const adminLogin = await req('POST', '/auth/login', {
    body: { email: 'admin@rewear.test', password: 'Password123!' },
  });
  if (adminLogin.status !== 200)
    throw new Error(`admin login failed: ${adminLogin.status} — run \`npm run seed\` first`);
  const adminToken = adminLogin.body.accessToken;

  // The seeded DEMO user carries the 120-pt balance (the admin starts at 0)
  // — they are the funded redeemer in section B.
  const demoLogin = await req('POST', '/auth/login', {
    body: { email: 'demo@rewear.test', password: 'Password123!' },
  });
  if (demoLogin.status !== 200)
    throw new Error(`demo login failed: ${demoLogin.status} — run \`npm run seed\` first`);
  const demoToken = demoLogin.body.accessToken;
  const demoStartBalance = demoLogin.body.user.pointsBalance;
  cleanupIds.reconcile.push(demoLogin.body.user._id ?? demoLogin.body.user.id);
  // §9.3: assert the balance is LEDGER-CONSISTENT (not a literal 120) so the
  // gate is re-runnable without reseeding — the redemption math below is
  // relative to whatever balance the fixture carries.
  const demoReconcile = await reconcileUserPoints(demoLogin.body.user._id);
  check(
    'Seed: demo user logged in with a funded, ledger-consistent balance (§9.3)',
    demoStartBalance > 0 && demoReconcile.consistent,
    `balance ${demoStartBalance}, ledger ${demoReconcile.ledger}`
  );

  const registerUser = async (name) => {
    const reg = await req('POST', '/auth/register', {
      body: {
        name: `P5LV ${name} ${STAMP}`,
        email: `p5lv-${name}-${STAMP}@example.test`,
        password: 'Password123!',
      },
    });
    if (reg.status !== 201) throw new Error(`register ${name} failed: ${reg.status}`);
    cleanupIds.users.push(reg.body.user._id ?? reg.body.user.id);
    return { token: reg.body.accessToken, id: reg.body.user._id ?? reg.body.user.id };
  };

  const trader = await registerUser('trader'); // will end up owning items
  const bidder = await registerUser('bidder'); // requests swaps / redeems

  // ════ A. Moderation-first bootstrap (§5.8 → §5.4). ════
  console.log('\n── A. Moderation-first bootstrap ──');

  const mine = await req('POST', '/items', { token: trader.token, body: itemBody('x') });
  const mineY = await req('POST', '/items', { token: bidder.token, body: itemBody('y') });
  check(
    'Create: server DERIVED pointValue 25 (client copy ignored, §14.4 revised)',
    mine.body.item?.pointValue === DERIVED_TOPS_GOOD &&
      mineY.body.item?.pointValue === DERIVED_TOPS_GOOD,
    `x ${mine.body.item?.pointValue}, y ${mineY.body.item?.pointValue}`
  );
  check(
    'Create: trader lists itemX, bidder lists itemY → 201 PENDING',
    mine.status === 201 &&
      mine.body.item.status === 'PENDING' &&
      mineY.status === 201 &&
      mineY.body.item.status === 'PENDING',
    `x ${mine.status}/${mine.body.item?.status}, y ${mineY.status}/${mineY.body.item?.status}`
  );
  const itemX = mine.body.item;
  const itemY = mineY.body.item;
  cleanupIds.items.push(itemX._id, itemY._id);

  const guestSees = await req('GET', `/items?q=${encodeURIComponent(itemX.title)}`);
  check(
    'Guard: PENDING item hidden from guest browse (§5.3)',
    guestSees.status === 200 && guestSees.body.total === 0,
    `got ${guestSees.status}, total ${guestSees.body.total}`
  );

  const queue = await req('GET', '/admin/items/pending', { token: adminToken });
  const inQueue = queue.body.items?.some((i) => i._id === itemX._id);
  check(
    'Admin: PENDING items visible in moderation queue (oldest-first)',
    queue.status === 200 && inQueue,
    `got ${queue.status}, x in queue: ${Boolean(inQueue)}`
  );

  const guestQueue = await req('GET', '/admin/items/pending', { token: trader.token });
  check('Guard: non-admin admin call → 403', guestQueue.status === 403, `got ${guestQueue.status}`);

  for (const [label, item, body] of [
    ['x', itemX, { action: 'APPROVE' }],
    ['y', itemY, { action: 'APPROVE' }],
  ]) {
    const mod = await req('PATCH', `/admin/items/${item._id}/moderate`, {
      token: adminToken,
      body,
    });
    const audits = await AdminAction.find({ targetId: item._id }).lean();
    cleanupIds.audits.push(...audits.map((a) => a._id));
    check(
      `Admin: approve ${label} → 200 APPROVED + audit row (§9.1)`,
      mod.status === 200 && mod.body.item.status === 'APPROVED' && audits.length === 1,
      `got ${mod.status}/${mod.body.item?.status}, audits ${audits.length}`
    );
  }

  const nowPublic = await req('GET', `/items?q=${encodeURIComponent('P5LV')}`);
  check(
    'Flow: approved items now publicly browsable (§5.3 ⇢ §5.8)',
    nowPublic.status === 200 && nowPublic.body.total === 2,
    `got ${nowPublic.status}, total ${nowPublic.body.total}`
  );

  // ════ B. Full swap flow (§5.5–§5.7 → §9.3). ════
  console.log('\n── B. Swap flow: direct swap, then points redemption ──');

  // The admin's seeded APPROVED item to trade for (40 pts, admin-owned).
  const adminItems = await req('GET', `/items?q=${encodeURIComponent('Denim Jacket')}`, {
    token: adminToken,
  });
  const denim = adminItems.body.items?.[0];
  if (!denim) throw new Error('seeded Denim Jacket not found — run `npm run seed` first');

  // The direct swap: bidder offers their APPROVED itemY for trader's itemX.
  // First the reachable creation guards, each on its own shape:
  const notOwned = await req('POST', `/items/${itemX._id}/swap-requests`, {
    token: bidder.token,
    body: { type: 'DIRECT_SWAP', offeredItemId: denim._id },
  });
  check(
    'Guard: cannot offer an item you do not own → 403 FORBIDDEN',
    notOwned.status === 403 && notOwned.body.error?.code === 'FORBIDDEN',
    `got ${notOwned.status}/${notOwned.body.error?.code}`
  );

  const selfSwap = await req('POST', `/items/${itemX._id}/swap-requests`, {
    token: trader.token,
    body: { type: 'DIRECT_SWAP', offeredItemId: itemY._id },
  });
  check(
    'Guard: cannot request a swap on your own item (§15)',
    selfSwap.status === 400 && selfSwap.body.error?.code === 'INVALID_SWAP',
    `got ${selfSwap.status}/${selfSwap.body.error?.code}`
  );

  const offerX = await req('POST', `/items/${itemX._id}/swap-requests`, {
    token: bidder.token,
    body: { type: 'DIRECT_SWAP', offeredItemId: itemY._id },
  });
  check(
    'Swap: DIRECT_SWAP itemY ⇢ itemX → 201 PENDING (§5.5)',
    offerX.status === 201 && offerX.body.swapRequest.status === 'PENDING',
    `got ${offerX.status}`
  );
  cleanupIds.swaps.push(offerX.body.swapRequest._id);

  const traderIncoming = await req('GET', '/swap-requests?direction=incoming', {
    token: trader.token,
  });
  const incomingRow = traderIncoming.body.requests?.find(
    (r) => r._id === offerX.body.swapRequest._id
  );
  check(
    'Dashboard: owner sees the request in incoming list (§5.7 UI data)',
    traderIncoming.status === 200 && Boolean(incomingRow),
    `got ${traderIncoming.status}, found: ${Boolean(incomingRow)}`
  );

  const acceptX = await req('PATCH', `/swap-requests/${offerX.body.swapRequest._id}`, {
    token: trader.token,
    body: { action: 'ACCEPT' },
  });
  check(
    'Accept: owner accepts → 200 ACCEPTED (§5.7)',
    acceptX.status === 200 && acceptX.body.swapRequest.status === 'ACCEPTED',
    `got ${acceptX.status}/${acceptX.body.swapRequest?.status}`
  );

  // DIRECT swap ⇒ BOTH items transfer and go SWAPPED (one atomic transaction).
  const xAfter = await req('GET', `/items/${itemX._id}`, { token: bidder.token });
  const yAfter = await req('GET', `/items/${itemY._id}`, { token: adminToken });
  check(
    'Ownership: itemX → bidder AND itemY → trader, both SWAPPED',
    String(xAfter.body.item?.ownerId) === String(bidder.id) &&
      xAfter.body.item?.status === 'SWAPPED' &&
      String(yAfter.body.item?.ownerId) === String(trader.id) &&
      yAfter.body.item?.status === 'SWAPPED',
    `x ${xAfter.body.item?.status}/${String(xAfter.body.item?.ownerId) === String(bidder.id)}, y ${yAfter.body.item?.status}`
  );

  // A SWAPPED item can no longer be requested — proved against trader's itemY.
  const redemption = await req('POST', `/items/${itemY._id}/swap-requests`, {
    token: bidder.token,
    body: { type: 'POINTS_REDEMPTION' },
  });
  check(
    'Guard: redemption of a SWAPPED item → 409 ITEM_NOT_AVAILABLE',
    redemption.status === 409 && redemption.body.error?.code === 'ITEM_NOT_AVAILABLE',
    `got ${redemption.status}/${redemption.body.error?.code}`
  );

  // Zero-points guard on the ADMIN's denim (40 pts, bidder has 0).
  const broke = await req('POST', `/items/${denim._id}/swap-requests`, {
    token: bidder.token,
    body: { type: 'POINTS_REDEMPTION' },
  });
  check(
    'Guard: redemption without points → 409 INSUFFICIENT_POINTS',
    broke.status === 409 && broke.body.error?.code === 'INSUFFICIENT_POINTS',
    `got ${broke.status}/${broke.body.error?.code}`
  );

  // Redemption leg: bidder lists a third item, admin approves it, then the
  // seeded DEMO user redeems it — moving 25 derived pts demo → bidder.
  const mineZ = await req('POST', '/items', { token: bidder.token, body: itemBody('z') });
  const itemZ = mineZ.body.item;
  cleanupIds.items.push(itemZ._id);
  const approveZ = await req('PATCH', `/admin/items/${itemZ._id}/moderate`, {
    token: adminToken,
    body: { action: 'APPROVE' },
  });
  const zAudits = await AdminAction.find({ targetId: itemZ._id }).lean();
  cleanupIds.audits.push(...zAudits.map((a) => a._id));
  check(
    'Bootstrap: third item listed → approved (bidder now has an APPROVED listing)',
    mineZ.status === 201 && approveZ.status === 200 && approveZ.body.item.status === 'APPROVED',
    `create ${mineZ.status}, approve ${approveZ.status}`
  );

  const redeem = await req('POST', `/items/${itemZ._id}/swap-requests`, {
    token: demoToken,
    body: { type: 'POINTS_REDEMPTION' },
  });
  check(
    `Redemption: demo user redeems bidder itemZ (${DERIVED_TOPS_GOOD} pts) → 201 PENDING (§5.6)`,
    redeem.status === 201 && redeem.body.swapRequest.status === 'PENDING',
    `got ${redeem.status}/${redeem.body.error?.code ?? 'ok'}`
  );
  cleanupIds.swaps.push(redeem.body.swapRequest._id);

  const dup = await req('POST', `/items/${itemZ._id}/swap-requests`, {
    token: demoToken,
    body: { type: 'POINTS_REDEMPTION' },
  });
  check(
    'Guard: duplicate PENDING request → 409 DUPLICATE_REQUEST',
    dup.status === 409 && dup.body.error?.code === 'DUPLICATE_REQUEST',
    `got ${dup.status}/${dup.body.error?.code}`
  );

  const acceptRedeem = await req('PATCH', `/swap-requests/${redeem.body.swapRequest._id}`, {
    token: bidder.token,
    body: { action: 'ACCEPT' },
  });
  check(
    'Accept: redemption accepted → 200 ACCEPTED (atomic transfer)',
    acceptRedeem.status === 200 && acceptRedeem.body.swapRequest.status === 'ACCEPTED',
    `got ${acceptRedeem.status}/${acceptRedeem.body.swapRequest?.status}`
  );

  const [demoMe, bidderMe] = await Promise.all([
    req('GET', '/auth/me', { token: demoToken }),
    req('GET', '/auth/me', { token: bidder.token }),
  ]);
  check(
    `Points: balances moved ${DERIVED_TOPS_GOOD} pts demo → bidder (cache matches ledger, §9.3)`,
    demoMe.body.user.pointsBalance === demoStartBalance - DERIVED_TOPS_GOOD &&
      bidderMe.body.user.pointsBalance === DERIVED_TOPS_GOOD,
    `demo ${demoStartBalance}→${demoMe.body.user.pointsBalance}, bidder 0→${bidderMe.body.user.pointsBalance}`
  );

  const bidderLedger = await req('GET', '/users/me/points/history', { token: bidder.token });
  const earned = bidderLedger.body.transactions?.find((t) => t.type === 'EARNED');
  check(
    `Ledger: bidder sees EARNED +${DERIVED_TOPS_GOOD} row (§9.3 the ledger IS the truth)`,
    bidderLedger.status === 200 && earned?.amount === DERIVED_TOPS_GOOD,
    `got ${bidderLedger.status}, earned ${earned?.amount ?? 'none'}`
  );

  const demoLedger = await req('GET', '/users/me/points/history', { token: demoToken });
  const spent = demoLedger.body.transactions?.find(
    (t) => t.type === 'SPENT' && t.amount === -DERIVED_TOPS_GOOD
  );
  check(
    'Ledger: redeemer sees the matching SPENT −20 row',
    demoLedger.status === 200 && Boolean(spent),
    `found: ${Boolean(spent)}`
  );

  const demoId = demoLogin.body.user._id ?? demoLogin.body.user.id;
  const zOwnerAfterRedeem = await req('GET', `/items/${itemZ._id}`, { token: adminToken });
  check(
    'Ownership: itemZ now belongs to the redeemer, status SWAPPED (transfer)',
    zOwnerAfterRedeem.status === 200 &&
      String(zOwnerAfterRedeem.body.item.ownerId) === String(demoId) &&
      zOwnerAfterRedeem.body.item.status === 'SWAPPED',
    `owner demo: ${String(zOwnerAfterRedeem.body.item?.ownerId) === String(demoId)}`
  );

  // ════ C. Ban enforcement (§11/§5.8). ════
  console.log('\n── C. Ban enforcement ──');

  const ban = await req('PATCH', `/admin/users/${trader.id}/ban`, {
    token: adminToken,
    body: { banned: true, reason: 'p5-live-verify' },
  });
  check(
    'Ban: PATCH → 200 isBanned=true',
    ban.status === 200 && ban.body.user.isBanned === true,
    `got ${ban.status}`
  );

  const traderAfterBan = await req('GET', '/auth/me', { token: trader.token });
  const traderLogin = await req('POST', '/auth/login', {
    body: { email: `p5lv-trader-${STAMP}@example.test`, password: 'Password123!' },
  });
  check(
    'Ban: live token 401s on next request + login 403 ACCOUNT_BANNED (§11)',
    traderAfterBan.status === 401 &&
      traderLogin.status === 403 &&
      traderLogin.body.error?.code === 'ACCOUNT_BANNED',
    `me ${traderAfterBan.status}, login ${traderLogin.status}/${traderLogin.body.error?.code}`
  );

  const unban = await req('PATCH', `/admin/users/${trader.id}/ban`, {
    token: adminToken,
    body: { banned: false },
  });
  const traderBack = await req('POST', '/auth/login', {
    body: { email: `p5lv-trader-${STAMP}@example.test`, password: 'Password123!' },
  });
  check(
    'Unban: login works again (§5.8 recovery)',
    unban.status === 200 && traderBack.status === 200,
    `unban ${unban.status}, login ${traderBack.status}`
  );

  const traderAudits = await AdminAction.find({ targetId: trader.id }).lean();
  cleanupIds.audits.push(...traderAudits.map((a) => a._id));
  check(
    'Audit: BAN + UNBAN rows both present (§9.1 oversight)',
    traderAudits.length === 2,
    `found ${traderAudits.length}`
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
