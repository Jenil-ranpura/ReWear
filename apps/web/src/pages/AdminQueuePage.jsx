/**
 * P5-T6 — Admin moderation queue (§5.8). Oldest-first PENDING queue with the
 * owner shown; Approve/Reject each open a <ConfirmDialog> (§13), with a
 * reason field on REJECT (§5.8: optional but encouraged — pre-filled with the
 * §14.5 duplicate-image advisory when one exists). Success refetches the
 * queue (the item leaves it); errors surface as a role=alert banner and the
 * dialog stays open for retry (§5.9). /admin renders this queue directly
 * (the §5.8 flow starts here); Users is a sibling tab.
 */

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';

import * as adminApi from '../lib/api/admin.js';
import AsyncBoundary from '../components/shared/AsyncBoundary.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import Pagination from '../components/shared/Pagination.jsx';
import StatusBadge from '../components/shared/StatusBadge.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';

/** Sibling-tab bar shared by the two admin pages (§12 sitemap routes). */
export function AdminTabs({ active }) {
  const tab = (to, label) => (
    <NavLink
      to={to}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
        active === label
          ? 'bg-brand-700 text-white'
          : 'bg-white text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50'
      }`}
    >
      {label}
    </NavLink>
  );
  return (
    <div role="tablist" aria-label="Admin sections" className="flex gap-2">
      {tab('/admin', 'Pending items')}
      {tab('/admin/users', 'Users')}
      {tab('/admin/reports', 'Reports')}
    </div>
  );
}

function primaryImage(item) {
  return item.images?.find((i) => i.isPrimary) ?? item.images?.[0] ?? null;
}

export default function AdminQueuePage() {
  const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState(null); // { item, action }
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { push } = useToast();

  const queueQuery = useQuery({
    queryKey: ['admin-pending', page],
    queryFn: () => adminApi.pendingItems({ page, pageSize: 12 }),
    placeholderData: keepPreviousData,
  });

  function onAction(item, action) {
    setError(null);
    // §14.5: pre-fill the reason with the duplicate advisory when present.
    setReason(action === 'REJECT' ? (item.moderationReason ?? '') : '');
    setPendingAction({ item, action });
  }

  async function confirmAction() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.moderate(
        pendingAction.item._id,
        pendingAction.action,
        reason.trim() || undefined
      );
      setPendingAction(null);
      // §13 toast feedback: name the outcome AND the item (the queue row is
      // about to disappear via refetch, so the toast carries the context).
      push(
        pendingAction.action === 'APPROVE'
          ? `“${pendingAction.item.title}” approved — now publicly visible.`
          : `“${pendingAction.item.title}” rejected.`,
        { tone: 'success' }
      );
      await queryClient.invalidateQueries({ queryKey: ['admin-pending'] });
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-stone-900">Admin — moderation</h1>
        <p className="mt-1 text-sm text-stone-500">
          New listings wait here until approved. Oldest first, so nothing stalls.
        </p>
      </header>

      <AdminTabs active="Pending items" />

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <AsyncBoundary
        query={queueQuery}
        isEmpty={(d) => d?.total === 0}
        empty={
          <div className="rounded-xl bg-white p-12 text-center shadow-sm ring-1 ring-stone-200">
            <p className="text-lg font-semibold text-stone-800">The queue is clear</p>
            <p className="mt-1 text-stone-500">No listings are waiting for review right now.</p>
          </div>
        }
      >
        {(data) => (
          <>
            <p className="text-sm text-stone-500" aria-live="polite">
              {data.total} item{data.total === 1 ? '' : 's'} awaiting review
            </p>
            <ul className="space-y-3">
              {data.items.map((item) => (
                <li
                  key={item._id}
                  data-testid="admin-queue-row"
                  className="flex flex-wrap items-center gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
                >
                  {primaryImage(item) ? (
                    <img
                      src={primaryImage(item).url}
                      alt={`Photo of ${item.title}`}
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="flex h-16 w-16 items-center justify-center rounded-lg bg-stone-100 text-xl"
                    >
                      👕
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-stone-900">{item.title}</span>
                      <StatusBadge status={item.status} />
                      {item.moderationReason && (
                        <span
                          title={item.moderationReason}
                          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                        >
                          ⚠ Flagged for review
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-stone-500">
                      {item.pointValue} pts · listed by {item.ownerId?.name ?? 'unknown'} (
                      {item.ownerId?.email ?? 'no email'})
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onAction(item, 'APPROVE')}
                      className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => onAction(item, 'REJECT')}
                      className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-300 hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} totalPages={data.totalPages} onPage={(p) => setPage(p)} />
          </>
        )}
      </AsyncBoundary>

      {pendingAction && (
        <ConfirmDialog
          open
          busy={busy}
          danger={pendingAction.action === 'REJECT'}
          title={
            pendingAction.action === 'APPROVE'
              ? `Approve “${pendingAction.item.title}”?`
              : `Reject “${pendingAction.item.title}”?`
          }
          message={
            pendingAction.action === 'APPROVE'
              ? 'The listing becomes publicly visible in Browse immediately.'
              : 'The listing stays hidden from Browse and the owner sees it was rejected.'
          }
          confirmLabel={pendingAction.action === 'APPROVE' ? 'Approve' : 'Reject'}
          onClose={() => !busy && setPendingAction(null)}
          onConfirm={confirmAction}
        >
          {pendingAction.action === 'REJECT' && (
            <div className="space-y-1">
              <label htmlFor="reject-reason" className="text-sm font-semibold text-stone-700">
                Reason for the owner{' '}
                <span className="font-normal text-stone-450">(encouraged)</span>
              </label>
              <textarea
                id="reject-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Photos don’t match the described condition"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
              />
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
