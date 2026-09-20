/**
 * <SwapArrivalWatcher> tests (Session 14, cont. 3). Mock ONLY fetch (suite
 * convention) + the chime (audio must be silent AND observable in asserts).
 * Covers the subtlety contract: baseline silence on load, toast+chime only
 * for FRESH arrivals on a REAL refetch (driven via queryClient — the 60s
 * poll is too slow for tests), stale arrivals stay silent, per-user mute
 * persists, dismiss works, View links to the swaps page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SwapArrivalWatcher from '../src/components/swaps/SwapArrivalWatcher.jsx';
import { AuthProvider } from '../src/state/AuthContext.jsx';
import ToastProvider from '../src/components/shared/ToastProvider.jsx';
import { setAccessToken } from '../src/lib/api/client.js';

vi.mock('../src/lib/chime.js', () => ({
  isChimeMuted: vi.fn(() => false),
  playChime: vi.fn(),
}));

import { isChimeMuted, playChime } from '../src/lib/chime.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const VIEWER = { _id: 'u-me', name: 'Ada', role: 'USER', pointsBalance: 50 };

function pendingRequest(id, { createdAtOffsetMs = -5_000, name = 'Bettie' } = {}) {
  return {
    _id: id,
    type: 'POINTS_REDEMPTION',
    status: 'PENDING',
    createdAt: new Date(Date.now() + createdAtOffsetMs).toISOString(),
    requesterId: { _id: `u-${id}`, name },
    itemId: { _id: `i-${id}`, title: 'Item', status: 'APPROVED', pointValue: 10 },
  };
}

let fetchImpl;

beforeEach(() => {
  localStorage.clear();
  setAccessToken(null);
  vi.clearAllMocks();
  isChimeMuted.mockReturnValue(false);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (String(url).includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (String(url).includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      if (String(url).includes('/swap-requests')) {
        return jsonResponse(200, { requests: fetchImpl(), total: fetchImpl().length });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
    })
  );
});

afterEach(() => {
  setAccessToken(null);
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Render with a handle to the client so tests can drive REAL refetches.
 *
 * `waitForLoaded` is the REQUIRED gate before swapping fixtures: the first
 * DATA pass is the watcher's baseline, so a fixture swapped before the list
 * has loaded lands inside the baseline pass and (correctly) never toasts —
 * the exact race that made the fresh-arrival tests fail silently.
 */
function renderWatcher() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        {/* P7-T3: the watcher pushes toasts via useToast — the strict
            provider is required here exactly as in the app (Layout owns it). */}
        <AuthProvider>
          <ToastProvider>
            <SwapArrivalWatcher />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  return {
    waitForLoaded: async () => {
      await waitFor(() =>
        expect(
          queryClient.getQueryState(['swap-requests', 'incoming', 'ambient'])?.data
        ).toBeDefined()
      );
      // The query having data is NOT enough: the watcher's baseline capture
      // runs in a PASSIVE EFFECT, which React flushes asynchronously. Flush
      // it here so the baseline is guaranteed to be consumed before the
      // fixture swap — otherwise the refetched pass becomes the effect's
      // first run and gets (correctly) baselined instead of celebrated.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    refetch: () =>
      act(async () => {
        await queryClient.refetchQueries({ queryKey: ['swap-requests'] });
      }),
  };
}

describe('SwapArrivalWatcher — arrival subtlety contract', () => {
  it('stays silent on load: existing pending requests are baseline, never toasted', async () => {
    fetchImpl = () => [pendingRequest('sr-old', { createdAtOffsetMs: -5_000 })];
    renderWatcher();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/swap-requests'),
        expect.anything()
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('swap-arrival-toast')).not.toBeInTheDocument();
    expect(playChime).not.toHaveBeenCalled();
  });

  it('toasts + chimes when a FRESH request arrives on a later poll; View links to swaps', async () => {
    fetchImpl = () => [pendingRequest('sr-base')];
    const { refetch, waitForLoaded } = renderWatcher();
    await waitForLoaded(); // baseline pass must land BEFORE the fixture swap

    // Next poll: a brand-new request, created seconds ago.
    fetchImpl = () => [pendingRequest('sr-base'), pendingRequest('sr-fresh')];
    await refetch();

    // findBy* (retrying) — the refetch resolves the fetch promise, but the
    // effect pass and React's commit land asynchronously; a synchronous getBy
    // races them and flakes (proven by instrumentation).
    expect(await screen.findByTestId('swap-arrival-toast')).toBeInTheDocument();
    expect(screen.getByText(/Bettie wants to swap/i)).toBeInTheDocument();
    expect(playChime).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /view/i })).toHaveAttribute('href', '/dashboard/swaps');
  });

  it('never celebrates a STALE request (created before the poll window)', async () => {
    fetchImpl = () => [pendingRequest('sr-base')];
    const { refetch, waitForLoaded } = renderWatcher();
    await waitForLoaded(); // baseline pass must land BEFORE the fixture swap

    // "New" to the list, but its createdAt is an hour old (clock-skewed
    // backfill / a poll that raced) → silent.
    fetchImpl = () => [
      pendingRequest('sr-base'),
      pendingRequest('sr-stale', { createdAtOffsetMs: -3_600_000 }),
    ];
    await refetch();

    expect(screen.queryByTestId('swap-arrival-toast')).not.toBeInTheDocument();
    expect(playChime).not.toHaveBeenCalled();
  });

  it('respects the persisted per-user mute: toast shows, chime does not play', async () => {
    isChimeMuted.mockReturnValue(true);
    fetchImpl = () => [pendingRequest('sr-base')];
    const { refetch, waitForLoaded } = renderWatcher();
    await waitForLoaded(); // baseline pass must land BEFORE the fixture swap

    fetchImpl = () => [pendingRequest('sr-base'), pendingRequest('sr-fresh', { name: 'Carl' })];
    await refetch();

    expect(await screen.findByText(/Carl wants to swap/i)).toBeInTheDocument();
    expect(playChime).not.toHaveBeenCalled(); // muted
  });

  it('dismiss removes the toast', async () => {
    fetchImpl = () => [pendingRequest('sr-base')];
    const { refetch, waitForLoaded } = renderWatcher();
    await waitForLoaded(); // baseline pass must land BEFORE the fixture swap

    fetchImpl = () => [pendingRequest('sr-base'), pendingRequest('sr-fresh')];
    await refetch();

    await screen.findByTestId('swap-arrival-toast');
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByTestId('swap-arrival-toast')).not.toBeInTheDocument();
  });
});
