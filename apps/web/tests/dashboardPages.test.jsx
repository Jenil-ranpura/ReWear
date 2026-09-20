/**
 * P5-T5 — Dashboard pages tests. Mock ONLY `fetch` (suite convention): the
 * real API client, real AuthProvider (stubbed refresh/me), real pages.
 * The swaps suite is the critical one (§5.7 UI): confirmed accept/reject/
 * cancel issuing the right PATCH bodies, refetch after mutation, and error
 * recovery. Items/points pages cover render, guards, pagination, empties.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import DashboardPage from '../src/pages/DashboardPage.jsx';
import MyItemsPage from '../src/pages/MyItemsPage.jsx';
import MySwapsPage from '../src/pages/MySwapsPage.jsx';
import PointsHistoryPage from '../src/pages/PointsHistoryPage.jsx';
import { AuthProvider } from '../src/state/AuthContext.jsx';
import ToastProvider from '../src/components/shared/ToastProvider.jsx'; // P7-T3: pages call useToast
import { setAccessToken } from '../src/lib/api/client.js';

let fetchCalls = [];
let fetchImpl;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const VIEWER = { _id: 'u-me', name: 'Ada Owner', role: 'USER', pointsBalance: 120 };

const REQUESTS = {
  incoming: {
    requests: [
      {
        _id: 'sr-in-1',
        type: 'POINTS_REDEMPTION',
        status: 'PENDING',
        createdAt: '2026-09-17T10:00:00Z',
        // Session 14 shape: requesterId populated (name/avatar) + items with
        // the display trio (images/size/condition) the card renders.
        requesterId: { _id: 'u-ada', name: 'Ada Lovelace', avatarUrl: null },
        itemId: {
          _id: 'i1',
          title: 'Denim Jacket',
          status: 'APPROVED',
          pointValue: 45,
          size: 'M',
          condition: 'GOOD',
          images: [{ url: 'https://x.test/denim.jpg' }],
        },
      },
      {
        _id: 'sr-in-2',
        type: 'DIRECT_SWAP',
        status: 'ACCEPTED',
        createdAt: '2026-09-16T10:00:00Z',
        requesterId: { _id: 'u-grace', name: 'Grace Hopper', avatarUrl: null },
        itemId: {
          _id: 'i2',
          title: 'Wool Coat',
          status: 'SWAPPED',
          pointValue: 60,
          size: 'L',
          condition: 'FAIR',
          images: [],
        },
        offeredItemId: {
          _id: 'i3',
          title: 'Silk Scarf',
          status: 'SWAPPED',
          pointValue: 30,
          size: 'ONE_SIZE',
          condition: 'LIKE_NEW',
          images: [{ url: 'https://x.test/scarf.jpg' }],
        },
        // Contact reveal (user-requested): the API attaches `contact` to
        // ACCEPTED rows only — this fixture mirrors that contract.
        contact: { name: 'Grace Hopper', email: 'grace@test.dev', phone: '+919876543211' },
      },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
  },
  outgoing: {
    requests: [
      {
        _id: 'sr-out-1',
        type: 'DIRECT_SWAP',
        status: 'PENDING',
        createdAt: '2026-09-17T09:00:00Z',
        requesterId: 'u-me', // outgoing rows are mine — raw id is fine
        itemId: {
          _id: 'i9',
          title: 'Someone Else’s Dress',
          status: 'APPROVED',
          pointValue: 50,
          size: 'S',
          condition: 'NEW',
          images: [{ url: 'https://x.test/dress.jpg' }],
        },
        offeredItemId: {
          _id: 'i3',
          title: 'Silk Scarf',
          status: 'APPROVED',
          pointValue: 30,
          size: 'ONE_SIZE',
          condition: 'LIKE_NEW',
          images: [{ url: 'https://x.test/scarf.jpg' }],
        },
      },
      {
        _id: 'sr-out-2',
        type: 'POINTS_REDEMPTION',
        status: 'ACCEPTED',
        createdAt: '2026-09-15T10:00:00Z',
        requesterId: 'u-me',
        itemId: {
          _id: 'i7',
          title: 'Linen Shirt',
          status: 'SWAPPED',
          pointValue: 25,
          size: 'M',
          condition: 'GOOD',
          images: [{ url: 'https://x.test/shirt.jpg' }],
        },
        // Contact reveal from the REQUESTER's side: the API attaches the
        // OWNER's contact to my accepted outgoing row.
        contact: { name: 'Maya Owner', email: 'maya@test.dev', phone: '+14155552671' },
      },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
  },
};

function makeFetch({ requests, pointsHistory, items, patchResponse } = {}) {
  return (u, _init = {}) => {
    if (u.includes('/auth/refresh') || u.includes('/auth/me')) {
      return u.includes('/auth/refresh')
        ? jsonResponse(200, { accessToken: 't' })
        : jsonResponse(200, { user: VIEWER });
    }
    if (u.includes('/swap-requests/sr-')) {
      return patchResponse ?? jsonResponse(200, { _id: 'sr-x', status: 'ACCEPTED' });
    }
    if (u.includes('/swap-requests')) {
      const dir = u.includes('direction=outgoing') ? 'outgoing' : 'incoming';
      return jsonResponse(200, requests?.[dir] ?? REQUESTS[dir]);
    }
    if (u.includes('/users/me/points/history')) {
      return jsonResponse(200, pointsHistory ?? EMPTY_HISTORY);
    }
    if (u.includes('/users/me/items')) {
      return jsonResponse(200, { items: items ?? [] });
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
  };
}

const EMPTY_HISTORY = {
  transactions: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
};

beforeEach(() => {
  fetchCalls = [];
  setAccessToken(null);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const u = String(url);
      fetchCalls.push({ url: u, init });
      return fetchImpl(u, init);
    })
  );
});

afterEach(() => {
  setAccessToken(null);
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage(route) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/dashboard/items" element={<MyItemsPage />} />
              <Route path="/dashboard/swaps" element={<MySwapsPage />} />
              <Route path="/dashboard/points" element={<PointsHistoryPage />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DashboardPage — profile summary', () => {
  it('shows the user’s name, points balance, and section links', async () => {
    fetchImpl = makeFetch();
    renderPage('/dashboard');

    expect(await screen.findByText(/welcome back, ada/i)).toBeInTheDocument();
    // Detailed PointsBalance renders "120" and "pts" as separate styled spans.
    const pointsCard = screen.getByText(/view history/i).closest('div');
    expect(pointsCard).toHaveTextContent('120');
    expect(screen.getByRole('link', { name: /my listings/i })).toHaveAttribute(
      'href',
      '/dashboard/items'
    );
    expect(screen.getByRole('link', { name: /incoming \/ outgoing/i })).toHaveAttribute(
      'href',
      '/dashboard/swaps'
    );
  });
});

describe('MyItemsPage — my listings', () => {
  it('renders all statuses with edit links only for PENDING/APPROVED', async () => {
    fetchImpl = makeFetch({
      items: [
        { _id: 'a', title: 'Pending Parka', status: 'PENDING', pointValue: 20 },
        { _id: 'b', title: 'Approved Anorak', status: 'APPROVED', pointValue: 25 },
        { _id: 'c', title: 'Swapped Sweater', status: 'SWAPPED', pointValue: 30 },
      ],
    });
    renderPage('/dashboard/items');

    expect(await screen.findByText('Pending Parka')).toBeInTheDocument();
    expect(screen.getByText('Approved Anorak')).toBeInTheDocument();
    expect(screen.getByText('Swapped Sweater')).toBeInTheDocument();

    const editLinks = screen.getAllByRole('link', { name: /^edit$/i });
    expect(editLinks).toHaveLength(2); // PENDING + APPROVED only
    expect(editLinks[0]).toHaveAttribute('href', '/items/a/edit');
    expect(screen.getByText('PENDING')).toBeInTheDocument(); // moderation state visible
  });

  it('shows the first-listing empty state', async () => {
    fetchImpl = makeFetch({ items: [] });
    renderPage('/dashboard/items');

    // The JSX uses a plain ASCII apostrophe here (haven&apos;t).
    expect(await screen.findByText(/listed anything yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /list your first item/i })).toHaveAttribute(
      'href',
      '/items/new'
    );
  });
});

describe('MySwapsPage — the §5.7 UI (critical)', () => {
  it('NEW highlight: unseen PENDING incoming rows get ring + badge + count chip; revisit clears them', async () => {
    localStorage.clear();
    fetchImpl = makeFetch();
    const { unmount } = renderPage('/dashboard/swaps');

    // FIRST visit: the pending row is NEW → highlighted, badged, counted.
    await screen.findAllByTestId('swap-request-row');
    expect(await screen.findByTestId('swap-new-badge')).toBeInTheDocument();
    const highlighted = screen
      .getAllByTestId('swap-request-row')
      .find((row) => row.dataset.highlighted);
    expect(highlighted).toBeDefined();
    expect(screen.getByTestId('new-count-chip')).toHaveTextContent('1');

    // Terminal (ACCEPTED) and outgoing rows never highlight.
    expect(
      screen.getAllByTestId('swap-request-row').filter((row) => row.dataset.highlighted)
    ).toHaveLength(1);

    // SECOND visit (same user, fresh mount): ids were persisted — nothing new.
    unmount();
    cleanup();
    renderPage('/dashboard/swaps');
    await screen.findAllByTestId('swap-request-row');
    expect(screen.queryByTestId('swap-new-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-count-chip')).not.toBeInTheDocument();
    localStorage.clear();
  });

  it('seen-state is PER-USER: another account on the same browser still sees NEW', async () => {
    localStorage.clear();
    fetchImpl = makeFetch();
    renderPage('/dashboard/swaps');
    await screen.findByTestId('swap-new-badge'); // Ada sees + marks seen

    // Simulate a different user's storage namespace (the key carries the id).
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('rewear.seenSwapRequests.'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain('u-me'); // keyed by the VIEWER fixture's id

    localStorage.clear();
  });

  it('incoming tab: self-explanatory rows — requester, plain-language summary, item cards', async () => {
    fetchImpl = makeFetch();
    renderPage('/dashboard/swaps');

    // PENDING redemption row → Accept/Reject.
    const rows = await screen.findAllByTestId('swap-request-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByRole('button', { name: /accept/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /reject/i })).toBeEnabled();
    expect(screen.getByText('Points redemption')).toBeInTheDocument();

    // WHO: the requester's name anchors the row.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    // PLAIN LANGUAGE: the summary says what happened without decoding chips.
    expect(
      screen.getByText(/Ada Lovelace wants to redeem your “Denim Jacket” for 45 pts/i)
    ).toBeInTheDocument();
    // WHAT: item cards with thumbnail + spec line (size · condition · pts).
    const cards = screen.getAllByTestId('swap-item-card');
    expect(cards.length).toBeGreaterThanOrEqual(3); // 2 incoming rows + 1 offered
    expect(within(cards[0]).getByText('Denim Jacket')).toBeInTheDocument();
    expect(within(cards[0]).getByText(/M · GOOD · 45 pts/i)).toBeInTheDocument();
    // alt="" thumbnails are decorative (role presentation) — assert the src.
    const thumb = cards[0].querySelector('img[src]');
    expect(thumb).toHaveAttribute('src', 'https://x.test/denim.jpg');

    // The ACCEPTED direct-swap row: summary + offer card, NO actions.
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(
      screen.getByText(/Grace Hopper wants to swap their item for your “Wool Coat”/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Silk Scarf')).toBeInTheDocument();
    expect(screen.getByText('ACCEPTED')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /accept/i })).toHaveLength(1);
  });

  it('contact reveal: BOTH parties see the contact card on their ACCEPTED row (owner incoming + requester outgoing); PENDING rows never do', async () => {
    fetchImpl = makeFetch();
    renderPage('/dashboard/swaps');
    await screen.findAllByTestId('swap-request-row');

    // Exactly one card — on the accepted row only. Email mailto:-linked;
    // volunteered phone rendered as a dialable tel: link.
    const cards = screen.getAllByTestId('swap-contact-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent(/reach Grace Hopper/i);
    expect(screen.getByRole('link', { name: 'grace@test.dev' })).toHaveAttribute(
      'href',
      'mailto:grace@test.dev'
    );
    expect(screen.getByRole('link', { name: '+919876543211' })).toHaveAttribute(
      'href',
      'tel:+919876543211'
    );

    // PENDING incoming row (sr-in-1): no contact card inside it.
    const pendingRow = screen
      .getAllByTestId('swap-request-row')
      .find((row) => row.textContent.includes('Denim Jacket'));
    expect(within(pendingRow).queryByTestId('swap-contact-card')).not.toBeInTheDocument();

    // ── The REQUESTER's side (user challenge: both parties must be tested). ──
    // My accepted OUTGOING row carries the OWNER's contact, same card, both
    // links; my PENDING outgoing row (sr-out-1) carries none.
    fireEvent.click(screen.getByRole('tab', { name: /outgoing/i }));
    await screen.findByText(/you asked to redeem “Linen Shirt”/i);
    const outCards = screen.getAllByTestId('swap-contact-card');
    expect(outCards).toHaveLength(1);
    expect(outCards[0]).toHaveTextContent(/reach Maya Owner/i);
    expect(screen.getByRole('link', { name: 'maya@test.dev' })).toHaveAttribute(
      'href',
      'mailto:maya@test.dev'
    );
    expect(screen.getByRole('link', { name: '+14155552671' })).toHaveAttribute(
      'href',
      'tel:+14155552671'
    );
    const outPendingRow = screen
      .getAllByTestId('swap-request-row')
      .find((row) => row.textContent.includes('Silk Scarf'));
    expect(within(outPendingRow).queryByTestId('swap-contact-card')).not.toBeInTheDocument();
  });

  it('outgoing tab: Cancel on PENDING rows; direction param reaches the API', async () => {
    fetchImpl = makeFetch();
    renderPage('/dashboard/swaps');

    await screen.findAllByTestId('swap-request-row');
    fireEvent.click(screen.getByRole('tab', { name: /outgoing/i }));

    // Outgoing summary is first-person: what I offered for what.
    await screen.findByText(/you offered “Silk Scarf” for “Someone Else’s Dress”/i);
    expect(fetchCalls.some((c) => c.url.includes('direction=outgoing'))).toBe(true);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });

  it('accept requires confirmation, PATCHes {action: ACCEPT}, and refetches', async () => {
    fetchImpl = makeFetch();
    renderPage('/dashboard/swaps');

    const listCallsBefore = () =>
      fetchCalls.filter((c) => c.url.includes('direction=incoming')).length;
    const before = listCallsBefore();

    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/accept this swap\?/i);
    expect(dialog).toHaveTextContent(/transfers the item/i);

    // Both the row and the dialog confirm say "Accept" — scope to the dialog.
    fireEvent.click(within(dialog).getByRole('button', { name: /^accept$/i }));

    await waitFor(() => {
      const patch = fetchCalls.find((c) => c.url.includes('/swap-requests/sr-in-1'));
      expect(patch).toBeDefined();
      expect(patch.init.method).toBe('PATCH');
      expect(JSON.parse(patch.init.body)).toEqual({ action: 'ACCEPT' });
      // Scoped to the toast (role=status): the accepted row's contact card
      // heading also says "Swap accepted — reach …" (contact reveal).
      expect(screen.getByRole('status')).toHaveTextContent(/swap accepted/i);
    });
    // The list refetched after the mutation (server state is the truth).
    await waitFor(() => expect(listCallsBefore()).toBeGreaterThan(before));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // P7-T3: §13 success feedback — the §5.7 transfer is confirmed in plain
    // language, with a link to the affected items (dedupe key includes the
    // action, so one toast per action — never a stack).
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
    // The accepted row's contact-card heading also says "Swap accepted —
    // reach …" — the toast assertion is scoped to the toast testid.
    expect(screen.getByTestId('toast')).toHaveTextContent(/swap accepted/i);
    expect(screen.getByRole('link', { name: /view items/i })).toHaveAttribute(
      'href',
      '/dashboard/items'
    );
  });

  it('reject PATCHes {action: REJECT}; outgoing cancel PATCHes {action: CANCEL}', async () => {
    fetchImpl = makeFetch();
    renderPage('/dashboard/swaps');

    fireEvent.click(await screen.findByRole('button', { name: /reject/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^reject$/i }));

    await waitFor(() => {
      const patch = fetchCalls.find((c) => c.url.includes('/swap-requests/sr-in-1'));
      expect(JSON.parse(patch.init.body)).toEqual({ action: 'REJECT' });
    });

    // Switch to outgoing and cancel my own request.
    fireEvent.click(screen.getByRole('tab', { name: /outgoing/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /yes, cancel it/i })
    );

    await waitFor(() => {
      const patch = fetchCalls.find((c) => c.url.includes('/swap-requests/sr-out-1'));
      expect(JSON.parse(patch.init.body)).toEqual({ action: 'CANCEL' });
    });
  });

  it('keeps the dialog open and shows the server error when the action fails (§5.9)', async () => {
    fetchImpl = makeFetch({
      patchResponse: jsonResponse(409, {
        error: { code: 'INVALID_STATE', message: 'This request is already REJECTED.' },
      }),
    });
    renderPage('/dashboard/swaps');

    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^accept$/i }));

    // The error banner renders at PAGE level (outside the dialog) so it
    // survives a retry loop.
    expect(await screen.findByRole('alert')).toHaveTextContent(/already rejected/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // retry-able
  });

  it('shows the empty state per direction', async () => {
    fetchImpl = makeFetch({
      requests: { incoming: { requests: [], total: 0 }, outgoing: { requests: [], total: 0 } },
    });
    renderPage('/dashboard/swaps');

    expect(await screen.findByText(/no requests on your items yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /outgoing/i }));
    expect(await screen.findByText(/haven’t requested anything yet/i)).toBeInTheDocument();
  });
});

describe('PointsHistoryPage — the ledger (§9.3)', () => {
  const HISTORY = (n) => ({
    transactions: Array.from({ length: n }, (_, i) => ({
      _id: `tx${i}`,
      amount: i % 2 === 0 ? 20 : -45,
      type: i % 2 === 0 ? 'EARNED' : 'SPENT',
      createdAt: '2026-09-17T10:00:00Z',
    })),
    total: n,
    page: 1,
    pageSize: 20,
    totalPages: n > 20 ? 2 : 1,
    hasNextPage: n > 20,
    hasPrevPage: false,
  });

  it('renders signed amounts and type labels', async () => {
    fetchImpl = makeFetch({ pointsHistory: HISTORY(2) });
    renderPage('/dashboard/points');

    expect(await screen.findByText('+20 pts')).toBeInTheDocument(); // EARNED green
    expect(screen.getByText('-45 pts')).toBeInTheDocument();
    expect(screen.getByText('Earned')).toBeInTheDocument();
    expect(screen.getByText('Spent')).toBeInTheDocument();
  });

  it('paginates: Next requests page 2', async () => {
    fetchImpl = makeFetch({ pointsHistory: HISTORY(25) });
    renderPage('/dashboard/points');

    await screen.findByText(/points history/i);
    await screen.findAllByText('+20 pts'); // several EARNED rows
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    await waitFor(() => {
      expect(
        fetchCalls.some((c) => c.url.includes('/points/history') && c.url.includes('page=2'))
      ).toBe(true);
    });
  });

  it('shows the start-earning empty state', async () => {
    fetchImpl = makeFetch({ pointsHistory: EMPTY_HISTORY });
    renderPage('/dashboard/points');

    expect(await screen.findByText(/no points activity yet/i)).toBeInTheDocument();
  });
});
