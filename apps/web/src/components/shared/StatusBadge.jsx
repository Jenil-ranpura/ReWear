/**
 * <StatusBadge> (§12 key reusable component). One mapping for item AND swap
 * statuses (the enums overlap on PENDING/ACCEPTED/...); unknown values render
 * in neutral styling instead of crashing.
 */

const STYLES = {
  // Item statuses (§9.1)
  PENDING: 'bg-amber-100 text-amber-800 ring-amber-200',
  APPROVED: 'bg-green-100 text-green-800 ring-green-200',
  REJECTED: 'bg-red-100 text-red-700 ring-red-200',
  RESERVED: 'bg-sky-100 text-sky-800 ring-sky-200',
  PENDING_TRANSFER: 'bg-sky-100 text-sky-800 ring-sky-200',
  SWAPPED: 'bg-violet-100 text-violet-800 ring-violet-200',
  REMOVED: 'bg-stone-100 text-stone-600 ring-stone-200',
  // Swap statuses (§9.1)
  ACCEPTED: 'bg-green-100 text-green-800 ring-green-200',
  CANCELLED: 'bg-stone-100 text-stone-600 ring-stone-200',
};

const LABELS = {
  PENDING_TRANSFER: 'Pending transfer',
};

export default function StatusBadge({ status, className = '' }) {
  const style = STYLES[status] ?? 'bg-stone-100 text-stone-600 ring-stone-200';
  const label = LABELS[status] ?? status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${style} ${className}`}
    >
      {label}
    </span>
  );
}
