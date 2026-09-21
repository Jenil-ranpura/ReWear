/**
 * <AsyncBoundary> (§12: "used on every data-driven view"; §5.9: skeletons,
 * never a blank screen; human-readable errors; empty state with CTA).
 *
 * Wraps TanStack Query results:
 *   <AsyncBoundary query={itemsQuery} empty={<EmptyBrowse/>}>
 *     {(items) => <div>…cards…</div>}
 *   </AsyncBoundary>
 *
 * - loading → skeleton (optional loading prop overrides the default)
 * - error   → human message + Retry button (refetch), never a stack trace
 * - empty   → caller-provided empty node when data is present but empty
 *           (.isArray checks items/users arrays; children render otherwise)
 */

import { useQueryClient } from '@tanstack/react-query';

export default function AsyncBoundary({
  query,
  isLoading,
  loading,
  loadingNode,
  error,
  onRetry,
  empty,
  isEmpty,
  children,
}) {
  const queryClient = useQueryClient();
  // `loading` (boolean override) wins over `isLoading` (alias) over query state.
  const loadingState = loading ?? isLoading ?? query?.isLoading ?? query?.isPending ?? false;
  const errorState = error ?? query?.error ?? null;

  if (loadingState) {
    // P7-T5: the skeleton is announced ("loading") via a polite live region
    // + aria-busy, so screen-reader users get feedback instead of silence —
    // the pulse animation alone is invisible to them.
    // Callers with a shape that doesn't fit the default card grid (detail
    // pages, dashboards) can pass loadingNode instead.
    if (loadingNode)
      return (
        <div data-testid="async-loading" role="status" aria-live="polite" aria-busy="true">
          {loadingNode}
        </div>
      );
    return (
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="async-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="Loading"
      >
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-[12px] border border-hairline bg-white">
            <div className="aspect-[4/5] animate-pulse bg-ink/6" />
            <div className="space-y-2 p-4">
              <div className="h-4 w-3/4 animate-pulse rounded bg-ink/6" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-ink/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (errorState) {
    const retry = onRetry ?? (() => queryClient.invalidateQueries());
    return (
      <div className="card p-10 text-center" role="alert">
        <p className="font-display text-2xl text-ink">Something went wrong.</p>
        <p className="measure mx-auto mt-2 text-sm text-ink-2">
          {errorState.message ?? 'Please try again.'}
        </p>
        <button
          type="button"
          onClick={() => {
            if (query?.refetch) query.refetch();
            retry();
          }}
          className="pressable mt-6 rounded-[6px] bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
        >
          Try again
        </button>
      </div>
    );
  }

  const data = query?.data;
  const showEmpty =
    empty != null &&
    (isEmpty ? isEmpty(data) : Array.isArray(data) ? data.length === 0 : data == null);

  if (showEmpty) return <>{empty}</>;

  return <>{children(data)}</>;
}
