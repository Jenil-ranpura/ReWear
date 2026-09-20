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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">My listings</h1>
          <p className="mt-1 text-sm text-stone-500">
            Everything you&apos;ve listed, including items still awaiting moderation.
          </p>
        </div>
        <Link
          to="/items/new"
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
        >
          List an item
        </Link>
      </header>

      <AsyncBoundary
        query={itemsQuery}
        isEmpty={(d) => d?.items?.length === 0}
        empty={
          <div className="rounded-xl bg-white p-12 text-center shadow-sm ring-1 ring-stone-200">
            <p className="text-lg font-semibold text-stone-800">
              You haven&apos;t listed anything yet
            </p>
            <p className="mt-1 text-stone-500">
              Give a pre-loved garment its next chapter — your first listing earns you points.
            </p>
            <Link
              to="/items/new"
              className="mt-4 inline-block rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
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
                    className="block rounded-lg bg-white px-3 py-2 text-center text-sm font-semibold text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
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
