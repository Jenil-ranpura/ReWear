/**
 * P5-T5 — Points history (§2 dashboard row; §9.3 the ledger IS the truth).
 * Paginated, newest first, from GET /users/me/points/history. Amounts render
 * signed (+/−); the related swap request links to the swap lists when present.
 *
 * Redesign: quiet hairline ledger with tabular numerals; logic unchanged.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import * as usersApi from '../lib/api/users.js';
import AsyncBoundary from '../components/shared/AsyncBoundary.jsx';
import Pagination from '../components/shared/Pagination.jsx';
import StatusBadge from '../components/shared/StatusBadge.jsx';

const TYPE_LABEL = { EARNED: 'Earned', SPENT: 'Spent', ADJUSTED: 'Adjusted' };

function Amount({ value }) {
  const positive = value > 0;
  return (
    <span className={`tabular text-sm font-semibold ${positive ? 'text-brand-700' : 'text-status-red'}`}>
      {positive ? '+' : ''}
      {value} pts
    </span>
  );
}

export default function PointsHistoryPage() {
  const [page, setPage] = useState(1);

  const historyQuery = useQuery({
    queryKey: ['points-history', page],
    queryFn: () => usersApi.pointsHistory({ page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <header className="pt-4">
        <p className="eyebrow">Dashboard</p>
        <h1 className="font-display mt-2 text-4xl text-ink">Points history</h1>
        <p className="mt-2 text-sm text-ink-2">
          Every point you&apos;ve earned or spent. This ledger is the source of truth for your
          balance.
        </p>
      </header>

      <AsyncBoundary
        query={historyQuery}
        isEmpty={(d) => d?.total === 0}
        empty={
          <div className="card px-6 py-16 text-center">
            <p className="font-display text-2xl text-ink">No points activity yet</p>
            <p className="measure mx-auto mt-2 text-sm leading-relaxed text-ink-2">
              List an item to start earning — you&apos;ll earn points when someone redeems it.
            </p>
            <Link
              to="/items/new"
              className="pressable mt-6 inline-block rounded-[6px] bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
            >
              List an item
            </Link>
          </div>
        }
      >
        {(data) => (
          <>
            <ul className="card divide-y divide-hairline">
              {data.transactions.map((tx) => (
                <li key={tx._id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {TYPE_LABEL[tx.type] ?? tx.type}
                      </span>
                      <span className="tabular text-xs text-stone-450">
                        {new Date(tx.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {tx.relatedSwapRequestId && (
                      <Link
                        to="/dashboard/swaps"
                        className="link-underline inline-flex items-center gap-1.5 text-xs font-medium text-brand-700"
                      >
                        {tx.relatedSwapRequestId.type === 'DIRECT_SWAP'
                          ? 'Direct swap'
                          : 'Points redemption'}{' '}
                        · <StatusBadge status={tx.relatedSwapRequestId.status} />
                      </Link>
                    )}
                  </div>
                  <Amount value={tx.amount} />
                </li>
              ))}
            </ul>
            <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
