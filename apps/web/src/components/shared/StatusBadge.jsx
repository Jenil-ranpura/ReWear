/**
 * <StatusBadge> (§12 key reusable component). One mapping for item AND swap
 * statuses (the enums overlap on PENDING/ACCEPTED/...); unknown values render
 * in neutral styling instead of crashing.
 *
 * Redesign: muted status tones — quiet pills, hairline rings.
 */

const STYLES = {
  // Item statuses (§9.1)
  PENDING: 'bg-amber-50 text-status-amber ring-amber-200/70',
  APPROVED: 'bg-brand-50 text-brand-800 ring-brand-200/70',
  REJECTED: 'bg-red-50 text-status-red ring-red-200/70',
  RESERVED: 'bg-blue-50 text-status-blue ring-blue-200/70',
  PENDING_TRANSFER: 'bg-blue-50 text-status-blue ring-blue-200/70',
  SWAPPED: 'bg-violet-50 text-violet-800 ring-violet-200/70',
  REMOVED: 'bg-canvas text-ink-2 ring-hairline',
  // Swap statuses (§9.1)
  ACCEPTED: 'bg-brand-50 text-brand-800 ring-brand-200/70',
  CANCELLED: 'bg-canvas text-ink-2 ring-hairline',
};

const LABELS = {
  PENDING_TRANSFER: 'Pending transfer',
};

export default function StatusBadge({ status, className = '' }) {
  const style = STYLES[status] ?? 'bg-canvas text-ink-2 ring-hairline';
  const label = LABELS[status] ?? status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${style} ${className}`}
    >
      {label}
    </span>
  );
}
