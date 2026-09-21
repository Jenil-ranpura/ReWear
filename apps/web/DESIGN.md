# ReWear — Design System

Premium through restraint. Editorial fashion sensibility, precise product
engineering. This file is the record of tokens, decisions, and dependency
notes for the frontend redesign. Backend and shared-schemas are read-only.

## Dependencies added

| Package | Why | Size |
|---|---|---|
| `@fontsource-variable/fraunces` | Self-hosted display serif (hero headlines, big numbers). Self-hosting avoids the external-requests rule; variable axis keeps one file for all weights. | ~50KB woff2 subset |
| `@fontsource-variable/inter` | Self-hosted UI/body grotesk. | ~48KB woff2 subset |

Total: 2 dependencies, both fonts, per the brief's cap. No animation library —
motion is pure CSS (transform/opacity only). No icon library — icons are a
small set of inline 1.5px-stroke SVGs in `components/ui/Icon.jsx`.

## Tokens (styles/index.css, Tailwind v4 `@theme`)

- **Canvas** `--color-canvas: #FAF9F6` warm off-white; **surface** white.
- **Ink** `--color-ink: #141618` near-black; secondary text `stone-450`
  (kept from the existing AA-verified palette).
- **Hairline** `--color-hairline: rgb(20 22 24 / 8%)` — 1px borders replace
  shadows everywhere except popovers/dialogs/toasts.
- **Accent** deep desaturated forest `--color-accent-600/700/800`
  (evolved from brand-700; `brand-*` class names are kept for compatibility
  with existing tests/classes, remapped to the new scale).
- **Tint** `--color-tint: #EEF2ED` pale green for subtle fills.
- **Radii**: `--radius-control: 6px`, `--radius-card: 12px`; pills for
  chips/badges only.
- **Motion tokens** (§ CSS custom properties): `--dur-1: 120ms`,
  `--dur-2: 200ms`, `--dur-3: 320ms`, easing `cubic-bezier(0.22, 1, 0.36, 1)`.
  Only `transform`/`opacity` animate.

## Typography

- Display: **Fraunces Variable** (`.font-display`) — hero headlines, section
  headings, big numbers. Tracking -0.02em on ≥24px.
- UI/body: **Inter Variable** — everything else, line-height 1.6, measure
  ≤65ch, sentence case.
- Tabular numerals for points/counts: `font-variant-numeric: tabular-nums`.

## Decisions

- Restyled existing components in place; logic untouched (tests are
  contracts: roles, labels, accessible names preserved).
- Photography as hero: consistent 4:5 frames on cards, aspect-ratio reserved
  (no layout shift), lazy + async decoding below the fold.
- One soft elevation (`shadow-lift`) for dialogs/popovers/toasts only.
- Status colors (amber/red/blue) muted, status-usage only.
- Admin surfaces: dense, calm, hairline tables; same tokens, quieter.
- `prefers-reduced-motion`: all entrances/reveals/transitions collapse to
  opacity-only or none; carousel auto-advance stays off (existing behavior).
