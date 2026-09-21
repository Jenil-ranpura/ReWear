/**
 * <FeaturedCarousel> (§1/§13 problem statement: landing-page featured items
 * carousel). Shows the LATEST APPROVED items (user decision — freshness is
 * the curation: "just got a second life"). Data comes from the existing
 * public browse endpoint (newest-first, APPROVED-forced server-side), so
 * there is zero backend work; the section renders null when nothing is
 * approved (never an empty shell on the landing page).
 *
 * Structure: a scroll-snap flex track of REAL <ItemCard>s — pixel-identical
 * to browse, zero markup duplication, and native touch swiping for free
 * (arrows are a desktop affordance that call scrollTo). Auto-advances ~5s,
 * paused on hover/focus-within, and never armed under prefers-reduced-motion
 * (P7-T5: the global CSS kills animations; this additionally skips the timer).
 *
 * activeIndex is ONE state updated by arrows/timer directly AND synced from
 * scroll events (touch swipes) — scroll events alone would be unreliable
 * (programmatic scrollTo in jsdom fires none; real browsers coalesce them).
 *
 * A11y: aria-roledescription="carousel" region; named arrows; dots are a
 * labelled button group; ItemCard alt text carries the item titles.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import * as itemsApi from '../../lib/api/items.js';
import ItemCard from './ItemCard.jsx';

const AUTO_ADVANCE_MS = 5_000;
const FEATURED_COUNT = 8;
const CARD_GAP_PX = 16; // gap-4 — keep in step with the track class

/** Width of one step (card + gap) measured from the first real card. */
function slideStep(track, itemCount) {
  if (!track || itemCount === 0) return 0;
  const first = track.children[0];
  if (first?.offsetWidth > 0) return first.offsetWidth + CARD_GAP_PX;
  // No layout engine (jsdom) / not laid out yet — proportional fallback.
  return track.scrollWidth / itemCount;
}

export default function FeaturedCarousel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['items', 'featured'],
    queryFn: () => itemsApi.list({ page: 1, pageSize: FEATURED_COUNT }),
    staleTime: 5 * 60 * 1000, // landing-page traffic; avoid refetch churn
    retry: false,
  });

  const items = data?.items ?? [];
  const trackRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const scrollToIndex = (index) => {
    const track = trackRef.current;
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    // Optimistic FIRST: the index (dots/arrows) must update even where
    // scrolling is unavailable (jsdom, legacy browsers). In real browsers
    // the scroll listener syncs the same value back after the smooth scroll.
    setActiveIndex(clamped);
    const step = slideStep(track, items.length);
    if (!track || step <= 0 || typeof track.scrollTo !== 'function') return;
    track.scrollTo({ left: clamped * step, behavior: 'smooth' });
  };

  // Auto-advance: one card per tick, wrapping. Skipped for reduced-motion
  // users (static strip), while hovered/focused, and for <2 items.
  useEffect(() => {
    if (paused || items.length < 2) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const timer = setInterval(() => {
      const next = activeIndex >= items.length - 1 ? 0 : activeIndex + 1;
      scrollToIndex(next);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [paused, activeIndex, items.length]);

  // Touch-swipe sync: derive the index from scroll position.
  const handleScroll = () => {
    const track = trackRef.current;
    const step = slideStep(track, items.length);
    if (!track || step <= 0) return;
    setActiveIndex(Math.max(0, Math.min(items.length - 1, Math.round(track.scrollLeft / step))));
  };

  // Loading: skeleton with the same footprint as a row of cards.
  if (isLoading) {
    return (
      <section aria-label="Featured items" data-testid="featured-carousel" className="mt-12">
        <div className="mb-4 h-7 w-48 animate-pulse rounded bg-stone-200" aria-hidden="true" />
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3].map((n) => (
            <div
              key={n}
              className="aspect-[4/3] w-1/2 shrink-0 animate-pulse rounded-xl bg-stone-200 sm:w-1/3 lg:w-1/4"
              aria-hidden="true"
            />
          ))}
        </div>
      </section>
    );
  }

  // Empty or failed: the landing page stays clean (hero only) — never an
  // empty shell, never an error surface for a purely promotional section.
  if (isError || items.length === 0) return null;

  return (
    <section
      aria-label="Featured items"
      aria-roledescription="carousel"
      data-testid="featured-carousel"
      className="mt-12"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 className="text-2xl font-bold text-stone-900">Fresh on ReWear</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => scrollToIndex(activeIndex - 1)}
            disabled={activeIndex === 0}
            aria-label="Previous items"
            className="rounded-full bg-white p-2 text-stone-700 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50 disabled:opacity-40"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.06 10l4.71 3.71a.75.75 0 1 1-1.04 1.08l-5.25-4.14a.75.75 0 0 1 0-1.3l5.25-4.14a.75.75 0 0 1 1.06.02Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => scrollToIndex(activeIndex + 1)}
            disabled={activeIndex === items.length - 1}
            aria-label="Next items"
            className="rounded-full bg-white p-2 text-stone-700 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50 disabled:opacity-40"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.94 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l5.25 4.14a.75.75 0 0 1 0 1.3l-5.25 4.14a.75.75 0 0 1-1.06-.02Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Track: scroll-snap + overflow-x = native touch swipe; hidden
          scrollbar keeps the row clean (dots/arrows are the indicators). */}
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <div key={item._id} className="w-1/2 shrink-0 snap-start sm:w-1/3 lg:w-1/4">
            <ItemCard item={item} />
          </div>
        ))}
      </div>

      {/* Dots: one per item; a labelled button group (not tabs — there are
          no tabpanels). Current dot is elongated + brand-colored. */}
      <div className="mt-3 flex justify-center gap-1.5">
        {items.map((item, index) => (
          <button
            key={item._id}
            type="button"
            aria-label={`Go to item ${index + 1} of ${items.length}`}
            aria-current={index === activeIndex}
            onClick={() => scrollToIndex(index)}
            className={`h-2 rounded-full transition-all ${
              index === activeIndex ? 'w-6 bg-brand-700' : 'w-2 bg-stone-300 hover:bg-stone-400'
            }`}
          />
        ))}
      </div>
    </section>
  );
}
