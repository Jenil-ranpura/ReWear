/**
 * Admin — live-monitoring page (post-approval oversight).
 *
 * Problem statement: "Moderate and approve/reject item listings; Remove
 * inappropriate or spam items." The PENDING queue (AdminQueuePage) covers
 * pre-approval moderation; THIS page covers AFTER approval — the admin
 * watches everything currently PUBLIC and can strike a listing that turns
 * out to be spam/inappropriate once live (REMOVE action, reason required).
 * A Removed tab shows the takedown trail (title stays hidden, no existence
 * leak — §15). Success refetches; errors surface as a role=alert banner and
 * the dialog stays open (§5.9).
 *
 * Redesign: tokenized hairline rows, serif title, stroke-icon fallback
 * instead of the emoji thumb, primary-image picker preserved. All logic,
 * testids (admin-details-*, admin-remove-*, admin-live-row), role=tab
 * semantics, and dialog contracts unchanged.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';

import * as adminApi from '../lib/api/admin.js';
import AsyncBoundary from '../components/shared/AsyncBoundary.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import ItemDetailsDialog from '../components/shared/ItemDetailsDialog.jsx';
import Pagination from '../components/shared/Pagination.jsx';
import StatusBadge from '../components/shared/StatusBadge.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import { AdminTabs } from './AdminQueuePage.jsx';

function primaryImage(item) {
  return item.images?.find((i) => i.isPrimary) ?? item.images?.[0] ?? null;
}

export default function AdminLiveItemsPage() {
  const [status, setStatus] = useState('APPROVED');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pendingRemove, setPendingRemove] = useState(null); // item
  const [detailsItem, setDetailsItem] = useState(null); // full-details dialog
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { push } = useToast();

  const listQuery = useQuery({
    queryKey: ['admin-live-items', status, query, page],
    queryFn: () => adminApi.listItems({ status, q: query || undefined, page, pageSize: 12 }),
    placeholderData: keepPreviousData,
  });

  function onSearchSubmit(e) {
    e.preventDefault();
    setPage(1);
    setQuery(search.trim());
  }

  function onRemove(item) {
    setError(null);
    setReason('');
    setPendingRemove(item);
  }

  async function confirmRemove() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.moderate(pendingRemove._id, 'REMOVE', reason.trim());
      setPendingRemove(null);
      push(`“${pendingRemove.title}” removed — no longer publicly visible.`, { tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['admin-live-items'] });
    } catch (err) {
      // Dialog stays open with the error for retry (§5.9).
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const isLiveTab = status === 'APPROVED';

  return (
    <div className="space-y-6">
      <header className="pt-4">
        <p className="eyebrow">Admin</p>
        <h1 className="font-display mt-2 text-4xl text-ink">Live items</h1>
        <p className="mt-2 text-sm text-ink-2">
          Everything currently public. Remove a listing if it turns out to be inappropriate or spam
          after approval — the owner sees the reason.
        </p>
      </header>

      <AdminTabs active="Live items" />

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Item status" className="flex gap-1">
          {['APPROVED', 'REMOVED'].map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => {
                setStatus(s);
                setPage(1);
                setQuery('');
                setSearch('');
              }}
              className={`pressable rounded-[6px] px-3 py-1.5 text-sm font-semibold transition-colors ${
                status === s
                  ? 'bg-ink text-white'
                  : 'bg-white text-ink-2 ring-1 ring-hairline hover:bg-brand-50 hover:text-ink'
              }`}
            >
              {s === 'APPROVED' ? 'Live' : 'Removed'}
            </button>
          ))}
        </div>
        <form onSubmit={onSearchSubmit} className="ml-auto flex gap-2">
          <label htmlFor="live-items-search" className="sr-only">
            Search live items by title
          </label>
          <input
            id="live-items-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title…"
            className="field w-48"
          />
          <button
            type="submit"
            className="pressable rounded-[6px] bg-white px-3 py-1.5 text-sm font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-brand-50"
          >
            Search
          </button>
        </form>
      </div>

      {error && (
        <p role="alert" className="rounded-[6px] bg-red-50 px-4 py-3 text-sm text-status-red">
          {error}
        </p>
      )}

      <AsyncBoundary
        query={listQuery}
        isEmpty={(d) => d?.total === 0}
        empty={
          <div className="card px-6 py-16 text-center">
            <p className="font-display text-2xl text-ink">
              {isLiveTab ? 'No live items match.' : 'Nothing has been removed.'}
            </p>
            <p className="mt-2 text-sm text-ink-2">
              {isLiveTab
                ? 'Approved listings appear here the moment they pass review.'
                : 'Removed listings (and the reason) show up here.'}
            </p>
          </div>
        }
      >
        {(data) => (
          <>
            <p className="tabular text-sm text-ink-2" aria-live="polite">
              {data.total} {isLiveTab ? 'live' : 'removed'} item{data.total === 1 ? '' : 's'}
              {query ? ` matching “${query}”` : ''}
            </p>
            <ul className="space-y-3">
              {data.items.map((item) => (
                <li
                  key={item._id}
                  data-testid="admin-live-row"
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
                      className="flex h-16 w-16 items-center justify-center rounded-[6px] bg-tint"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="h-6 w-6 text-brand-600"
                      >
                        <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z" />
                      </svg>
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/items/${item._id}`}
                        className="font-semibold text-ink underline-offset-2 hover:underline"
                      >
                        {item.title}
                      </Link>
                      <StatusBadge status={item.status} />
                      {item.moderationReason && (
                        <span
                          title={item.moderationReason}
                          className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-status-red"
                        >
                          Removed: {item.moderationReason}
                        </span>
                      )}
                    </div>
                    <p className="tabular text-sm text-ink-2">
                      {item.pointValue} pts · listed by {item.ownerId?.name ?? 'unknown'} (
                      {item.ownerId?.email ?? 'no email'})
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      data-testid={`admin-details-${item._id}`}
                      onClick={() => setDetailsItem(item)}
                      className="pressable rounded-[6px] bg-white px-3 py-2 text-sm font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-brand-50"
                    >
                      Details
                    </button>
                    {isLiveTab && (
                      <button
                        type="button"
                        data-testid={`admin-remove-${item._id}`}
                        onClick={() => onRemove(item)}
                        className="pressable rounded-[6px] bg-white px-3 py-2 text-sm font-semibold text-status-red ring-1 ring-status-red/30 transition-colors hover:bg-red-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} totalPages={data.totalPages} onPage={(p) => setPage(p)} />
          </>
        )}
      </AsyncBoundary>

      {detailsItem && (
        <ItemDetailsDialog open onClose={() => setDetailsItem(null)} item={detailsItem} />
      )}

      {pendingRemove && (
        <ConfirmDialog
          open
          busy={busy}
          danger
          title={`Remove “${pendingRemove.title}”?`}
          message="The listing disappears from Browse immediately and the owner sees the reason. This cannot be undone."
          confirmLabel="Yes, remove it"
          confirmDisabled={!reason.trim()}
          onClose={() => !busy && setPendingRemove(null)}
          onConfirm={confirmRemove}
        >
          <div className="space-y-1">
            <label htmlFor="remove-reason" className="text-sm font-semibold text-ink">
              Reason for the owner <span className="font-normal text-status-red">(required)</span>
            </label>
            <textarea
              id="remove-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Counterfeit brand listing"
              className="field"
            />
            {!reason.trim() && (
              <p className="text-xs text-stone-450">A reason is required to enable Remove.</p>
            )}
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
