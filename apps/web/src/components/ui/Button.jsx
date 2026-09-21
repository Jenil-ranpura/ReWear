/**
 * <Button> — the primary interactive primitive.
 * Variants: primary (accent fill) · secondary (hairline outline) · ghost
 * · danger (muted, destructive only). Sizes: sm / md / lg.
 * Pressed: scale(0.98). Focus: global :focus-visible ring. Busy state keeps
 * width (reserved spinner) so layouts never shift.
 *
 * Renders <button> by default; `as={Link}`/`as="a"` renders the same
 * classes on the given element (no polymorphic magic, just className swap).
 */

const VARIANTS = {
  primary:
    'bg-brand-700 text-white hover:bg-brand-800 disabled:hover:bg-brand-700 disabled:opacity-50',
  secondary:
    'bg-white text-ink ring-1 ring-hairline hover:bg-brand-50 disabled:hover:bg-white disabled:opacity-50',
  ghost: 'text-ink-2 hover:bg-brand-50 hover:text-ink disabled:opacity-50',
  danger:
    'bg-white text-status-red ring-1 ring-status-red/30 hover:bg-red-50 disabled:opacity-50',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  className = '',
  children,
  disabled,
  ...rest
}) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={`pressable inline-flex items-center justify-center gap-2 rounded-[6px] font-semibold transition-colors ${
        VARIANTS[variant] ?? VARIANTS.primary
      } ${SIZES[size] ?? SIZES.md} ${className}`}
      {...rest}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
        />
      )}
      {children}
    </button>
  );
}
