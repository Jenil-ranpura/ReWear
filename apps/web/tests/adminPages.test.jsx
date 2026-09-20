/**
 * P5-T6 — Admin pages tests. Mock ONLY `fetch` (suite convention): the real
 * API client, real AuthProvider (stubbed refresh/me as an ADMIN), real pages.
 * Covers the §5.8 moderation flow (queue → confirm dialog with reason →
 * PATCH body → queue refetch), the §14.5 duplicate advisory badge, user
 * search/filters reaching the API, ban/unban confirmations, and §5.9 error
 * recovery (dialog stays open, alert banner).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminQueuePage from '../src/pages/AdminQueuePage.jsx';
import AdminReportsPage from '../src/pages/AdminReportsPage.jsx';
import AdminUsersPage from '../src/pages/AdminUsersPage.jsx';
import Pagination from '../src/components/shared/Pagination.jsx';
import { AuthProvider } from '../src/state/AuthContext.jsx';
import ToastProvider from '../src/components/shared/ToastProvider.jsx'; // P7-T3: pages call useToast
import { setAccessToken } from '../src/lib/api/client.js';

let fetchCalls = [];
let fetchImpl;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const ADMIN = { _id: 'u-admin', name: 'Ada Admin', role: 'ADMIN', pointsBalance: 0 };

const QUEUE_PAGE = {
  items: [
    {
      _id: 'i1',
      title: 'Denim Jacket',
      status: 'PENDING',
      pointValue: 45,
      moderationReason: null,
      images: [{ url: 'https://cdn.test/1.jpg', isPrimary: true, perceptualHash: 'h1' }],
      ownerId: { _id: 'u1', name: 'Olive Owner', email: 'olive@test.dev' },
      createdAt: '2026-09-17T08:00:00Z',
    },
    {
      _id: 'i2',
      title: 'Suspected Duplicate Coat',
      status: 'PENDING',
      pointValue: 60,
      moderationReason:
        'Possible duplicate: image matches an existing listing — review before approving.',
      images: [],
      ownerId: { _id: 'u2', name: 'Sam Seller', email: 'sam@test.dev' },
      createdAt: '2026-09-17T09:00:00Z',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 12,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
};

const USERS_PAGE = {
  users: [
    {
      _id: 'u1',
      name: 'Olive Owner',
      email: 'olive@test.dev',
      role: 'USER',
      isBanned: false,
      createdAt: '2026-09-01T10:00:00Z',
    },
    {
      _id: 'u2',
      name: 'Bad Actor',
      email: 'bad@test.dev',
      role: 'USER',
      isBanned: true,
      createdAt: '2026-09-02T10:00:00Z',
    },
    {
      _id: 'u3',
      name: 'Ada Admin',
      email: 'ada@test.dev',
      role: 'ADMIN',
      isBanned: false,
      createdAt: '2026-09-03T10:00:00Z',
    },
  ],
  total: 3,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
};

const EMPTY_QUEUE = { items: [], total: 0, page: 1, pageSize: 12, totalPages: 1 };

function makeFetch({ queue, users, moderateResponse, banResponse, reports, resolveResponse } = {}) {
  return (u, _init = {}) => {
    if (u.includes('/auth/refresh') || u.includes('/auth/me')) {
      return u.includes('/auth/refresh')
        ? jsonResponse(200, { accessToken: 't' })
        : jsonResponse(200, { user: ADMIN });
    }
    if (u.includes('/moderate')) {
      return moderateResponse ?? jsonResponse(200, { item: { _id: 'i1', status: 'APPROVED' } });
    }
    if (u.includes('/ban')) {
      return (
        banResponse ?? jsonResponse(200, { user: { _id: 'u1', isBanned: true }, changed: true })
      );
    }
    // Dispute kit (fraud-response scope addition).
    if (u.includes('/admin/reports/rep-')) {
      return (
        resolveResponse ??
        jsonResponse(200, {
          report: { _id: 'rep-1', status: 'RESOLVED' },
          refund: { amount: 20, requested: 20, shortfall: 0 },
        })
      );
    }
    if (u.includes('/admin/reports')) {
      return jsonResponse(200, reports ?? REPORTS_PAGE);
    }
    if (u.includes('/admin/users')) {
      return jsonResponse(200, users ?? USERS_PAGE);
    }
    if (u.includes('/admin/items/pending')) {
      return jsonResponse(200, queue ?? QUEUE_PAGE);
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
  };
}

const REPORTS_PAGE = {
  reports: [
    {
      _id: 'rep-1',
      status: 'OPEN',
      reason: 'ITEM_NOT_AS_DESCRIBED',
      details: 'The jacket had a torn lining.',
      reporterId: { _id: 'u-req', name: 'Rita Requester', email: 'rita@test.dev' },
      againstId: { _id: 'u-own', name: 'Omar Owner', email: 'omar@test.dev' },
      swapRequestId: {
        _id: 'sr-1',
        type: 'POINTS_REDEMPTION',
        status: 'ACCEPTED',
        requesterPhone: '+919876543211',
        requesterId: { _id: 'u-req', name: 'Rita Requester' },
        itemId: { _id: 'i1', title: 'Denim Jacket', status: 'SWAPPED', pointValue: 45 },
      },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 12,
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

function renderAt(route, page) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route
                path="/admin"
                element={page === 'users' ? <AdminUsersPage /> : <AdminQueuePage />}
              />
              <Route path="/admin/items/pending" element={<AdminQueuePage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/reports" element={<AdminReportsPage />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AdminQueuePage — §5.8 moderation flow', () => {
  it('renders the queue with owner info, status, and the duplicate advisory badge', async () => {
    fetchImpl = makeFetch();
    renderAt('/admin');

    const rows = await screen.findAllByTestId('admin-queue-row');
    expect(rows).toHaveLength(2);

    // Row 0: clean item — owner shown, no advisory.
    expect(rows[0]).toHaveTextContent('Denim Jacket');
    expect(rows[0]).toHaveTextContent(/listed by olive owner/i);
    expect(within(rows[0]).queryByText(/flagged for review/i)).not.toBeInTheDocument();

    // Row 1: §14.5 advisory surfaces from moderationReason (with the reason).
    const badge = within(rows[1]).getByText(/flagged for review/i);
    expect(badge).toHaveAttribute('title', expect.stringMatching(/duplicate/i));

    // Both rows are PENDING.
    expect(screen.getAllByText('PENDING')).toHaveLength(2);
  });

  it('approves via confirmation dialog: PATCH body {action: APPROVE} and queue refetch', async () => {
    fetchImpl = makeFetch();
    renderAt('/admin');

    const queueCalls = () =>
      fetchCalls.filter((c) => c.url.includes('/admin/items/pending')).length;
    const before = queueCalls();

    const rows = await screen.findAllByTestId('admin-queue-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/approve “denim jacket”\?/i);
    expect(dialog).toHaveTextContent(/publicly visible/i);
    // APPROVE has no reason field — the reason is a REJECT affordance.
    expect(within(dialog).queryByLabelText(/reason for the owner/i)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));

    await waitFor(() => {
      const patch = fetchCalls.find((c) => c.url.includes('/items/i1/moderate'));
      expect(patch).toBeDefined();
      expect(patch.init.method).toBe('PATCH');
      expect(JSON.parse(patch.init.body)).toEqual({ action: 'APPROVE' });
    });
    await waitFor(() => expect(queueCalls()).toBeGreaterThan(before));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // P7-T3: the row disappears on refetch, so the toast names the item AND
    // the outcome — the admin never loses track of what they just approved.
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
    expect(screen.getByText(/denim jacket.*approved/i)).toBeInTheDocument();
  });

  it('reject: dialog carries a reason field pre-filled with the §14.5 advisory', async () => {
    fetchImpl = makeFetch();
    renderAt('/admin');

    // Reject the FLAGGED item (row 1, i2).
    const rows = await screen.findAllByTestId('admin-queue-row');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    const reasonBox = within(dialog).getByLabelText(/reason for the owner/i);
    // Pre-filled from moderationReason (§14.5 advisory → review context).
    expect(reasonBox).toHaveValue(
      'Possible duplicate: image matches an existing listing — review before approving.'
    );

    fireEvent.change(reasonBox, { target: { value: 'Image already listed by another user' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^reject$/i }));

    await waitFor(() => {
      const patch = fetchCalls.find((c) => c.url.includes('/items/i2/moderate'));
      expect(JSON.parse(patch.init.body)).toEqual({
        action: 'REJECT',
        reason: 'Image already listed by another user',
      });
    });
  });

  it('reject of an unflagged item sends no reason when the field is left empty', async () => {
    fetchImpl = makeFetch();
    renderAt('/admin');

    // Reject the clean item (row 0, i1 — no moderationReason).
    const rows = await screen.findAllByTestId('admin-queue-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/reason for the owner/i)).toHaveValue('');
    fireEvent.click(within(dialog).getByRole('button', { name: /^reject$/i }));

    await waitFor(() => {
      const patch = fetchCalls.find((c) => c.url.includes('/moderate'));
      expect(JSON.parse(patch.init.body)).toEqual({ action: 'REJECT' });
    });
  });

  it('keeps the dialog open and shows the server error when moderation fails (§5.9)', async () => {
    fetchImpl = makeFetch({
      moderateResponse: jsonResponse(409, {
        error: { code: 'CONFLICT', message: 'Item status changed; refresh the queue.' },
      }),
    });
    renderAt('/admin');

    const rows = await screen.findAllByTestId('admin-queue-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Approve' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^approve$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/status changed/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // retry-able
  });

  it('shows the empty state when the queue is clear', async () => {
    fetchImpl = makeFetch({ queue: EMPTY_QUEUE });
    renderAt('/admin');

    expect(await screen.findByText(/queue is clear/i)).toBeInTheDocument();
  });
});

describe('AdminUsersPage — §10 oversight', () => {
  it('renders users with role/banned badges and per-state actions', async () => {
    fetchImpl = makeFetch();
    renderAt('/admin/users');

    const rows = await screen.findAllByTestId('admin-user-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Olive Owner');
    expect(rows[1]).toHaveTextContent('Bad Actor');
    expect(rows[2]).toHaveTextContent('Ada Admin');
    // Row-scoped badges (the ADMIN filter chip also says "ADMIN").
    expect(within(rows[1]).getByText('BANNED')).toBeInTheDocument();
    expect(within(rows[2]).getByText('ADMIN')).toBeInTheDocument();
    // Active user gets Ban; banned user gets Unban.
    expect(within(rows[0]).getByRole('button', { name: /^Ban$/ })).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: 'Unban' })).toBeInTheDocument();
  });

  it('search submits q to the API', async () => {
    fetchImpl = makeFetch();
    renderAt('/admin/users');

    await screen.findByText('Olive Owner');
    fireEvent.change(screen.getByLabelText(/search users/i), {
      target: { value: 'olive' },
    });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(fetchCalls.some((c) => c.url.includes('q=olive'))).toBe(true);
    });
  });

  it('role and banned filters reach the API (banned=false sent, empty omitted)', async () => {
    fetchImpl = makeFetch();
    renderAt('/admin/users');

    await screen.findByText('Olive Owner');
    fireEvent.click(screen.getByRole('button', { name: 'Banned' }));

    await waitFor(() => {
      expect(fetchCalls.some((c) => c.url.includes('banned=true'))).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    await waitFor(() => {
      expect(fetchCalls.some((c) => c.url.includes('banned=false'))).toBe(true);
    });
  });

  it('ban requires confirmation: PATCH body {banned: true, reason} and list refetch', async () => {
    fetchImpl = makeFetch();
    renderAt('/admin/users');

    const listCalls = () => fetchCalls.filter((c) => c.url.includes('/admin/users?')).length;
    const before = listCalls();

    const rows = await screen.findAllByTestId('admin-user-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: /^Ban$/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/ban olive owner\?/i);
    expect(dialog).toHaveTextContent(/signed out on their next request/i);

    fireEvent.change(within(dialog).getByLabelText(/reason/i), {
      target: { value: 'Fraudulent listings' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /ban user/i }));

    await waitFor(() => {
      const patch = fetchCalls.find((c) => c.url.includes('/users/u1/ban'));
      expect(patch).toBeDefined();
      expect(patch.init.method).toBe('PATCH');
      expect(JSON.parse(patch.init.body)).toEqual({ banned: true, reason: 'Fraudulent listings' });
    });
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('unban PATCHes {banned: false} with no reason key when empty', async () => {
    fetchImpl = makeFetch();
    renderAt('/admin/users');

    fireEvent.click(await screen.findByRole('button', { name: 'Unban' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /unban user/i })
    );

    await waitFor(() => {
      const patch = fetchCalls.find((c) => c.url.includes('/users/u2/ban'));
      expect(JSON.parse(patch.init.body)).toEqual({ banned: false });
    });
  });

  it('keeps the dialog open and shows the server error when ban fails (§5.9)', async () => {
    fetchImpl = makeFetch({
      banResponse: jsonResponse(400, {
        error: { code: 'FORBIDDEN', message: 'Admins cannot ban themselves.' },
      }),
    });
    renderAt('/admin/users');

    const rows = await screen.findAllByTestId('admin-user-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: /^Ban$/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /ban user/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot ban themselves/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Pagination (shared component)', () => {
  it('renders nothing on a single page', () => {
    render(
      <MemoryRouter>
        <Pagination page={1} totalPages={1} onPage={() => {}} />
      </MemoryRouter>
    );
    expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
  });

  it('disables Previous on page 1 and Next on the last page, wiring onPage', () => {
    const onPage = vi.fn();
    render(
      <MemoryRouter>
        <Pagination page={1} totalPages={3} onPage={onPage} />
      </MemoryRouter>
    );
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    const next = screen.getByRole('button', { name: /next/i });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('AdminReportsPage — dispute queue (fraud kit)', () => {
  it('renders the dispute with parties, item, reason, and details', async () => {
    fetchImpl = makeFetch();
    renderAt('/admin/reports');

    const row = await screen.findByTestId('admin-report-row');
    expect(row).toHaveTextContent(/rita requester reporting omar owner/i);
    expect(row).toHaveTextContent(/denim jacket/i);
    expect(row).toHaveTextContent(/not as described/i);
    expect(row).toHaveTextContent(/torn lining/i);
    expect(screen.getByRole('button', { name: /resolve/i })).toBeEnabled();
  });

  it('resolve flow: remedy radio + required note gate the confirm; PATCH body carries both; toast names the refund', async () => {
    fetchImpl = makeFetch();
    renderAt('/admin/reports');

    fireEvent.click(await screen.findByRole('button', { name: /resolve/i }));
    const dialog = screen.getByRole('dialog');

    // Confirm is gated until a remedy is picked AND the note is long enough.
    const confirm = within(dialog).getByRole('button', { name: /confirm decision/i });
    expect(confirm).toBeDisabled();

    fireEvent.click(within(dialog).getByLabelText(/refund — reverse/i));
    fireEvent.change(within(dialog).getByLabelText(/resolution note/i), {
      target: { value: 'Verified with both parties — refunding the requester.' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => {
      const patch = fetchCalls.find((c) => c.url.includes('/admin/reports/rep-1'));
      expect(patch).toBeDefined();
      expect(patch.init.method).toBe('PATCH');
      expect(JSON.parse(patch.init.body)).toEqual({
        remedy: 'REFUND',
        resolutionNote: 'Verified with both parties — refunding the requester.',
      });
    });
    // Toast reflects the refund (server response echoed back).
    expect(await screen.findByTestId('toast')).toHaveTextContent(/refunded 20 pts/i);
  });

  it('server error keeps the dialog open with the alert (§5.9)', async () => {
    fetchImpl = makeFetch({
      resolveResponse: jsonResponse(409, {
        error: { code: 'INVALID_STATE', message: 'This report is already RESOLVED.' },
      }),
    });
    renderAt('/admin/reports');

    fireEvent.click(await screen.findByRole('button', { name: /resolve/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText(/dismiss — close/i));
    fireEvent.change(within(dialog).getByLabelText(/resolution note/i), {
      target: { value: 'Attempting a double resolution — should fail.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /confirm decision/i }));

    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent(/already resolved/i);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
