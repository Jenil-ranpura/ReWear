/**
 * P5-T2 — Browse/catalog page (§5.4). URL-driven filters (the querystring IS
 * the state: refresh/back/share keep the view), chip multi-select for
 * category/size/condition (repeated params, matching browseItemsSchema),
 * debounced search-as-you-type (q is committed to the URL 300ms after the
 * last keystroke — results update as you type, no submit button), useQuery +
 * AsyncBoundary + ItemCard grid, and bounded pagination. Any filter change
 * resets to page 1.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import * as itemsApi from '../lib/api/items.js';
import AsyncBoundary from '../components/shared/AsyncBoundary.jsx';
import ItemCard from '../components/shared/ItemCard.jsx';
import Pagination from '../components/shared/Pagination.jsx';
import { ITEM_CONDITION } from '@rewear/shared-schemas';

/** Free-text categories (§9.1/seed: JACKETS, DRESSES, COATS, …) — the panel
 * offers common ones as chips but accepts anything the API validates. */
const CATEGORY_CHIPS = ['JACKETS', 'DRESSES', 'COATS', 'TOPS', 'SHOES', 'ACCESSORIES'];
const SIZE_CHIPS = ['XS', 'S', 'M', 'L', 'XL'];

/** Silence window before a keystroke commits q to the URL (and refetches). */
const SEARCH_DEBOUNCE_MS = 300;

function toMulti(param) {
  return param ? param.split(',').filter(Boolean) : [];
}

function toggleValue(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function BrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [qInput, setQInput] = useState(searchParams.get('q') ?? '');

  // ── Filters live in the URL (§5.4: shareable/back-button-able views). ──
  // Primitives first: useQuery keys MUST be reference-stable, so the query
  // object is memoized on these raw strings (a fresh object every render
  // would mean a fresh key every render → infinite refetch loop).
  const categoryParam = searchParams.get('category') ?? '';
  const sizeParam = searchParams.get('size') ?? '';
  const conditionParam = searchParams.get('condition') ?? '';
  const q = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const query = useMemo(
    () => ({
      category: toMulti(categoryParam),
      size: toMulti(sizeParam),
      condition: toMulti(conditionParam),
      q,
      page,
      pageSize: 12, // 4-col grid × 3 rows
    }),
    [categoryParam, sizeParam, conditionParam, q, page]
  );

  // Render-local derivations for chip active-states (stable value arrays).
  const categories = toMulti(categoryParam);
  const sizes = toMulti(sizeParam);
  const conditions = toMulti(conditionParam);

  const itemsQuery = useQuery({
    queryKey: ['items', query],
    queryFn: () => itemsApi.list(query),
    placeholderData: keepPreviousData, // old page stays visible while loading next
  });

  function updateParams(changes) {
    // Functional form: always builds from the LATEST params, so a debounced q
    // commit landing after a chip click can't revert that click (and vice
    // versa) — the 300ms window overlaps user interactions by design.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
          next.delete(key);
        } else {
          next.set(key, Array.isArray(value) ? value.join(',') : String(value));
        }
      }
      return next;
    });
  }

  // Keep the visible input in sync when q changes OUTSIDE the input (back/
  // forward navigation, clear-all-filters). Depends on the raw string, not
  // the params object — chip clicks must not clobber in-flight typing.
  useEffect(() => {
    setQInput(q);
  }, [q]);

  // Search-as-you-type: commit q to the URL after the user pauses. Every
  // keystroke resets the timer, so a burst of typing fires ONE fetch with the
  // final value. Equal value → no-op (mount and post-commit runs do nothing).
  useEffect(() => {
    if (qInput === q) return undefined;
    const timer = setTimeout(() => {
      updateParams({ q: qInput, page: null }); // a q change resets to page 1
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qInput, q]);

  // NOTE: takes the chip value explicitly — an onClick handler would receive
  // the DOM event, and String(event) in a filter array is never what we want.
  const toggle = (key, current, value) =>
    updateParams({ [key]: toggleValue(current, value), page: null });

  const chip = (active) =>
    `rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${
      active
        ? 'bg-brand-700 text-white ring-brand-600'
        : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50'
    }`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-stone-900">Browse items</h1>
          <p className="mt-1 text-stone-500">Give a pre-loved garment its next chapter.</p>
        </div>
        <input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search jackets, dresses…"
          aria-label="Search items"
          className="w-full max-w-sm rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
      </header>

      <div className="flex flex-wrap gap-6 rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <FilterGroup label="Category">
          {CATEGORY_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggle('category', categories, c)}
              className={chip(categories.includes(c))}
            >
              {c}
            </button>
          ))}
        </FilterGroup>
        <FilterGroup label="Size">
          {SIZE_CHIPS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggle('size', sizes, s)}
              className={chip(sizes.includes(s))}
            >
              {s}
            </button>
          ))}
        </FilterGroup>
        <FilterGroup label="Condition">
          {ITEM_CONDITION.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggle('condition', conditions, c)}
              className={chip(conditions.includes(c))}
            >
              {c.replace('_', ' ')}
            </button>
          ))}
        </FilterGroup>
      </div>

      <AsyncBoundary
        query={itemsQuery}
        isEmpty={(d) => d?.total === 0}
        empty={
          <div className="rounded-xl bg-white p-12 text-center shadow-sm ring-1 ring-stone-200">
            <p className="text-lg font-semibold text-stone-800">No items match those filters</p>
            <p className="mt-1 text-stone-500">
              Try removing a filter or searching for something else.
            </p>
            <button
              type="button"
              onClick={() => {
                setQInput('');
                setSearchParams(new URLSearchParams());
              }}
              className="mt-4 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Clear all filters
            </button>
          </div>
        }
      >
        {(data) => (
          <>
            <p className="text-sm text-stone-500" aria-live="polite">
              {data.total} item{data.total === 1 ? '' : 's'} found
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.items.map((item) => (
                <ItemCard key={item._id} item={item} />
              ))}
            </div>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              onPage={(p) => updateParams({ page: p === 1 ? null : p })}
            />
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}

function FilterGroup({ label, children }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-bold uppercase tracking-wide text-stone-450">
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}
