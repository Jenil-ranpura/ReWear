/**
 * Shared pagination control (§12: one convention — the same markup was
 * previously duplicated in BrowsePage and PointsHistoryPage; admin pages are
 * the third+ consumer, so it's extracted rather than copied again). Renders
 * nothing when there's a single page.
 */

export default function Pagination({ page, totalPages, onPage, className = 'mt-6' }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className={`flex items-center justify-center gap-2 ${className}`}>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="pressable rounded-[6px] bg-white px-3 py-2 text-sm font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-brand-50 disabled:opacity-40"
      >
        Previous
      </button>
      <span className="tabular px-2 text-sm text-ink-2">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className="pressable rounded-[6px] bg-white px-3 py-2 text-sm font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-brand-50 disabled:opacity-40"
      >
        Next
      </button>
    </nav>
  );
}
