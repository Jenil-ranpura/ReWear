/**
 * Tiny inline icon set — 1.5px stroke, consistent 24-viewBox grid.
 * Never emoji as UI icons (anti-slop rule). Icons inherit currentColor.
 * All are decorative by default (aria-hidden) — pair with a text label.
 */

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function ChevronLeftIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CheckIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function SearchIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function ArrowRightIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M4 12h16m0 0l-6-6m6 6l-6 6" />
    </svg>
  );
}

export function HeartIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M12 20s-7-4.6-9-9c-1.2-2.7.6-6 3.8-6 2 0 3.6 1.2 4.2 2.6h2C13.6 6.2 15.2 5 17.2 5c3.2 0 5 3.3 3.8 6-2 4.4-9 9-9 9z" />
    </svg>
  );
}

export function XIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function LeafIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M5 19c0-8 5-13 14-14 0 9-4 14-11 14H5z" />
      <path d="M5 19c3-5 7-8 11-9.5" />
    </svg>
  );
}

export function SwapIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M7 8h13m0 0l-3.5-3.5M20 8l-3.5 3.5" />
      <path d="M17 16H4m0 0l3.5-3.5M4 16l3.5 3.5" />
    </svg>
  );
}

export function SparkleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8L12 4z" />
    </svg>
  );
}
