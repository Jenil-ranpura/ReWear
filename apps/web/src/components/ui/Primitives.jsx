/**
 * Small shared primitives for the redesigned surface.
 * All are presentational and keep existing a11y contracts intact.
 */

import { useEffect, useRef, useState } from 'react';

/** Chip — filters and tags. Selected = tint fill + accent text. */
export function Chip({ selected = false, className = '', ...rest }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`pressable rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
        selected
          ? 'border-brand-700 bg-tint text-brand-800'
          : 'border-hairline bg-white text-ink-2 hover:border-ink/20 hover:text-ink'
      } ${className}`}
      {...rest}
    />
  );
}

/** Tag — read-only label (item tags, meta). */
export function Tag({ children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-canvas px-2.5 py-0.5 text-xs font-medium text-ink-2 ring-1 ring-hairline ${className}`}
    >
      {children}
    </span>
  );
}

/** SectionHeading — eyebrow + display serif title + optional sub. */
export function SectionHeading({ eyebrow, title, sub, align = 'left', className = '' }) {
  return (
    <div className={`${align === 'center' ? 'mx-auto text-center' : ''} max-w-2xl ${className}`}>
      {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
      <h2 className="font-display text-3xl text-ink sm:text-4xl">{title}</h2>
      {sub && <p className="measure mt-3 text-base leading-relaxed text-ink-2">{sub}</p>}
    </div>
  );
}

/** Skeleton — pulse block that matches final layout footprints. */
export function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-ink/6 ${className}`} />;
}

/** EmptyState — quiet, typographic, with an optional action. */
export function EmptyState({ title, body, action, className = '' }) {
  return (
    <div className={`card flex flex-col items-center px-6 py-16 text-center ${className}`}>
      <p className="font-display text-2xl text-ink">{title}</p>
      {body && <p className="measure mt-2 text-sm leading-relaxed text-ink-2">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/**
 * ItemImage — 4:5 framed item photo. Reserves aspect-ratio (no layout
 * shift), lazy + async decoding below the fold. No photo → a refined
 * typographic fallback (title initial on tonal ground), never a broken img.
 */
export function ItemImage({ item, className = '', eager = false }) {
  const src = item?.images?.find((i) => i.isPrimary)?.url ?? item?.images?.[0]?.url;
  return (
    <div className={`relative overflow-hidden bg-tint ${className}`}>
      {src ? (
        <img
          src={src}
          alt={item?.title ? `${item.title} — photo` : 'Item photo'}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        // No photo → refined typographic fallback. role="img" + label keeps
        // it a meaningful, named graphic for AT (the old <img alt> contract).
        <div
          role="img"
          aria-label={item?.title ?? 'Item'}
          className="flex h-full w-full items-center justify-center bg-brand-50"
        >
          <span aria-hidden="true" className="font-display text-4xl text-brand-300">
            {(item?.title ?? '?').trim().charAt(0).toUpperCase()}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Reveal — one-shot scroll reveal (fade + rise) via IntersectionObserver.
 * Fires once per mount; disabled entirely under prefers-reduced-motion
 * (CSS also collapses it). Falls back to visible when IO is unavailable.
 */
export function Reveal({ children, className = 'min-w-0', delay = 0 }) {
  // min-w-0 default: grid/flex items default to min-width:auto, so a wide
  // child (e.g. a data table) would otherwise push the item past the viewport
  // (caught by the P6 visual QA at 360px). Callers can override via className.
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
