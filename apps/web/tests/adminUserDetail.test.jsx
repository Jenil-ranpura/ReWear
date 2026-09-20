/**
 * AdminUserDetailPage (investigation view) tests. Mock ONLY `fetch` (suite
 * convention): real API client, real AuthProvider (stubbed refresh/me as an
 * ADMIN), real page. Covers: evidence sections render the server payload
 * (profile/contact, items, swaps, ledger, reports by/against, admin actions),
 * banned badge, and the not-found empty state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminUserDetailPage from '../src/pages/AdminUserDetailPage.jsx';
import { AuthProvider } from '../src/state/AuthContext.jsx';
import ToastProvider from '../src/components/shared/ToastProvider.jsx';
import { setAccessToken } from '../src/lib/api/client.js';

let fetchMock;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const ADMIN = { _id: 'u-admin', name: 'Ada Admin', role: 'ADMIN', pointsBalance: 0 };

const DETAIL = {
  user: {
    _id: 'u-suspect',
    name: 'Sam Suspect',
    email: 'sam@rewear.test',
    phone: '+919876543210',
    role: 'USER',
    isBanned: true,
    pointsBalance: 80,
    createdAt: '2026-01-05T10:00:00Z',
  },
  counts: { total: 2, PENDING: 1, APPROVED: 0, REJECTED: 0, SWAPPED: 1 },
  items: [
    {
      _id: 'i1',
      title: 'Floral Dress',
      category: 'DRESSES',
      size: 'S',
      pointValue: 40,
      status: 'SWAPPED',
      moderationReason: null,
      createdAt: '2026-02-01T10:00:00Z',
    },
    {
      _id: 'i2',
      title: 'Pending Sneakers',
      category: 'FOOTWEAR',
      size: 'UK 8',
      pointValue: 25,
      status: 'PENDING',
      moderationReason: 'Image quality too low — review.',
      createdAt: '2026-03-01T10:00:00Z',
    },
  ],
  swaps: {
    items: [
      {
        _id: 's1',
        type: 'POINTS_REDEMPTION',
        status: 'ACCEPTED',
        requesterId: { _id: 'u-other', name: 'Olive Other', email: 'olive@rewear.test' },
        itemId: { _id: 'i1', title: 'Floral Dress', pointValue: 40, ownerId: 'u-other' },
        offeredItemId: null,
        createdAt: '2026-03-02T10:00:00Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  },
  ledger: [
    {
      _id: 't1',
      amount: 40,
      type: 'EARNED',
      relatedSwapRequestId: { _id: 's1', type: 'POINTS_REDEMPTION', status: 'ACCEPTED' },
      createdAt: '2026-03-02T10:05:00Z',
    },
    {
      _id: 't2',
      amount: -25,
      type: 'SPENT',
      relatedSwapRequestId: null,
      createdAt: '2026-03-03T10:05:00Z',
    },
  ],
  reportsFiled: [],
  reportsAgainst: [
    {
      _id: 'r1',
      reason: 'FAKE_ITEM',
      status: 'OPEN',
      details: 'The item never arrived.',
      reporterId: { _id: 'u-other', name: 'Olive Other' },
      swapRequestId: { _id: 's1', type: 'POINTS_REDEMPTION', status: 'ACCEPTED' },
      createdAt: '2026-03-04T10:00:00Z',
    },
  ],
  adminActions: [
    {
      _id: 'a1',
      action: 'BAN',
      reason: 'Repeated fake listings',
      adminId: { _id: 'u-admin', name: 'Ada Admin' },
      createdAt: '2026-03-05T10:00:00Z',
    },
  ],
};

function renderPage(id = 'u-suspect') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[`/admin/users/${id}`]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/admin/users/:id" element={<AdminUserDetailPage />} />
              <Route path="/admin/users" element={<p>users list</p>} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  setAccessToken('admin-token');
  fetchMock = vi.fn(async (url) => {
    if (url.includes('/admin/users/u-suspect')) {
      return jsonResponse(200, DETAIL);
    }
    if (url.includes('/auth/refresh')) return jsonResponse(401, { error: {} });
    if (url.includes('/auth/me')) return jsonResponse(200, { user: ADMIN });
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<AdminUserDetailPage> (investigation view)', () => {
  it('renders the identity card with contact, points and BANNED badge', async () => {
    renderPage();
    const detail = await screen.findByTestId('admin-user-detail');

    expect(within(detail).getByText('Sam Suspect')).toBeInTheDocument();
    expect(within(detail).getByText('sam@rewear.test')).toBeInTheDocument();
    expect(within(detail).getByText('+919876543210')).toBeInTheDocument();
    expect(within(detail).getByText('80 pts')).toBeInTheDocument();
    expect(within(detail).getByText('BANNED')).toBeInTheDocument();
  });

  it('shows behavior counters and every item with status + moderation note', async () => {
    renderPage();
    const detail = await screen.findByTestId('admin-user-detail');

    // Counters card: total, approved, pending, swapped.
    expect(within(detail).getByText('Items listed')).toBeInTheDocument();
    expect(within(detail).getAllByText('1').length).toBeGreaterThan(0);

    // Items with their statuses and the reviewer note where present.
    expect(within(detail).getByText('Floral Dress')).toBeInTheDocument();
    expect(within(detail).getByText('Pending Sneakers')).toBeInTheDocument();
    expect(within(detail).getByText(/Image quality too low/)).toBeInTheDocument();
    expect(within(detail).getByText('SWAPPED')).toBeInTheDocument();
  });

  it('renders swaps, ledger, reports against them and the admin audit trail', async () => {
    renderPage();
    const detail = await screen.findByTestId('admin-user-detail');

    // Swap row: role of the user + counterparty item.
    expect(within(detail).getByText(/Points redemption/)).toBeInTheDocument();
    expect(within(detail).getByText(/Requested from them/)).toBeInTheDocument();

    // Ledger: credits positive, debits negative.
    expect(within(detail).getByText('+40 pts')).toBeInTheDocument();
    expect(within(detail).getByText('-25 pts')).toBeInTheDocument();

    // Disputes against them, with the reporter named and the allegation quoted.
    const disputes = within(detail).getByText('Reports against this user').closest('section');
    expect(within(disputes).getByText('Fake item')).toBeInTheDocument();
    expect(within(disputes).getByText(/The item never arrived./)).toBeInTheDocument();
    expect(within(disputes).getByText(/Filed by/)).toBeInTheDocument();

    // Audit: who banned and why.
    const audit = within(detail).getByText('Admin actions on this account').closest('section');
    expect(within(audit).getByText('BAN')).toBeInTheDocument();
    expect(within(audit).getByText(/Repeated fake listings/)).toBeInTheDocument();
    expect(within(audit).getByText(/by Ada Admin/)).toBeInTheDocument();
  });

  it('surfaces a human error (with retry) for a missing user — §5.9', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/admin/users/u-ghost')) {
        return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'User not found.' } });
      }
      if (url.includes('/auth/refresh')) return jsonResponse(401, { error: {} });
      if (url.includes('/auth/me')) return jsonResponse(200, { user: ADMIN });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPage('u-ghost');
    // AsyncBoundary's §5.9 error state: human-readable message, no stack.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText('User not found.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
