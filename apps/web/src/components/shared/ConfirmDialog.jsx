/**
 * <ConfirmDialog> (§12 key reusable component; §13: "swap-request actions use
 * a confirm dialog"). Minimal accessible dialog: Escape/backdrop cancels,
 * focus lands on the confirm button, aria-modal wiring for screen readers.
 * Controlled by the caller: <ConfirmDialog open={...} onConfirm={...} onClose={...}>.
 *
 * P7-T5 accessibility hardening:
 * - FOCUS TRAP: Tab/Shift+Tab cycle inside the dialog — focus can no longer
 *   escape to the (non-inert, but semantically blocked) background.
 * - FOCUS RESTORE: the element focused before opening (the trigger) gets
 *   focus back exactly when the dialog closes/unmounts — a keyboard user is
 *   returned to where they were, not dumped at the top of the page.
 * - `aria-busy` while the action is in flight; the message is wired as the
 *   dialog's `aria-describedby` so screen readers announce it with the title.
 */

import { useEffect, useRef } from 'react';

/** Query for the dialog's focusable children (the trap's cycle set). */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  confirmDisabled = false,
  /** Optional: widen the dialog for content-heavy bodies (item details). */
  wide = false,
  /**
   * Optional: hide the cancel + confirm action row entirely (informational
   * dialogs that close via Escape/backdrop/✕). No-op for confirm flows.
   */
  hideActions = false,
  onConfirm,
  onClose,
}) {
  const confirmRef = useRef(null);
  const dialogRef = useRef(null);
  // Read at open-time only — refocusing on every busy/confirmDisabled flip
  // would yank focus back mid-interaction (e.g. right after the user picks
  // an offer in SwapRequestDialog).
  const actionableRef = useRef(true);
  actionableRef.current = !busy && !confirmDisabled;

  // Always-current onClose without effect dependencies (see below).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Focus RESTORE — keyed on `open` only: remember the opener when the
  // dialog opens, hand focus back in the cleanup (close OR unmount).
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    return () => opener?.focus?.();
  }, [open]);

  // Initial focus + keyboard wiring while open.
  //
  // Runs ONCE per open. Deliberately does NOT depend on the callback props:
  // callers commonly pass inline arrows (a new identity every render), so a
  // [open, onClose] dep re-ran this effect on EVERY keystroke in dialog
  // inputs (e.g. the ban-reason textarea) and its initial-focus call yanked
  // focus from the field back to the confirm button after each character.
  // ESCAPE/Tab/click-outside still work while open — Escape and backdrop
  // clicks read the CURRENT props through the stable handler below, and the
  // Tab handler never touches props.
  useEffect(() => {
    if (!open) return undefined;
    if (actionableRef.current) confirmRef.current?.focus();

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key === 'Tab') {
        // Focus trap: cycle at the ends of the dialog's focusable set.
        const focusables = dialogRef.current?.querySelectorAll(FOCUSABLE);
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        aria-labelledby="confirm-dialog-title"
        aria-describedby={message ? 'confirm-dialog-description' : undefined}
        className={`w-full rounded-xl bg-white p-6 shadow-xl ${wide ? 'max-w-2xl' : 'max-w-sm'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="confirm-dialog-title" className="text-lg font-bold text-stone-900">
            {title}
          </h2>
          {/* Informational dialogs have no action row — always offer a
            pointer/AT-friendly close affordance. */}
          {hideActions && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              data-testid="dialog-close"
              className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            >
              <span aria-hidden="true">✕</span>
            </button>
          )}
        </div>
        {message && (
          <p id="confirm-dialog-description" className="mt-2 text-sm text-stone-600">
            {message}
          </p>
        )}
        {children && <div className="mt-4">{children}</div>}
        {!hideActions && (
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={onConfirm}
              disabled={busy || confirmDisabled}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-700 hover:bg-brand-800'
              }`}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
