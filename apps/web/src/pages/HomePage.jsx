import { Link } from 'react-router-dom';

import FeaturedCarousel from '../components/shared/FeaturedCarousel.jsx';
import { Reveal, SectionHeading } from '../components/ui/Primitives.jsx';
import { ArrowRightIcon, LeafIcon, SparkleIcon, SwapIcon } from '../components/ui/Icon.jsx';
import { BASE_POINTS, CONDITION_MULTIPLIERS, ITEM_CATEGORIES } from '@rewear/shared-schemas';

const STEPS = [
  {
    title: 'List it',
    body: 'Photograph the piece you no longer wear. AI suggests the details; you confirm them.',
  },
  {
    title: 'Swap or redeem',
    body: 'Trade directly with another member, or let someone redeem it with points they earned.',
  },
  {
    title: 'Wear it again',
    body: 'Every exchange keeps one more garment in circulation — and out of landfill.',
  },
];

const CATEGORY_LABELS = {
  JACKETS: 'Jackets',
  DRESSES: 'Dresses',
  COATS: 'Coats',
  TOPS: 'Tops',
  SHOES: 'Shoes',
  ACCESSORIES: 'Accessories',
  OTHER: 'Other',
};

/** Landing page (§1/§13) — editorial hero + featured carousel + substance.
 * Copy is real and short; the points section renders the REAL shared formula
 * (no fabricated statistics anywhere). */
export default function HomePage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl pt-10 text-center sm:pt-16">
        <p className="eyebrow">A community clothing exchange</p>
        <h1 className="font-display mt-4 text-5xl leading-[1.05] text-ink sm:text-7xl">
          Give your clothes a&nbsp;
          <span className="text-brand-700">second life</span>
        </h1>
        <p className="measure mx-auto mt-6 text-lg leading-relaxed text-ink-2">
          List the garments you no longer wear, swap them directly with others, or redeem them
          through points — and keep usable clothing out of landfill.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/items/new"
            className="pressable inline-flex items-center gap-2 rounded-[6px] bg-brand-700 px-6 py-3 font-semibold text-white transition-colors hover:bg-brand-800"
          >
            Start swapping
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <Link
            to="/items"
            className="pressable inline-flex items-center rounded-[6px] bg-white px-6 py-3 font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-brand-50"
          >
            Browse items
          </Link>
          <Link
            to="/items/new"
            className="link-underline px-2 py-3 text-sm font-semibold text-ink-2 hover:text-ink"
          >
            List an Item
          </Link>
        </div>
      </section>

      <FeaturedCarousel />

      {/* ── How it works ──────────────────────────────────────────────── */}
      <section className="mx-auto mt-28 max-w-6xl sm:mt-36">
        <Reveal>
          <SectionHeading
            eyebrow="How it works"
            title="Three steps, zero waste"
            sub="No payments. No shipping. Points are earned by giving, not bought."
          />
        </Reveal>
        <ol className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} delay={i * 80}>
              <li className="border-t-2 border-brand-700 pt-5">
                <span className="tabular font-display text-3xl text-brand-700">
                  0{i + 1}
                </span>
                <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{step.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* ── Points, explained with the REAL formula ───────────────────── */}
      <section className="mx-auto mt-28 max-w-6xl sm:mt-36">
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_1.2fr]">
          <Reveal>
            <SectionHeading
              eyebrow="Points"
              title="Every item is worth something precise"
              sub="A listing's point value is derived — never guessed: category base × condition multiplier. Points are a community currency, not money. You earn them when your items find new homes."
            />
          </Reveal>
          <Reveal delay={100}>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Point values by category and condition (base points × condition multiplier)
                </caption>
                <thead>
                  <tr className="border-b border-hairline text-left">
                    <th scope="col" className="px-5 py-3 font-semibold text-ink">
                      Category
                    </th>
                    {Object.keys(CONDITION_MULTIPLIERS).map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className="px-3 py-3 text-right font-medium text-ink-2"
                      >
                        {c === 'LIKE_NEW' ? 'Like new' : c.charAt(0) + c.slice(1).toLowerCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {ITEM_CATEGORIES.map((cat) => (
                    <tr key={cat} className="border-b border-hairline last:border-0">
                      <th scope="row" className="px-5 py-2.5 text-left font-medium text-ink">
                        {CATEGORY_LABELS[cat] ?? cat}
                      </th>
                      {Object.keys(CONDITION_MULTIPLIERS).map((cond) => (
                        <td key={cond} className="px-3 py-2.5 text-right text-ink-2">
                          {BASE_POINTS[cat] * CONDITION_MULTIPLIERS[cond]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Mission ───────────────────────────────────────────────────── */}
      <section className="mx-auto mt-28 max-w-6xl sm:mt-36">
        <Reveal>
          <div className="card bg-brand-700 px-6 py-14 text-center sm:px-16">
            <span
              aria-hidden="true"
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <LeafIcon className="h-5 w-5" />
            </span>
            <h2 className="font-display mx-auto mt-6 max-w-2xl text-3xl text-white sm:text-4xl">
              The most sustainable garment is the one already in your wardrobe.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/75">
              ReWear exists to keep wearable clothing in circulation — swapped, not shipped;
              earned, not bought.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ── Coda CTA ─────────────────────────────────────────────────── */}
      <section className="mx-auto mt-28 mb-8 max-w-6xl text-center sm:mt-36">
        <Reveal>
          <span
            aria-hidden="true"
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-tint text-brand-700"
          >
            <SwapIcon className="h-5 w-5" />
          </span>
          <h2 className="font-display mt-5 text-3xl text-ink sm:text-4xl">
            Your wardrobe is someone's find of the week.
          </h2>
          <p className="measure mx-auto mt-3 text-base text-ink-2">
            Start with one piece. The community does the rest.
          </p>
          <Link
            to="/items/new"
            className="pressable mt-8 inline-flex items-center gap-2 rounded-[6px] bg-brand-700 px-6 py-3 font-semibold text-white transition-colors hover:bg-brand-800"
          >
            <SparkleIcon className="h-4 w-4" />
            List your first item
          </Link>
        </Reveal>
      </section>
    </>
  );
}
