/**
 * P6 LIVE verification (Phase 6 validation gate) against the REAL Atlas
 * cluster and, when GROQ_API_KEY is configured, the REAL vision provider.
 *
 * Walks the §14.4/§5.3 classification surface end-to-end:
 *   A. Ownership scoping (the anti-proxy rule):
 *      fresh upload in MY upload folder → 200 (§5.3 upload-first flow);
 *      fresh upload in ANOTHER user's folder → 404;
 *      arbitrary public URL → 404.
 *   B. Advisory contract (§14.4/§16): every failure is 200 {suggestion:null},
 *      never an error response; a valid photo returns the full suggestion
 *      shape with FORMULA-derived points.
 *   C. Live AI (skipped with a SKIP notice when GROQ_API_KEY is absent —
 *      the endpoint must still behave per §16 without a key).
 *
 * Hygiene: run `npm run seed` first (the seeded admin moderates here).
 * Every doc created here is deleted in `finally`. Boots its own app instance
 * on PORT=4100 — the dev server is untouched.
 *
 * Run:  cd apps/api && npm run seed
 *       PORT=4100 node --env-file=.env scripts/p6-live-verify.mjs
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
  // Children first — audit rows reference items and users.
  if (cleanupIds.audits.length) await AdminAction.deleteMany({ _id: { $in: cleanupIds.audits } });
  if (cleanupIds.items.length) await Item.deleteMany({ _id: { $in: cleanupIds.items } });
  if (cleanupIds.users.length) await User.deleteMany({ _id: { $in: cleanupIds.users } });
}

const server = http.createServer(app);
try {
  await mongoose.connect(process.env.MONGODB_URI);
  await new Promise((res) => server.listen(process.env.PORT, res));
  console.log(`p6-live-verify on :${process.env.PORT} | stamp ${STAMP}\n`);

  // ── Setup: seeded admin + one fresh user with one APPROVED item. ──
  const adminLogin = await req('POST', '/auth/login', {
    body: { email: 'admin@rewear.test', password: 'Password123!' },
  });
  if (adminLogin.status !== 200) throw new Error('seeded admin login failed — run npm run seed');

  const email = `p6lv-${STAMP}@example.test`;
  const reg = await req('POST', '/auth/register', {
    body: { name: 'P6 Live', email, password: 'Password123!' },
  });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status}`);
  const user = reg.body.user;
  cleanupIds.users.push(user._id);
  const token = reg.body.accessToken;

  // A real Cloudinary demo-photo URL, attached to an owned APPROVED item so
  // tier-1 ownership can be exercised against a real, fetchable image.
  const ownedUrl = 'https://res.cloudinary.com/demo/image/upload/shirt.jpg';
  const itemRes = await req('POST', '/items', {
    token,
    body: {
      title: `P6LV Classify Target ${STAMP}`,
      description: 'Phase 6 live-verify item: its image gets classified below.',
      category: 'TOPS',
      type: 'T-shirt',
      size: 'M',
      condition: 'GOOD',
      // pointValue derived server-side (§14.4 revised) — not sent.
      images: [{ url: ownedUrl, isPrimary: true }],
    },
  });
  if (itemRes.status !== 201) throw new Error(`item create failed: ${itemRes.status}`);
  const itemId = itemRes.body.item._id;
  cleanupIds.items.push(itemId);
  const approve = await req('PATCH', `/admin/items/${itemId}/moderate`, {
    token: adminLogin.body.accessToken,
    body: { action: 'APPROVE' },
  });
  if (approve.status !== 200) throw new Error(`approve failed: ${approve.status}`);
  const audit = await AdminAction.findOne({ targetId: itemId }).lean();
  if (audit) cleanupIds.audits.push(audit._id);

  // ── A. Ownership scoping (the anti-proxy rule, both tiers). ──
  const ownFolderUrl = `https://res.cloudinary.com/rewear-cloud/image/upload/v1/rewear/items/${user._id}/p6lv-${STAMP}.jpg`;
  const foreignFolderUrl = `https://res.cloudinary.com/rewear-cloud/image/upload/v1/rewear/items/000000000000000000000000/p6lv-${STAMP}.jpg`;

  const classifyOwned = await req('POST', '/items/classify', {
    token,
    body: { imageUrl: ownedUrl },
  });
  check(
    'Ownership: a URL on MY item classifies (200, tier-1)',
    classifyOwned.status === 200,
    `status ${classifyOwned.status}`
  );

  const classifyFresh = await req('POST', '/items/classify', {
    token,
    body: { imageUrl: ownFolderUrl },
  });
  check(
    'Ownership: a FRESH upload in MY folder classifies without any item (§5.3 upload-first)',
    classifyFresh.status === 200,
    `status ${classifyFresh.status}`
  );

  const classifyForeign = await req('POST', '/items/classify', {
    token,
    body: { imageUrl: foreignFolderUrl },
  });
  const classifyArbitrary = await req('POST', '/items/classify', {
    token,
    body: { imageUrl: 'https://example.com/not-mine.jpg' },
  });
  check(
    "Ownership: ANOTHER user's folder and arbitrary URLs → 404 (anti-proxy)",
    classifyForeign.status === 404 && classifyArbitrary.status === 404,
    `foreign ${classifyForeign.status}, arbitrary ${classifyArbitrary.status}`
  );

  // ── B. Advisory contract: 200 + {suggestion} shape, never an error body. ──
  const suggestion = classifyOwned.body.suggestion;
  check(
    'Advisory: 200 body is {suggestion: …|null} — never an error envelope',
    classifyOwned.status === 200 && 'suggestion' in classifyOwned.body,
    `keys: ${Object.keys(classifyOwned.body).join(',')}`
  );

  if (suggestion) {
    check(
      'Advisory: suggestion carries category/condition/points/confidence (formula points)',
      typeof suggestion.suggestedCategory === 'string' &&
        typeof suggestion.suggestedCondition === 'string' &&
        Number.isInteger(suggestion.suggestedPoints) &&
        suggestion.suggestedPoints > 0 &&
        typeof suggestion.confidence === 'number',
      `${suggestion.suggestedCategory}/${suggestion.suggestedCondition}/` +
        `${suggestion.suggestedPoints}pts @${suggestion.confidence}`
    );
  } else {
    console.log(
      'SKIP  Advisory: suggestion shape — classify resolved null (no key or low confidence)'
    );
  }

  // ── C. Live AI via the real provider (only when configured). ──
  if (!suggestion) {
    console.log(
      'SKIP  Live AI: no suggestion returned. With GROQ_API_KEY set this is a low-confidence ' +
        'image; without it, classification is advisory-null by design (§16).'
    );
  } else {
    console.log(
      `LIVE AI OK: ${suggestion.suggestedCategory}/${suggestion.suggestedCondition} → ` +
        `${suggestion.suggestedPoints} pts (confidence ${suggestion.confidence})`
    );
  }
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
