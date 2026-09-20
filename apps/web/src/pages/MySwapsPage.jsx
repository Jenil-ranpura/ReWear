/**
 * P5-T5 — Swap requests (§5.7/§2 dashboard row). Incoming (on MY items —
 * I act) and outgoing (MY requests — I can cancel) tabs. Accept/reject/
 * cancel are CONFIRMED via <ConfirmDialog> (§13) and mutate through the
 * single-flight client; the row list refetches after success (server state
 * is the truth — accept transfers ownership/points atomically, §5.7).
 * Errors surface as a role=alert banner and the dialog stays open for retry.
 *
 * Session 14 — NEW-request highlight: unseen PENDING incoming rows render
 * with a brand ring + NEW badge (user request: owners should spot fresh
 * requests first). Seen-state is CLIENT-side per-user localStorage
 * (lib/seenRequests.js — UX nicety, not business data): the highlight is
 * computed from the PREVIOUS visit's set, then the displayed ids are marked
 * seen — so a row stays highlighted for the whole visit and clears by the
 * next. There is deliberately no server field for this.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import * as swapsApi from '../lib/api/swaps.js';
import useNewSwapRequests from '../hooks/useNewSwapRequests.js';
import { useAuth } from '../state/AuthContext.jsx';
import AsyncBoundary from '../components/shared/AsyncBoundary.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import SwapRequestRow from '../components/swaps/SwapRequestRow.jsx';

const ACTION_COPY = {
  ACCEPT: {
    title: 'Accept this swap?',
    message:
      'This transfers the item (and points, for redemptions) immediately and cannot be undone. Other pending requests on the item are declined automatically.',
    confirmLabel: 'Accept',
    toast: 'Swap accepted — the item has changed hands.',
  },
  REJECT: {
    title: 'Reject this request?',
    message: 'The requester will see it was declined.',
    confirmLabel: 'Reject',
    toast: 'Request rejected.',
  },
  CANCEL: {
    title: 'Cancel this request?',
    message: 'Your request will be withdrawn.',
    confirmLabel: 'Yes, cancel it', // ≠ the dialog's own dismiss button — two identical "Cancel" buttons would be ambiguous
    toast: 'Request cancelled.',
  },
};

export default function MySwapsPage() {
  const [direction, setDirection] = useState('incoming');
  const [pendingAction, setPendingAction] = useState(null); // { request, action }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { push } = useToast();

  const swapsQuery = useQuery({
    queryKey: ['swap-requests', direction],
    queryFn: () => swapsApi.list(direction),
  });

  // ── NEW-request highlight (shared hook, PAGE mode). ──
  // The incoming query data is passed in (no second fetch); the hook
  // snapshots the seen-set once per visit, derives newIds, and persists
  // seen ids after render — highlight survives this visit, clears next.
  const incomingRequests = swapsQuery.data?.requests ?? [];
  const { newIds } = useNewSwapRequests({
    user,
    requests: direction === 'incoming' ? incomingRequests : [],
  });

  function onAction(request, action) {
    setError(null);
    setPendingAction({ request, action });
  }

  async function confirmAction() {
    setBusy(true);
    setError(null);
    try {
      await swapsApi.act(pendingAction.request._id, pendingAction.action);
      setPendingAction(null);
      // §13 toast feedback: the §5.7 transfer is atomic and the lists
      // refetch below — the toast confirms the outcome in plain language.
      push(ACTION_COPY[pendingAction.action].toast, {
        tone: 'success',
        action:
          pendingAction.action === 'ACCEPT'
            ? { label: 'View items', to: '/dashboard/items' }
            : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['swap-requests'] });
      // Balances/items may have changed on accept — refresh anything cached.
      await queryClient.invalidateQueries({ queryKey: ['item'] });
      await queryClient.invalidateQueries({ queryKey: ['my-items'] });
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-stone-900">Swap requests</h1>
        <p className="mt-1 text-sm text-stone-500">
          Requests on your items, and requests you&apos;ve made.
        </p>
      </header>

      <div role="tablist" aria-label="Swap request direction" className="flex gap-2">
        {['incoming', 'outgoing'].map((dir) => (
          <button
            key={dir}
            type="button"
            role="tab"
            aria-selected={direction === dir}
            onClick={() => setDirection(dir)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold capitalize transition ${
              direction === dir
                ? 'bg-brand-700 text-white'
                : 'bg-white text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50'
            }`}
          >
            {dir}
            {/* NEW-count chip: how many unseen pending requests wait on the
                incoming tab (0 → no chip — never visual noise). */}
            {dir === 'incoming' && newIds.size > 0 && (
              <span
                data-testid="new-count-chip"
                className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-brand-700"
              >
                {newIds.size}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <AsyncBoundary
        query={swapsQuery}
        isEmpty={(d) => d?.requests?.length === 0}
        empty={
          <div className="rounded-xl bg-white p-12 text-center shadow-sm ring-1 ring-stone-200">
            <p className="text-lg font-semibold text-stone-800">
              {direction === 'incoming'
                ? 'No requests on your items yet'
                : 'You haven\u2019t requested anything yet'}
            </p>
            <p className="mt-1 text-stone-500">
              {direction === 'incoming'
                ? 'When someone wants one of your listings, it shows up here.'
                : 'Browse items and request a swap or redeem with points.'}
            </p>
          </div>
        }
      >
        {(data) => (
          <ul className="space-y-3">
            {data.requests.map((request) => (
              <SwapRequestRow
                key={request._id}
                request={request}
                direction={direction}
                onAction={onAction}
                isNew={newIds.has(request._id)}
              />
            ))}
          </ul>
        )}
      </AsyncBoundary>

      {pendingAction && (
        <ConfirmDialog
          open
          busy={busy}
          title={ACTION_COPY[pendingAction.action].title}
          message={ACTION_COPY[pendingAction.action].message}
          confirmLabel={ACTION_COPY[pendingAction.action].confirmLabel}
          danger={pendingAction.action !== 'ACCEPT'}
          onConfirm={confirmAction}
          onClose={() => !busy && setPendingAction(null)}
        />
      )}
    </div>
  );
}
