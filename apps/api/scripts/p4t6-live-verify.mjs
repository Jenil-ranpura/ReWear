/**
 * P4-T6 LIVE verification against the REAL Atlas cluster.
 *
 * Proves on the production topology:
 *   1. Admin login → GET /admin/items/pending shows the seeded PENDING queue
 *      (read-only — the demo corduroy jacket is left untouched).
 *   2. Moderate a THROWAWAY item: APPROVE → 200 + audit row; re-moderate →
 *      409 INVALID_STATE; item becomes publicly visible in browse (§5.3 ⇢ §5.8).
 *   3. Ban a THROWAWAY user → their still-valid token 401s on the very next
 *      request; UNBAN restores them; every action left an AdminAction row.
 *
 * Hygiene: every doc created here (item, user, audit rows) is deleted in
 * `finally`. Boots its own app instance on PORT=4100 — dev server untouched.
 *
 * Run:  cd apps/api && PORT=4100 node --env-file=.env scripts/p4t6-live-verify.mjs
 */

process.env.NODE_ENV = 'development';
process.env.PORT = process.env.PORT || '4100';

const { default: mongoose } = await import('mongoose');
const { default: app } = await import('../src/app.js');
const { default: http } = await import('node:http');
const { Item, User, AdminAction } = await import('../src/models/index.js');

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

const cleanupIds = { users: [], items: [], audits: [] };
async function cleanup() {
  if (cleanupIds.audits.length) await AdminAction.deleteMany({ _id: { $in: cleanupIds.audits } });
  if (cleanupIds.items.length) await Item.deleteMany({ _id: { $in: cleanupIds.items } });
  if (cleanupIds.users.length) await User.deleteMany({ _id: { $in: cleanupIds.users } });
}

const server = http.createServer(app);
try {
  await mongoose.connect(process.env.MONGODB_URI);
  await new Promise((res) => server.listen(process.env.PORT, res));
  console.log(`live-verify on :${process.env.PORT} | stamp ${STAMP}\n`);

  // ── 1. Admin login + pending queue (read-only on real data). ──
  const login = await req('POST', '/auth/login', {
    body: { email: 'admin@rewear.test', password: 'Password123!' },
  });
  if (login.status !== 200)
    throw new Error(`admin login failed: ${login.status} ${JSON.stringify(login.body)}`);
  const adminToken = login.body.accessToken;

  const queue = await req('GET', '/admin/items/pending', { token: adminToken });
  check('Admin: GET /admin/items/pending → 200', queue.status === 200, `got ${queue.status}`);
  check('Queue: seeded PENDING items visible', queue.body.total >= 1, `total=${queue.body.total}`);

  const guestForbidden = await req('GET', '/admin/items/pending');
  check(
    'Guard: guest admin call → 401',
    guestForbidden.status === 401,
    `got ${guestForbidden.status}`
  );

  // ── 2. Moderate a throwaway item end-to-end. ──
  const adminId = login.body.user._id ?? login.body.user.id;
  const item = await Item.create({
    ownerId: adminId,
    title: `LV moderation ${STAMP}`,
    description: `live-verify ${STAMP}`,
    category: 'TOPS',
    type: 'Jacket',
    size: 'M',
    condition: 'GOOD',
    status: 'PENDING',
    pointValue: 10,
    images: [
      { url: `https://res.cloudinary.com/demo/image/upload/lv-${STAMP}.jpg`, isPrimary: true },
    ],
  });
  cleanupIds.items.push(item._id);

  const approve = await req('PATCH', `/admin/items/${item._id}/moderate`, {
    token: adminToken,
    body: { action: 'APPROVE' },
  });
  check(
    'Moderate: APPROVE → 200 APPROVED',
    approve.status === 200 && approve.body.item.status === 'APPROVED',
    `got ${approve.status}`
  );

  const auditRows = await AdminAction.find({ targetId: item._id }).lean();
  cleanupIds.audits.push(...auditRows.map((a) => a._id));
  check(
    'Audit: AdminAction row written (who/what/action)',
    auditRows.length === 1 &&
      String(auditRows[0].adminId) === String(adminId) &&
      auditRows[0].action === 'APPROVE'
  );

  const again = await req('PATCH', `/admin/items/${item._id}/moderate`, {
    token: adminToken,
    body: { action: 'REJECT', reason: 'double moderate' },
  });
  check(
    'Moderate: re-moderate → 409 INVALID_STATE',
    again.status === 409 && again.body.error?.code === 'INVALID_STATE',
    `got ${again.status}`
  );

  const browse = await req('GET', `/items?q=${encodeURIComponent(`LV moderation ${STAMP}`)}`);
  check(
    'Flow: approved item now publicly browsable (§5.3→§5.8)',
    browse.status === 200 && browse.body.items?.length === 1,
    `got ${browse.status}, found ${browse.body.items?.length ?? 0}`
  );

  const reject = await req('PATCH', `/admin/items/${item._id}/moderate`, {});
  void reject;

  // ── 3. Ban / unban a throwaway user — instant enforcement. ──
  const reg = await req('POST', '/auth/register', {
    body: {
      name: `LV Ban ${STAMP}`,
      email: `lv-ban-${STAMP}@example.com`,
      password: 'Password123!',
    },
  });
  if (reg.status !== 201)
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  const victimToken = reg.body.accessToken;
  const victimId = reg.body.user._id ?? reg.body.user.id;
  cleanupIds.users.push(victimId);

  const meBefore = await req('GET', '/auth/me', { token: victimToken });
  check('Ban: victim token valid pre-ban', meBefore.status === 200, `got ${meBefore.status}`);

  const ban = await req('PATCH', `/admin/users/${victimId}/ban`, {
    token: adminToken,
    body: { banned: true, reason: 'live-verify' },
  });
  check(
    'Ban: PATCH ban → 200 isBanned=true',
    ban.status === 200 && ban.body.user.isBanned === true,
    `got ${ban.status}`
  );

  const meAfter = await req('GET', '/auth/me', { token: victimToken });
  check(
    'Ban: same token 401s on NEXT request (instant, §11)',
    meAfter.status === 401,
    `got ${meAfter.status}`
  );

  const unban = await req('PATCH', `/admin/users/${victimId}/ban`, {
    token: adminToken,
    body: { banned: false },
  });
  const meBack = await req('GET', '/auth/me', { token: victimToken });
  check(
    'Unban: access restored (requireAuth re-fetch)',
    unban.status === 200 && meBack.status === 200,
    `unban ${unban.status}, me ${meBack.status}`
  );

  const selfBan = await req('PATCH', `/admin/users/${adminId}/ban`, {
    token: adminToken,
    body: { banned: true },
  });
  check('Guard: admin cannot ban themselves', selfBan.status === 400, `got ${selfBan.status}`);

  const victimAudits = await AdminAction.find({ targetId: victimId }).lean();
  cleanupIds.audits.push(...victimAudits.map((a) => a._id));
  check(
    'Audit: BAN + UNBAN rows both present',
    victimAudits.length === 2,
    `found ${victimAudits.length}`
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
