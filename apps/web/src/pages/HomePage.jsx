import { Link } from 'react-router-dom';

import FeaturedCarousel from '../components/shared/FeaturedCarousel.jsx';

/**
 * Landing page (§1/§13): intro hero + primary CTAs + featured items
 * carousel of the LATEST APPROVED items (§13 problem statement).
 * The carousel self-hides when nothing is approved / the fetch fails —
 * the hero never depends on it.
 */
export default function HomePage() {
  return (
    <>
      <section className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-stone-200">
        <h1 className="text-4xl font-extrabold tracking-tight text-stone-900 sm:text-5xl">
          Give your clothes a <span className="text-brand-600">second life</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-stone-600">
          ReWear is a community clothing-exchange platform. List the garments you no longer wear,
          swap them directly with others, or redeem them through points — and keep usable clothing
          out of landfill.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/items"
            className="rounded-lg bg-brand-700 px-6 py-3 font-semibold text-white shadow hover:bg-brand-800"
          >
            Browse items
          </Link>
          <Link
            to="/items/new"
            className="rounded-lg bg-white px-6 py-3 font-semibold text-brand-700 ring-1 ring-brand-600 hover:bg-brand-50"
          >
            List an item
          </Link>
        </div>
      </section>

      <FeaturedCarousel />
    </>
  );
}
