/**
 * P5-T5 — My listings (§2 dashboard row: "uploaded items"). The
 * /users/me/items endpoint returns ALL statuses (owner manages their own
 * queue — PENDING moderation items included), primary image first, newest
 * first. StatusBadge shows moderation state; each card links to the item
 * detail, with Edit actions for PENDING/APPROVED items (the §10 contract the
 * edit page enforces again server-side).
 */

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import * as usersApi from '../lib/api/users.js';
import AsyncBoundary from '../components/shared/AsyncBoundary.jsx';
import ItemCard from '../components/shared/ItemCard.jsx';

const EDITABLE = ['PENDING', 'APPROVED'];

export default function MyItemsPage() {
  const itemsQuery = useQuery({ queryKey: ['my-items'], queryFn: usersApi.listMyItems });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 pt-4">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 className="font-display mt-2 text-4xl text-ink">My listings</h1>
          <p className="mt-2 text-sm text-ink-2">
            Everything you&apos;ve listed, including items still awaiting moderation.
          </p>
        </div>
        <Link
          to="/items/new"
          className="pressable rounded-[6px] bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
        >
          List an item
        </Link>
      </header>

      <AsyncBoundary
        query={itemsQuery}
        isEmpty={(d) => d?.items?.length === 0}
        empty={
          <div className="card px-6 py-16 text-center">
            <p className="font-display text-2xl text-ink">You haven&apos;t listed anything yet</p>
            <p className="measure mx-auto mt-2 text-sm leading-relaxed text-ink-2">
              Give a pre-loved garment its next chapter — your first listing earns you points.
            </p>
            <Link
              to="/items/new"
              className="pressable mt-6 inline-block rounded-[6px] bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
            >
              List your first item
            </Link>
          </div>
        }
      >
        {(data) => (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.items.map((item) => (
              <div key={item._id} className="space-y-2">
                <ItemCard item={item} />
                {EDITABLE.includes(item.status) && (
                  <Link
                    to={`/items/${item._id}/edit`}
                    className="pressable block rounded-[6px] bg-white px-3 py-2 text-center text-sm font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-brand-50"
                  >
                    Edit
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}
