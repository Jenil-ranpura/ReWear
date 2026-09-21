/**
 * <ItemCard> (§12 key reusable component) — redesigned: photo-first card on
 * a hairline ground, 4:5 frame (aspect reserved — no layout shift), points
 * as a small tabular-numeral tag, image scale ~1.03 on hover inside the
 * clipped frame. Logic unchanged: primary-image pick, detail link, fallback
 * for no photo (now typographic via ItemImage).
 */

import { Link } from 'react-router-dom';

import StatusBadge from './StatusBadge.jsx';
import { ItemImage } from '../ui/Primitives.jsx';

export default function ItemCard({ item }) {
  return (
    <Link
      to={`/items/${item._id}`}
      className="group block overflow-hidden rounded-[12px] border border-hairline bg-white transition-colors duration-200 hover:border-ink/15"
    >
      <div className="aspect-[4/5] overflow-hidden">
        <div className="h-full w-full transition-transform duration-300 ease-out group-hover:scale-[1.03]">
          <ItemImage item={item} />
        </div>
      </div>
      <div className="space-y-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 text-[15px] font-semibold tracking-tight text-ink">
            {item.title}
          </h3>
          {item.pointValue != null && (
            <span className="tabular shrink-0 rounded-full bg-tint px-2 py-0.5 text-xs font-semibold text-brand-800">
              {item.pointValue} pts
            </span>
          )}
        </div>
        <p className="line-clamp-1 text-sm text-ink-2">
          {[item.type, item.size, item.condition?.replace('_', ' ')].filter(Boolean).join(' · ')}
        </p>
        {item.status && item.status !== 'APPROVED' && (
          <div className="pt-0.5">
            <StatusBadge status={item.status} />
          </div>
        )}
      </div>
    </Link>
  );
}
