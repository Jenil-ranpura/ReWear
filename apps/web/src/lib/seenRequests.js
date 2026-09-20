/**
 * Seen-tracking for incoming swap requests (Session 14, user request:
 * "owners should spot NEW pending requests first").
 *
 * CLIENT-side by design: "seen" is a UX nicety, not business data — it must
 * not cost an API round-trip or a schema field. Per-USER localStorage key so
 * two accounts on one browser never share the highlight state, and the id
 * list is CAPPED so it can never grow unbounded.
 *
 * Contract: `markSeen` is called ONCE per incoming-list load with the ids
 * just displayed; the page renders the highlight from the PREVIOUS set, so
 * new rows stay highlighted for the whole visit and clear by the next one.
 */

const KEY_PREFIX = 'rewear.seenSwapRequests.';
const MAX_IDS = 200;

function keyFor(userId) {
  return `${KEY_PREFIX}${userId ?? 'anon'}`;
}

/** Ids already seen by this user (defensive: bad JSON → empty set). */
export function getSeenIds(userId) {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set(); // storage unavailable/disabled → everything looks new; harmless
  }
}

/** Persist the merged id set (oldest dropped past the cap). Never throws. */
export function markSeenIds(userId, ids) {
  try {
    const merged = [...getSeenIds(userId), ...ids];
    window.localStorage.setItem(keyFor(userId), JSON.stringify(merged.slice(-MAX_IDS)));
  } catch {
    /* private mode / quota — highlight simply re-shows next visit */
  }
}
