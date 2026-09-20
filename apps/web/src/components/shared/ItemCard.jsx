/**
 * <ItemCard> (§12 key reusable component) — photo-first card (§13), used by
 * browse (P5-T2), dashboard (P5-T5), and the admin queue context. Links to
 * the detail page; the points chip shows only when a pointValue exists.
 */

import { Link } from 'react-router-dom';

import StatusBadge from './StatusBadge.jsx';

const FALLBACK_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#e7e5e4"/><text x="200" y="150" font-family="sans-serif" font-size="16" fill="#78716c" text-anchor="middle">No photo</text></svg>`
  );

export default function ItemCard({ item }) {
  const image = item.images?.find((img) => img.isPrimary) ?? item.images?.[0];

  return (
    <Link
      to={`/items/${item._id}`}
      className="group overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200 transition hover:shadow-md"
    >
      <div className="aspect-[4/3] overflow-hidden bg-stone-100">
        <img
          src={image?.url ?? FALLBACK_IMAGE}
          alt={item.title}
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 font-semibold text-stone-900">{item.title}</h3>
          {item.pointValue != null && (
            <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">
              {item.pointValue} pts
            </span>
          )}
        </div>
        <p className="line-clamp-1 text-sm text-stone-500">
          {[item.type, item.size, item.condition].filter(Boolean).join(' · ')}
        </p>
        {item.status && item.status !== 'APPROVED' && <StatusBadge status={item.status} />}
      </div>
    </Link>
  );
}
