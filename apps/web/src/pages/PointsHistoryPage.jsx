/**
 * P5-T5 — Points history (§2 dashboard row; §9.3 the ledger IS the truth).
 * Paginated, newest first, from GET /users/me/points/history. Amounts render
 * signed (+/−); the related swap request links to the swap lists when present.
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
    <span
      className={`text-sm font-bold tabular-nums ${positive ? 'text-green-700' : 'text-red-700'}`}
    >
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
      <header>
        <h1 className="text-2xl font-bold text-stone-900">Points history</h1>
        <p className="mt-1 text-sm text-stone-500">
          Every point you&apos;ve earned or spent. This ledger is the source of truth for your
          balance.
        </p>
      </header>

      <AsyncBoundary
        query={historyQuery}
        isEmpty={(d) => d?.total === 0}
        empty={
          <div className="rounded-xl bg-white p-12 text-center shadow-sm ring-1 ring-stone-200">
            <p className="text-lg font-semibold text-stone-800">No points activity yet</p>
            <p className="mt-1 text-stone-500">
              List an item to start earning — you&apos;ll earn points when someone redeems it.
            </p>
            <Link
              to="/items/new"
              className="mt-4 inline-block rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
            >
              List an item
            </Link>
          </div>
        }
      >
        {(data) => (
          <>
            <ul className="divide-y divide-stone-100 rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
              {data.transactions.map((tx) => (
                <li key={tx._id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-stone-900">
                        {TYPE_LABEL[tx.type] ?? tx.type}
                      </span>
                      <span className="text-xs text-stone-450">
                        {new Date(tx.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {tx.relatedSwapRequestId && (
                      <Link
                        to="/dashboard/swaps"
                        className="text-xs font-medium text-brand-700 hover:underline"
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
