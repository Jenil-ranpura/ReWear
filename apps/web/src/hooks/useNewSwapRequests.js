/**
 * useNewSwapRequests — shared signal for "how many unseen PENDING swap
 * requests are waiting on MY items" (Session 14, user request: owners should
 * spot fresh requests from anywhere, not only inside /dashboard/swaps).
 *
 * ONE implementation, two usage modes (no duplicate abstractions):
 * - AMBIENT (default): Layout navbar + Dashboard card. Runs its own incoming
 *   query (60s poll + focus refetch) and re-reads the seen-set on EVERY data
 *   change — so a visit to /dashboard/swaps (which marks ids seen) is
 *   reflected on the next refetch. NEVER writes seen-state.
 * - PAGE mode (`requests` provided): MySwapsPage passes ITS OWN incoming
 *   list — no second fetch. The seen-set is snapshotted once per visit (ref)
 *   so refetches after accept/reject never un-highlight mid-session, and the
 *   displayed ids are marked seen AFTER render values are derived (this
 *   visit keeps the highlight; the next one doesn't).
 *
 * Seen-state itself lives in lib/seenRequests.js (per-user localStorage,
 * client-side by design — a UX nicety, not business data).
 *
 * Cache-key note: the ambient query uses ['swap-requests', 'incoming',
 * 'ambient'] — the 'swap-requests' PREFIX still matches the swaps page's
 * invalidateQueries({ queryKey: ['swap-requests'] }), so accepting/rejecting
 * on the page refetches the navbar badge for free.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import * as swapsApi from '../lib/api/swaps.js';
import { getSeenIds, markSeenIds } from '../lib/seenRequests.js';

export default function useNewSwapRequests({ user, requests = null } = {}) {
  const isAmbient = requests === null;
  const userId = user?._id ?? user?.id;

  // Ambient mode runs its own lightweight poll (paused while the tab is
  // hidden — refetchIntervalInBackground defaults to false).
  const ambientQuery = useQuery({
    queryKey: ['swap-requests', 'incoming', 'ambient'],
    queryFn: () => swapsApi.list('incoming'),
    enabled: isAmbient && Boolean(user),
    refetchInterval: 60_000,
  });

  const data = isAmbient ? ambientQuery.data?.requests : requests;

  // PAGE mode: snapshot the seen-set ONCE per visit (stable across refetches).
  const seenRef = useRef(null);
  if (!isAmbient && seenRef.current === null && userId) {
    seenRef.current = getSeenIds(userId);
  }

  const unseen = useMemo(() => {
    if (!userId || !data) return new Set();
    // Ambient: read the CURRENT seen-state every pass — a swaps-page visit
    // that marked ids seen is reflected on the next poll/focus refetch.
    const seen = isAmbient ? getSeenIds(userId) : (seenRef.current ?? new Set());
    return new Set(
      data.filter((r) => r.status === 'PENDING' && !seen.has(r._id)).map((r) => r._id)
    );
  }, [isAmbient, userId, data]);

  // PAGE mode only: persist AFTER render values are derived (§ ordering).
  useEffect(() => {
    if (isAmbient || !userId || !data?.length) return;
    markSeenIds(
      userId,
      data.map((r) => r._id)
    );
    seenRef.current = getSeenIds(userId);
  }, [isAmbient, userId, data]);

  if (isAmbient) {
    return { count: unseen.size, requests: data ?? [], isLoading: ambientQuery.isLoading };
  }
  return { newIds: unseen, count: unseen.size, requests: data ?? [] };
}
