/**
 * <ItemDetailsDialog> — full product details in an admin dialog.
 *
 * Problem-statement moderation reality: the queue rows show a thumbnail +
 * title + owner, which is enough to triage but not enough to JUDGE — an
 * admin approving/rejecting (or removing a live listing) needs the
 * description, size/condition/category/type, tags, every uploaded photo,
 * and who listed it. Both admin lists already return the FULL item
 * document (owner populated), so this is pure UI: no endpoint changes.
 *
 * Built ON <ConfirmDialog wide hideActions> (one dialog pattern — focus
 * trap, Escape, backdrop close and aria wiring all inherited) and kept
 * VIEW-ONLY on purpose: actions (Approve/Reject/Remove) stay on the row
 * so a reading mistake can't fire a mutation from inside a reading
 * surface.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import ConfirmDialog from './ConfirmDialog.jsx';
import StatusBadge from './StatusBadge.jsx';

const FALLBACK_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e7e5e4"/><text x="400" y="300" font-family="sans-serif" font-size="24" fill="#78716c" text-anchor="middle">No photo</text></svg>`
  );

function Spec({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-stone-450">{label}</dt>
      <dd className="mt-0.5 font-medium text-stone-900">{value ?? '—'}</dd>
    </div>
  );
}

export default function ItemDetailsDialog({ open, onClose, item }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const images = item?.images ?? [];
  const active = images[activeIndex] ?? images[0] ?? null;

  return (
    <ConfirmDialog open={open} onClose={onClose} wide hideActions title="Item details">
      {item ? (
        <div className="space-y-4">
          {/* Gallery — every uploaded photo, main view + thumbnails (the same
            photo-first pattern as the public detail page). */}
          <div className="aspect-[4/3] overflow-hidden rounded-xl bg-stone-100 ring-1 ring-stone-200">
            <img
              src={active?.url ?? FALLBACK_IMAGE}
              alt={item.title}
              className="h-full w-full object-cover"
            />
          </div>
          {images.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <button
                  key={img.url ?? i}
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  aria-label={`Show photo ${i + 1} of ${images.length}`}
                  aria-current={i === activeIndex}
                  className={`h-14 w-14 overflow-hidden rounded-lg ring-2 transition ${
                    i === activeIndex ? 'ring-brand-600' : 'ring-transparent hover:ring-stone-300'
                  }`}
                >
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-bold text-stone-900">{item.title}</h3>
            <StatusBadge status={item.status} />
            <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-700">
              {item.pointValue} pts
            </span>
            {item.moderationReason && (
              <span
                title={item.moderationReason}
                className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
              >
                ⚠ {item.moderationReason}
              </span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <Spec label="Category" value={item.category} />
            <Spec label="Type" value={item.type} />
            <Spec label="Size" value={item.size} />
            <Spec label="Condition" value={item.condition?.replace('_', ' ').toLowerCase()} />
          </dl>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-stone-450">
              Description
            </h4>
            <p className="mt-1 whitespace-pre-line text-sm text-stone-700">{item.description}</p>
          </div>

          {item.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Owner block — populated on both admin lists (name + email). */}
          <div className="rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
            <h4 className="text-xs font-bold uppercase tracking-wide text-stone-450">Listed by</h4>
            <p className="mt-0.5 text-sm font-semibold text-stone-900">
              {item.ownerId?.name ?? 'Unknown owner'}
            </p>
            <p className="text-sm text-stone-500">{item.ownerId?.email ?? ''}</p>
          </div>

          {onClose && (
            <div className="flex justify-end">
              <Link
                to={`/items/${item._id}`}
                onClick={onClose}
                data-testid="item-details-open-page"
                className="text-sm font-semibold text-brand-700 hover:underline"
              >
                Open full page →
              </Link>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-stone-500">No item data.</p>
      )}
    </ConfirmDialog>
  );
}
