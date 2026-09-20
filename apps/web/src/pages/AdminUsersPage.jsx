/**
 * P5-T6 — Admin users panel (§10 GET /admin/users + PATCH ban). Search by
 * name/email (q), role and banned filters, paginated. BAN/UNBAN go through
 * <ConfirmDialog> (danger for ban — banned users lose their session on their
 * next request, §11). Reason optional (stored on the AdminAction audit row).
 * Errors surface as a role=alert banner; the dialog stays open for retry.
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
    `rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${
      active
        ? 'bg-brand-700 text-white ring-brand-600'
        : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50'
    }`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-stone-900">Admin — users</h1>
        <p className="mt-1 text-sm text-stone-500">
          Search accounts and manage access. Banned users are signed out on their next request.
        </p>
      </header>

      <AdminTabs active="Users" />

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <form
          className="flex flex-1 gap-2"
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
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
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
          <div className="rounded-xl bg-white p-12 text-center shadow-sm ring-1 ring-stone-200">
            <p className="text-lg font-semibold text-stone-800">No users match</p>
            <p className="mt-1 text-stone-500">
              Try a different search term or clearing the filters.
            </p>
          </div>
        }
      >
        {(data) => (
          <>
            <p className="text-sm text-stone-500" aria-live="polite">
              {data.total} user{data.total === 1 ? '' : 's'} found
            </p>
            <ul className="divide-y divide-stone-100 rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
              {data.users.map((user) => (
                <li
                  key={user._id}
                  data-testid="admin-user-row"
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Name links to the investigation view (evidence kit) —
                          the admin can pull the full history before acting. */}
                      <Link
                        to={`/admin/users/${user._id}`}
                        className="font-semibold text-stone-900 hover:text-brand-700 hover:underline"
                      >
                        {user.name}
                      </Link>
                      {user.role === 'ADMIN' && (
                        <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-800">
                          ADMIN
                        </span>
                      )}
                      {user.isBanned && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
                          BANNED
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-stone-500">
                      {user.email} · {user.pointsBalance ?? 0} pts · joined{' '}
                      {formatDate(user.createdAt)}
                    </p>
                    <p className="text-xs text-brand-700">
                      <Link to={`/admin/users/${user._id}`} className="hover:underline">
                        View details →
                      </Link>
                    </p>
                  </div>
                  {user.isBanned ? (
                    <button
                      type="button"
                      onClick={() => onBan(user, false)}
                      className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
                    >
                      Unban
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onBan(user, true)}
                      className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-300 hover:bg-red-50"
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
            <label htmlFor="ban-reason" className="text-sm font-semibold text-stone-700">
              Reason <span className="font-normal text-stone-450">(stored in the audit log)</span>
            </label>
            <textarea
              id="ban-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Repeated fraudulent listings"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
            />
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
