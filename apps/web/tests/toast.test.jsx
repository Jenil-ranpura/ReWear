/**
 * <ToastProvider> tests (P7-T3) — the shared toast primitive. ToastProvider
 * needs NO fetch/auth (unlike the page suites), so these render it directly:
 * contract coverage = viewport + role/status + aria-live, success/info/error
 * tones, optional action link, dedupe on the message key, auto-dismiss TTL,
 * dismiss, and the strict-provider guard (useToast outside → throws).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import ToastProvider, { useToast } from '../src/components/shared/ToastProvider.jsx';

afterEach(cleanup);

/** Probe used to drive useToast() from a test. */
function Probe({ onReady }) {
  const { push } = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        push(onReady());
      }}
    >
      fire
    </button>
  );
}

function renderToastTree() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Probe onReady={() => 'Saved!'} />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('ToastProvider (P7-T3)', () => {
  it('renders the viewport and a toast on push (role=status, aria-live polite)', async () => {
    renderToastTree();
    expect(screen.getByTestId('toast-viewport')).toHaveAttribute('aria-live', 'polite');

    fireEvent.click(screen.getByRole('button', { name: /fire/i }));
    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveAttribute('role', 'status');
    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });

  it('dedupes identical pushes (no stacking) and dismiss works', async () => {
    renderToastTree();
    fireEvent.click(screen.getByRole('button', { name: /fire/i }));
    await screen.findByTestId('toast');
    fireEvent.click(screen.getByRole('button', { name: /fire/i }));
    fireEvent.click(screen.getByRole('button', { name: /fire/i }));

    expect(screen.getAllByTestId('toast')).toHaveLength(1); // deduped, not ×3

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });

  it('auto-dismisses after the TTL (short injected ttl under REAL timers)', async () => {
    // WHY real timers + a short ttl instead of faking 5s: React 18 schedules
    // re-renders via MessageChannel, which vi.useFakeTimers does NOT fake —
    // the dismissal setState fires inside the advanced timer but its commit
    // never flushes inside the test (proven by probe: timer queue drains,
    // DOM unchanged). The ttlMs is per-push injectable precisely so tests
    // can exercise the MECHANISM with a 20ms window.
    let pushFn;
    function TtlProbe() {
      const { push: p } = useToast();
      pushFn = p;
      return null;
    }
    render(
      <MemoryRouter>
        <ToastProvider>
          <TtlProbe />
        </ToastProvider>
      </MemoryRouter>
    );

    act(() => {
      pushFn('Saved!', { ttlMs: 20 });
    });
    expect(screen.getByTestId('toast')).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByTestId('toast')).not.toBeInTheDocument());
  });

  it('renders the action link and the tone ring without altering the contract', async () => {
    let pushFn;
    function ActionProbe() {
      const { push } = useToast();
      pushFn = push;
      return null;
    }
    render(
      <MemoryRouter>
        <ToastProvider>
          <ActionProbe />
        </ToastProvider>
      </MemoryRouter>
    );

    // act-wrapped: a state update from outside React's knowledge must be
    // flushed explicitly or the commit never lands and findBy* hangs.
    act(() => {
      pushFn('Swap accepted.', {
        tone: 'success',
        action: { label: 'View items', to: '/dashboard/items' },
      });
    });

    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveClass('ring-brand-200'); // success tone
    const link = screen.getByRole('link', { name: /view items/i });
    expect(link).toHaveAttribute('href', '/dashboard/items');
  });

  it('throws when useToast is used outside the provider (strict-provider guard)', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      function Orphan() {
        useToast();
        return null;
      }
      expect(() => render(<Orphan />)).toThrow(/useToast must be used within <ToastProvider>/);
    } finally {
      consoleError.mockRestore();
    }
  });
});
