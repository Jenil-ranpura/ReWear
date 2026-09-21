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
import ItemDetailsDialog from '../components/shared/ItemDetailsDialog.jsx';
import Pagination from '../components/shared/Pagination.jsx';
import StatusBadge from '../components/shared/StatusBadge.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';

/** Sibling-tab bar shared by the admin pages (§12 sitemap routes). Dense,
 * calm, hairline — Linear-like. */
export function AdminTabs({ active }) {
  const tab = (to, label) => (
    <NavLink
      to={to}
      className={`pressable rounded-[6px] px-4 py-2 text-sm font-semibold transition-colors ${
        active === label
          ? 'bg-brand-700 text-white'
          : 'bg-white text-ink-2 ring-1 ring-hairline hover:bg-brand-50 hover:text-ink'
      }`}
    >
      {label}
    </NavLink>
  );
  return (
    <div role="tablist" aria-label="Admin sections" className="flex flex-wrap gap-2">
      {tab('/admin', 'Pending items')}
      {tab('/admin/live', 'Live items')}
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
  const [detailsItem, setDetailsItem] = useState(null); // full-details dialog
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
      <header className="pt-4">
        <p className="eyebrow">Admin</p>
        <h1 className="font-display mt-2 text-4xl text-ink">Moderation queue</h1>
        <p className="mt-2 text-sm text-ink-2">
          New listings wait here until approved. Oldest first, so nothing stalls.
        </p>
      </header>

      <AdminTabs active="Pending items" />

      {error && (
        <p role="alert" className="rounded-[6px] bg-red-50 px-4 py-3 text-sm text-status-red">
          {error}
        </p>
      )}

      <AsyncBoundary
        query={queueQuery}
        isEmpty={(d) => d?.total === 0}
        empty={
          <div className="card px-6 py-16 text-center">
            <p className="font-display text-2xl text-ink">The queue is clear</p>
            <p className="mt-2 text-sm text-ink-2">No listings are waiting for review right now.</p>
          </div>
        }
      >
        {(data) => (
          <>
            <p className="tabular text-sm text-ink-2" aria-live="polite">
              {data.total} item{data.total === 1 ? '' : 's'} awaiting review
            </p>
            <ul className="space-y-3">
              {data.items.map((item) => (
                <li
                  key={item._id}
                  data-testid="admin-queue-row"
                  className="card flex flex-wrap items-center gap-4 p-4"
                >
                  {primaryImage(item) ? (
                    <img
                      src={primaryImage(item).url}
                      alt={`Photo of ${item.title}`}
                      loading="lazy"
                      decoding="async"
                      className="h-16 w-16 rounded-[6px] object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="font-display flex h-16 w-16 items-center justify-center rounded-[6px] bg-tint text-2xl text-brand-700"
                    >
                      {(item.title ?? '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{item.title}</span>
                      <StatusBadge status={item.status} />
                      {item.moderationReason && (
                        <span
                          title={item.moderationReason}
                          className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-status-amber ring-1 ring-amber-200/60"
                        >
                          Flagged for review
                        </span>
                      )}
                    </div>
                    <p className="tabular text-sm text-ink-2">
                      {item.pointValue} pts · listed by {item.ownerId?.name ?? 'unknown'} (
                      {item.ownerId?.email ?? 'no email'})
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {/* Judge with context: full details BEFORE deciding. */}
                    <button
                      type="button"
                      data-testid={`admin-details-${item._id}`}
                      onClick={() => setDetailsItem(item)}
                      className="pressable rounded-[6px] bg-white px-3 py-2 text-sm font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-brand-50"
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      onClick={() => onAction(item, 'APPROVE')}
                      className="pressable rounded-[6px] bg-brand-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => onAction(item, 'REJECT')}
                      className="pressable rounded-[6px] bg-white px-3 py-2 text-sm font-semibold text-status-red ring-1 ring-status-red/30 transition-colors hover:bg-red-50"
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

      {/* Full product details — read-only, so a reading mistake can't fire
        a mutation; Approve/Reject stay on the row. */}
      {detailsItem && (
        <ItemDetailsDialog open onClose={() => setDetailsItem(null)} item={detailsItem} />
      )}

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
              <label htmlFor="reject-reason" className="text-sm font-semibold text-ink">
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
                className="field"
              />
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
