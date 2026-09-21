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
      <header>
        <h1 className="text-2xl font-bold text-stone-900">Admin — live items</h1>
        <p className="mt-1 text-sm text-stone-500">
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
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                status === s
                  ? 'bg-stone-800 text-white'
                  : 'bg-white text-stone-600 ring-1 ring-stone-300 hover:bg-stone-50'
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
            className="w-48 rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button
            type="submit"
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
          >
            Search
          </button>
        </form>
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
        query={listQuery}
        isEmpty={(d) => d?.total === 0}
        empty={
          <div className="rounded-xl bg-white p-12 text-center shadow-sm ring-1 ring-stone-200">
            <p className="text-lg font-semibold text-stone-800">
              {isLiveTab ? 'No live items match.' : 'Nothing has been removed.'}
            </p>
            <p className="mt-1 text-stone-500">
              {isLiveTab
                ? 'Approved listings appear here the moment they pass review.'
                : 'Removed listings (and the reason) show up here.'}
            </p>
          </div>
        }
      >
        {(data) => (
          <>
            <p className="text-sm text-stone-500" aria-live="polite">
              {data.total} {isLiveTab ? 'live' : 'removed'} item{data.total === 1 ? '' : 's'}
              {query ? ` matching “${query}”` : ''}
            </p>
            <ul className="space-y-3">
              {data.items.map((item) => (
                <li
                  key={item._id}
                  data-testid="admin-live-row"
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
                      <Link
                        to={`/items/${item._id}`}
                        className="font-semibold text-stone-900 hover:underline"
                      >
                        {item.title}
                      </Link>
                      <StatusBadge status={item.status} />
                      {item.moderationReason && (
                        <span
                          title={item.moderationReason}
                          className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800"
                        >
                          Removed: {item.moderationReason}
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
                      data-testid={`admin-details-${item._id}`}
                      onClick={() => setDetailsItem(item)}
                      className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
                    >
                      Details
                    </button>
                    {isLiveTab && (
                      <button
                        type="button"
                        data-testid={`admin-remove-${item._id}`}
                        onClick={() => onRemove(item)}
                        className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-300 hover:bg-red-50"
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
            <label htmlFor="remove-reason" className="text-sm font-semibold text-stone-700">
              Reason for the owner <span className="font-normal text-red-600">(required)</span>
            </label>
            <textarea
              id="remove-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Counterfeit brand listing"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
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
