/**
 * <SwapArrivalWatcher> (Session 14, user request: "subtle toast or sound
 * when a new swap request arrives while the tab is open").
 *
 * P7-T3 refactor: toast RENDERING moved to the shared <ToastProvider> (one
 * viewport / aria / auto-dismiss pattern for the whole app — no second toast
 * implementation). This component keeps the ARRIVAL SUBTLETY LOGIC:
 *
 * Consumes the AMBIENT incoming feed from useNewSwapRequests (one poll for
 * the whole app — navbar badge, dashboard card, and this watcher all share
 * it) and turns FRESH arrivals into a quiet toast via useToast().push()
 * (bottom-right, role="status", auto-dismiss 8s, "View" link to
 * /dashboard/swaps) plus the synthesized chime (lib/chime.js, per-user mute
 * persisted).
 *
 * The subtlety rules (why the baseline exists):
 * - On FIRST load the current pending set IS the baseline — no toast, no
 *   chime. The app must not greet a returning owner with three pings for
 *   requests that arrived while they were away; the navbar badge already
 *   tells that story.
 * - Only requests created within the last POLL_INTERVAL_MS are celebrated:
 *   anything older is baseline contamination (clock-skewed server times,
 *   a poll that raced a marking-seen write) and stays silent.
 * - Requests the owner has ALREADY SEEN (revisited list) never re-toast.
 */

import { useEffect, useRef } from 'react';

import useNewSwapRequests from '../../hooks/useNewSwapRequests.js';
import { isChimeMuted, playChime } from '../../lib/chime.js';
import { useAuth } from '../../state/AuthContext.jsx';
import { useToast } from '../shared/ToastProvider.jsx';

const POLL_INTERVAL_MS = 60_000; // keep in step with the hook's refetchInterval
const TOAST_TTL_MS = 8_000;

export default function SwapArrivalWatcher() {
  const { user, status } = useAuth();
  const { push } = useToast();
  // AMBIENT mode: shares the navbar badge's single poll. `isLoading` is the
  // load flag — the baseline MUST be captured on the first pass that has
  // DATA, not the first effect run (which sees an empty list while the
  // auth restore + query are still in flight — that bug made every
  // already-waiting request toast on load).
  const { requests, isLoading } = useNewSwapRequests({ user });

  // The pending-id set from the FIRST load — arrivals here are "was already
  // there", never celebrated.
  const baselineRef = useRef(null);
  const seenRef = useRef(new Set()); // ids already toasted this session

  useEffect(() => {
    // Skip until auth is resolved AND the incoming list has actually loaded:
    // the baseline is the first DATA-BEARING pass (an empty pass is just the
    // loader, not "the owner genuinely has zero pending requests").
    if (status !== 'authenticated' || !user || isLoading) return;
    const userId = user._id ?? user.id;

    // FIRST DATA pass: everything currently pending IS the baseline — no
    // toast, no chime (the app must not greet a returning owner with pings
    // for requests that arrived while they were away; the navbar badge
    // already tells that story). From the next pass on, any pending id
    // NOT in the baseline set is a live arrival while the tab was open.
    const isFirstPass = baselineRef.current === null;
    if (isFirstPass) baselineRef.current = new Set();

    for (const request of requests) {
      if (request.status !== 'PENDING') {
        if (!isFirstPass) baselineRef.current.add(request._id);
        continue;
      }

      if (!isFirstPass && !baselineRef.current.has(request._id)) {
        // Fresh = created within one poll window (older "new" ids are
        // backfill/clock-skew contamination — stay silent) and not already
        // toasted this session.
        const fresh =
          request.createdAt &&
          Date.now() - new Date(request.createdAt).getTime() < POLL_INTERVAL_MS &&
          !seenRef.current.has(request._id);
        if (fresh) {
          seenRef.current.add(request._id);
          if (!isChimeMuted(userId)) playChime();
          push(
            `New swap request: ${request.requesterId?.name ?? 'Someone'} wants to swap — take a look when you can.`,
            {
              tone: 'info',
              action: { label: 'View', to: '/dashboard/swaps' },
              ttlMs: TOAST_TTL_MS,
              testId: 'swap-arrival-toast', // Session 14 test contract
            }
          );
        }
      }

      // Observed = baseline from now on ("already toasted" and "was already
      // there" converge into one mechanism after the first render).
      baselineRef.current.add(request._id);
    }
  }, [requests, status, user, isLoading, push]);

  // Headless: the shared ToastProvider (mounted by Layout) renders the
  // viewport; there is nothing to draw here.
  return null;
}
