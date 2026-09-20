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
          <div
            key={i}
            className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200"
          >
            <div className="aspect-[4/3] animate-pulse bg-stone-200" />
            <div className="space-y-2 p-4">
              <div className="h-4 w-3/4 animate-pulse rounded bg-stone-200" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-stone-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (errorState) {
    const retry = onRetry ?? (() => queryClient.invalidateQueries());
    return (
      <div
        className="rounded-xl bg-white p-10 text-center shadow-sm ring-1 ring-stone-200"
        role="alert"
      >
        <p className="font-semibold text-stone-800">Something went wrong.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
          {errorState.message ?? 'Please try again.'}
        </p>
        <button
          type="button"
          onClick={() => {
            if (query?.refetch) query.refetch();
            retry();
          }}
          className="mt-4 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
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
