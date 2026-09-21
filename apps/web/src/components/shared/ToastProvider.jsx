/**
 * <ToastProvider> — THE app's single toast primitive (P7-T3, §13 "toast/
 * notification UI for key actions"). Extracted so success/confirm feedback
 * and the Session 14 swap-arrival toast share ONE viewport, ONE aria/visual
 * pattern, and ONE auto-dismiss/dedupe mechanism — no second toast pattern.
 *
 * Usage:
 *   const { push } = useToast();
 *   push('Listing deleted.');
 *   push('Swap accepted — ownership exchanged.', {
 *     tone: 'success',
 *     action: { label: 'View', to: '/dashboard/swaps' },
 *     ttlMs: 8000,
 *     testId: 'swap-arrival-toast', // optional — established test contracts keep their testid
 *   });
 *
 * Design notes:
 * - Strict provider: useToast outside the tree throws (AuthContext
 *   convention) — a missing provider must fail loudly, not silently no-op
 *   (the Session 14 "silently-absent badge" lesson).
 * - aria-live="polite" viewport (bottom-right, same visual family as every
 *   card in the app), role="status" per toast — announced without grabbing
 *   focus (§16 a11y-minded).
 * - Duplicates are DEDUPED on a message+action key and do NOT extend an
 *   existing toast's timer — a burst of identical successes reads as one
 *   confirmation, and the visible toast still disappears on schedule.
 * - Auto-dismiss defaults to 5s (callers passing an action that navigates
 *   may want longer — the arrival watcher passes 8s, matching Session 14).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const DEFAULT_TTL_MS = 5_000;

const TONE_RING = {
  // `ring-brand-200` is a test contract (toast.test.jsx tone assertion).
  success: 'ring-brand-200',
  info: 'ring-hairline',
  error: 'ring-red-200/70',
};

export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]); // { id, message, tone, action }
  const mountedRef = useRef(true);
  // Monotonic ids: deterministic, no Date.now collisions in tests.
  const nextIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, { tone = 'success', action = null, ttlMs = DEFAULT_TTL_MS, testId = null } = {}) => {
      // One toast per message+action: a repeated identical success must not
      // stack, and must NOT reset the existing toast's dismissal timer.
      const key = `${message}::${action?.label ?? ''}::${action?.to ?? ''}`;
      setToasts((prev) => {
        if (prev.some((t) => t.key === key)) return prev;
        const id = nextIdRef.current;
        nextIdRef.current += 1;
        return [...prev, { id, key, message, tone, action, testId }];
      });
      setTimeout(() => {
        if (mountedRef.current) {
          // Remove the EXPIRED toast (=== here kept it and dropped every
          // other live toast — inverted condition, caught by the TTL test).
          setToasts((prev) => prev.filter((t) => t.key !== key));
        }
      }, ttlMs);
    },
    []
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2"
        data-testid="toast-viewport"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            data-testid={toast.testId ?? 'toast'}
            className={`pointer-events-auto page-enter rounded-[12px] bg-white p-3.5 shadow-[var(--shadow-lift)] ring-1 ${
              TONE_RING[toast.tone] ?? TONE_RING.info
            }`}
          >
            <p className="text-sm text-ink">{toast.message}</p>
            <div className="mt-2 flex items-center gap-3">
              {toast.action && (
                <Link
                  to={toast.action.to}
                  onClick={() => dismiss(toast.id)}
                  className="link-underline text-sm font-semibold text-brand-700"
                >
                  {toast.action.label}
                </Link>
              )}
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="text-sm font-medium text-ink-2 transition-colors hover:text-ink"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
