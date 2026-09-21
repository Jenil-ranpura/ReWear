/**
 * P5-T6 — Admin users panel (§10 GET /admin/users + PATCH ban). Search by
 * name/email (q), role and banned filters, paginated. BAN/UNBAN go through
 * <ConfirmDialog> (danger for ban — banned users lose their session on their
 * next request, §11). Reason optional (stored on the AdminAction audit row).
 * Errors surface as a role=alert banner; the dialog stays open for retry.
 *
 * Redesign: dense hairline rows on the token system (same family as the
 * queue), serif page title, quiet pill filters. All queries, testids, and
 * flows unchanged.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';

import * as adminApi from '../lib/api/admin.js';
import AsyncBoundary from '../components/shared/AsyncBoundary.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import Pagination from '../components/shared/Pagination.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import { AdminTabs } from './AdminQueuePage.jsx';

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export default function AdminUsersPage() {
  const [qInput, setQInput] = useState('');
  const [role, setRole] = useState('');
  const [banned, setBanned] = useState(''); // '' = any, 'true' / 'false'
  const [page, setPage] = useState(1);
  const [pendingBan, setPendingBan] = useState(null); // { user, next }
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { push } = useToast();

  const usersQuery = useQuery({
    queryKey: ['admin-users', { q: qInput, role, banned, page }],
    queryFn: () =>
      adminApi.listUsers({
        q: qInput,
        role: role || undefined,
        banned: banned === '' ? undefined : banned === 'true',
        page,
        pageSize: 20,
      }),
    placeholderData: keepPreviousData,
  });

  // Any filter change resets to page 1 (browse convention).
  function resetAndRefresh(changes) {
    setPage(1);
    if ('q' in changes) setQInput(changes.q);
    if ('role' in changes) setRole(changes.role);
    if ('banned' in changes) setBanned(changes.banned);
  }

  function onBan(user, next) {
    setError(null);
    setReason('');
    setPendingBan({ user, next });
  }

  async function confirmBan() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.setBanned(pendingBan.user._id, pendingBan.next, reason.trim() || undefined);
      setPendingBan(null);
      push(
        pendingBan.next
          ? `${pendingBan.user.name} is banned — signed out on their next request.`
          : `${pendingBan.user.name} can log in again.`,
        { tone: 'success' }
      );
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const filterButton = (active) =>
    `pressable rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors ${
      active
        ? 'bg-brand-700 text-white ring-brand-700'
        : 'bg-white text-ink-2 ring-hairline hover:bg-brand-50 hover:text-ink'
    }`;

  return (
    <div className="space-y-6">
      <header className="pt-4">
        <p className="eyebrow">Admin</p>
        <h1 className="font-display mt-2 text-4xl text-ink">Users</h1>
        <p className="mt-2 text-sm text-ink-2">
          Search accounts and manage access. Banned users are signed out on their next request.
        </p>
      </header>

      <AdminTabs active="Users" />

      {error && (
        <p role="alert" className="rounded-[6px] bg-red-50 px-4 py-3 text-sm text-status-red">
          {error}
        </p>
      )}

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <form
          className="flex min-w-56 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            resetAndRefresh({ q: qInput });
          }}
        >
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search name or email…"
            aria-label="Search users"
            className="field"
          />
          <button
            type="submit"
            className="pressable rounded-[6px] bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
          >
            Search
          </button>
        </form>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Role filter">
          {['', 'USER', 'ADMIN'].map((r) => (
            <button
              key={r || 'any'}
              type="button"
              onClick={() => resetAndRefresh({ role: r })}
              className={filterButton(role === r)}
            >
              {r === '' ? 'All roles' : r}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Banned filter">
          {[
            ['', 'Any status'],
            ['false', 'Active'],
            ['true', 'Banned'],
          ].map(([value, label]) => (
            <button
              key={value || 'any'}
              type="button"
              onClick={() => resetAndRefresh({ banned: value })}
              className={filterButton(banned === value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <AsyncBoundary
        query={usersQuery}
        isEmpty={(d) => d?.total === 0}
        empty={
          <div className="card px-6 py-16 text-center">
            <p className="font-display text-2xl text-ink">No users match</p>
            <p className="mt-2 text-sm text-ink-2">
              Try a different search term or clearing the filters.
            </p>
          </div>
        }
      >
        {(data) => (
          <>
            <p className="tabular text-sm text-ink-2" aria-live="polite">
              {data.total} user{data.total === 1 ? '' : 's'} found
            </p>
            <ul className="card divide-y divide-hairline overflow-hidden">
              {data.users.map((user) => (
                <li
                  key={user._id}
                  data-testid="admin-user-row"
                  className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-brand-50/40"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Name links to the investigation view (evidence kit) —
                          the admin can pull the full history before acting. */}
                      <Link
                        to={`/admin/users/${user._id}`}
                        className="font-semibold text-ink underline-offset-2 hover:underline"
                      >
                        {user.name}
                      </Link>
                      {user.role === 'ADMIN' && (
                        <span className="rounded-full bg-tint px-2 py-0.5 text-xs font-semibold text-brand-700">
                          ADMIN
                        </span>
                      )}
                      {user.isBanned && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-status-red">
                          BANNED
                        </span>
                      )}
                    </div>
                    <p className="tabular text-sm text-ink-2">
                      {user.email} · {user.pointsBalance ?? 0} pts · joined{' '}
                      {formatDate(user.createdAt)}
                    </p>
                    <p className="text-xs text-brand-700">
                      <Link to={`/admin/users/${user._id}`} className="link-underline">
                        View details →
                      </Link>
                    </p>
                  </div>
                  {user.isBanned ? (
                    <button
                      type="button"
                      onClick={() => onBan(user, false)}
                      className="pressable rounded-[6px] bg-white px-3 py-2 text-sm font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-brand-50"
                    >
                      Unban
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onBan(user, true)}
                      className="pressable rounded-[6px] bg-white px-3 py-2 text-sm font-semibold text-status-red ring-1 ring-status-red/30 transition-colors hover:bg-red-50"
                    >
                      Ban
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <Pagination page={data.page} totalPages={data.totalPages} onPage={(p) => setPage(p)} />
          </>
        )}
      </AsyncBoundary>

      {pendingBan && (
        <ConfirmDialog
          open
          busy={busy}
          danger={pendingBan.next}
          title={
            pendingBan.next ? `Ban ${pendingBan.user.name}?` : `Unban ${pendingBan.user.name}?`
          }
          message={
            pendingBan.next
              ? 'They are signed out on their next request and cannot log in until unbanned.'
              : 'They can log in and use the platform again.'
          }
          confirmLabel={pendingBan.next ? 'Ban user' : 'Unban user'}
          onClose={() => !busy && setPendingBan(null)}
          onConfirm={confirmBan}
        >
          <div className="space-y-1">
            <label htmlFor="ban-reason" className="text-sm font-semibold text-ink">
              Reason <span className="font-normal text-stone-450">(stored in the audit log)</span>
            </label>
            <textarea
              id="ban-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Repeated fraudulent listings"
              className="field"
            />
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
