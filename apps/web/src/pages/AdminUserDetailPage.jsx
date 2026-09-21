/**
 * AdminUserDetailPage — the INVESTIGATION view (user-requested evidence kit).
 * When a report lands on someone (or an admin is deciding a ban), this page
 * answers "what has this account actually done?" in one place:
 *
 *   profile + contact · items · swaps · points ledger · reports by/against
 *   them · admin actions taken on them
 *
 * Read-only: every action (ban/unban, report resolution) stays on its own
 * surface — this page is the evidence, not the courtroom. Reached from the
 * Users panel row (GET /admin/users/:id, admin-only server-side).
 *
 * Redesign: quiet serif title, hairline evidence sections, tabular numerals
 * for the at-a-glance counts. Data and testids untouched.
 */

import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import * as adminApi from '../lib/api/admin.js';
import AsyncBoundary from '../components/shared/AsyncBoundary.jsx';
import Pagination from '../components/shared/Pagination.jsx';
import StatusBadge from '../components/shared/StatusBadge.jsx';
import { AdminTabs } from './AdminQueuePage.jsx';

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function Section({ title, count, children }) {
  return (
    <section className="card space-y-3 p-5">
      <h2 className="eyebrow">
        {title}
        {count !== undefined && (
          <span className="tabular ml-2 rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-ink-2 ring-1 ring-hairline">
            {count}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

function EmptyLine({ children }) {
  return <p className="text-sm text-stone-450">{children}</p>;
}

const REPORT_LABELS = {
  NO_SHOW: 'No-show / unreachable',
  ITEM_NOT_AS_DESCRIBED: 'Not as described',
  FAKE_ITEM: 'Fake item',
  OTHER: 'Other',
};

function ReportRow({ report, direction }) {
  const counterparty = direction === 'filed' ? report.againstId : report.reporterId; // populated user or id
  return (
    <li className="rounded-[6px] p-3 text-sm ring-1 ring-hairline">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-status-red">
          {REPORT_LABELS[report.reason] ?? report.reason}
        </span>
        <StatusBadge status={report.status} />
        <span className="text-ink-2">
          {direction === 'filed' ? 'Filed against ' : 'Filed by '}
          <strong className="font-semibold text-ink">
            {counterparty?.name ?? String(counterparty ?? 'unknown')}
          </strong>
          {' · '}
          {formatDate(report.createdAt)}
        </span>
      </div>
      {report.details && <p className="mt-1.5 text-ink">“{report.details}”</p>}
      {report.status !== 'OPEN' && report.resolutionNote && (
        <p className="mt-1 text-xs text-stone-450">Resolution: {report.resolutionNote}</p>
      )}
    </li>
  );
}

export default function AdminUserDetailPage() {
  const { id } = useParams();
  // pageSize left at the server default (20) — the lists are evidence, and
  // pagination below keeps any heavy account manageable.
  const detailQuery = useQuery({
    queryKey: ['admin-user-detail', id],
    queryFn: () => adminApi.getUser(id),
  });

  return (
    <div className="space-y-6">
      <header className="pt-4">
        <Link to="/admin/users" className="link-underline text-sm font-semibold text-brand-700">
          ← Back to users
        </Link>
        <p className="eyebrow mt-3">Admin · evidence</p>
        <h1 className="font-display mt-1 text-4xl text-ink">User investigation</h1>
      </header>

      <AdminTabs active="Users" />

      <AsyncBoundary
        query={detailQuery}
        isEmpty={(d) => !d?.user}
        empty={
          <div className="card px-6 py-16 text-center">
            <p className="font-display text-2xl text-ink">User not found</p>
            <p className="mt-2 text-sm text-ink-2">This account may have been removed.</p>
          </div>
        }
      >
        {(data) => {
          const { user, counts, items, swaps, ledger, reportsFiled, reportsAgainst, adminActions } =
            data;
          return (
            <div className="space-y-6" data-testid="admin-user-detail">
              {/* ── Identity card ── */}
              <section className="card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-2xl text-ink">{user.name}</h2>
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
                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-stone-450">Email</dt>
                    <dd className="break-all font-medium text-ink">{user.email}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-450">Phone</dt>
                    <dd className="font-medium text-ink">{user.phone ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-450">Points balance</dt>
                    <dd className="tabular font-medium text-ink">{user.pointsBalance ?? 0} pts</dd>
                  </div>
                  <div>
                    <dt className="text-stone-450">Joined</dt>
                    <dd className="font-medium text-ink">{formatDate(user.createdAt)}</dd>
                  </div>
                </dl>
              </section>

              {/* ── Behavior at a glance ── */}
              <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Items listed', counts?.total ?? 0],
                  ['Currently approved', counts?.APPROVED ?? 0],
                  ['Awaiting review', counts?.PENDING ?? 0],
                  ['Swapped away', counts?.SWAPPED ?? 0],
                ].map(([label, value]) => (
                  <div key={label} className="card p-4 text-center">
                    <p className="font-display tabular text-3xl text-ink">{value}</p>
                    <p className="eyebrow mt-1">{label}</p>
                  </div>
                ))}
              </section>

              {/* ── Items ── */}
              <Section title="Items" count={items?.length ?? 0}>
                {items?.length === 0 ? (
                  <EmptyLine>No items listed.</EmptyLine>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {items.map((item) => (
                      <li key={item._id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <Link
                            to={`/items/${item._id}`}
                            className="font-semibold text-ink underline-offset-2 hover:underline"
                          >
                            {item.title}
                          </Link>
                          <p className="tabular text-xs text-ink-2">
                            {item.category} · {item.size} · {item.pointValue} pts · listed{' '}
                            {formatDate(item.createdAt)}
                            {item.moderationReason ? ` · note: ${item.moderationReason}` : ''}
                          </p>
                        </div>
                        <StatusBadge status={item.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* ── Swaps ── */}
              <Section title="Swaps" count={swaps?.total ?? 0}>
                {swaps?.items?.length === 0 ? (
                  <EmptyLine>No swap activity.</EmptyLine>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {swaps.items.map((swap) => {
                      const isRequester = String(swap.requesterId?._id ?? swap.requesterId) === id;
                      return (
                        <li key={swap._id} className="py-2.5 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={swap.status} />
                            <span className="font-medium text-ink">
                              {swap.type === 'POINTS_REDEMPTION'
                                ? 'Points redemption'
                                : 'Direct swap'}
                              {' · '}
                              {isRequester ? 'as requester' : 'as item owner'}
                            </span>
                            <span className="text-xs text-stone-450">
                              {formatDate(swap.createdAt)}
                            </span>
                          </div>
                          <p className="tabular mt-1 text-ink-2">
                            {isRequester ? 'Requested by them: ' : 'Requested from them: '}“
                            {swap.itemId?.title ?? 'item unavailable'}” (
                            {swap.itemId?.pointValue ?? '?'} pts)
                            {swap.offeredItemId &&
                              ` · offered “${swap.offeredItemId.title}” (${swap.offeredItemId.pointValue} pts)`}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {swaps && swaps.totalPages > 1 && (
                  <Pagination
                    page={swaps.page}
                    totalPages={swaps.totalPages}
                    onPage={() => {}} // page-scoped list; evidence pages handled server-side
                  />
                )}
              </Section>

              {/* ── Points ledger ── */}
              <Section title="Points ledger" count={ledger?.length ?? 0}>
                {ledger?.length === 0 ? (
                  <EmptyLine>No points activity.</EmptyLine>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {ledger.map((tx) => (
                      <li
                        key={tx._id}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <div>
                          <span className="font-medium text-ink">{tx.type}</span>
                          {tx.relatedSwapRequestId && (
                            <span className="ml-2 text-xs text-stone-450">
                              swap ({tx.relatedSwapRequestId.type?.replace('_', ' ')?.toLowerCase()}
                              )
                            </span>
                          )}
                          <span className="ml-2 text-xs text-stone-450">
                            {formatDate(tx.createdAt)}
                          </span>
                        </div>
                        <span
                          className={`tabular font-semibold ${
                            tx.amount >= 0 ? 'text-brand-700' : 'text-status-red'
                          }`}
                        >
                          {tx.amount >= 0 ? '+' : ''}
                          {tx.amount} pts
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* ── Disputes ── */}
              <Section title="Reports against this user" count={reportsAgainst?.length ?? 0}>
                {reportsAgainst?.length === 0 ? (
                  <EmptyLine>No disputes filed against them.</EmptyLine>
                ) : (
                  <ul className="space-y-2">
                    {reportsAgainst.map((report) => (
                      <ReportRow key={report._id} report={report} direction="against" />
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Reports they filed" count={reportsFiled?.length ?? 0}>
                {reportsFiled?.length === 0 ? (
                  <EmptyLine>They have not filed any disputes.</EmptyLine>
                ) : (
                  <ul className="space-y-2">
                    {reportsFiled.map((report) => (
                      <ReportRow key={report._id} report={report} direction="filed" />
                    ))}
                  </ul>
                )}
              </Section>

              {/* ── Audit trail ── */}
              <Section title="Admin actions on this account" count={adminActions?.length ?? 0}>
                {adminActions?.length === 0 ? (
                  <EmptyLine>No admin actions recorded.</EmptyLine>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {adminActions.map((action) => (
                      <li key={action._id} className="py-2 text-sm">
                        <span className="font-semibold text-ink">{action.action}</span>
                        <span className="ml-2 text-xs text-stone-450">
                          by {action.adminId?.name ?? 'unknown'} · {formatDate(action.createdAt)}
                        </span>
                        {action.reason && <p className="mt-0.5 text-ink-2">“{action.reason}”</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          );
        }}
      </AsyncBoundary>
    </div>
  );
}
