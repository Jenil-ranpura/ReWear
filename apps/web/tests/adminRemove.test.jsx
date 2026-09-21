/**
 * Admin REMOVE / live-monitoring / item-details tests (post-approval
 * oversight).
 *
 * Suite convention: mock ONLY fetch (real API client, real AuthProvider with
 * stubbed refresh/me). Covered: AdminLiveItemsPage (list render from the
 * /admin/items contract, Live/Removed tabs, full DETAILS dialog — specs/
 * description/tags/owner, search, REMOVE with required reason — confirm
 * gated client-side and PATCH body verified, toast + error handling) and
 * the admin takedown control on ItemDetailPage (renders only for admins on
 * APPROVED items, PATCH body, redirect to the trail).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminLiveItemsPage from '../src/pages/AdminLiveItemsPage.jsx';
import ItemDetailPage from '../src/pages/ItemDetailPage.jsx';
import { AuthProvider } from '../src/state/AuthContext.jsx';
import ToastProvider from '../src/components/shared/ToastProvider.jsx';
import { setAccessToken } from '../src/lib/api/client.js';

let fetchCalls = [];
let fetchImpl;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const ADMIN = { _id: 'u-admin', name: 'Ada Admin', role: 'ADMIN', pointsBalance: 0 };
const USER = { _id: 'u-user', name: 'Plain User', role: 'USER', pointsBalance: 10 };

const LIVE_ITEMS = {
  total: 2,
  page: 1,
  pageSize: 12,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
  items: [
    {
      _id: 'i-live-1',
      title: 'Counterfeit jacket',
      description: 'A brand-true jacket, allegedly.',
      status: 'APPROVED',
      pointValue: 45,
      category: 'JACKETS',
      type: 'JACKET',
      size: 'M',
      condition: 'GOOD',
      tags: ['leather', 'vintage'],
      images: [{ url: 'https://x.test/j.jpg', isPrimary: true }],
      ownerId: { _id: 'u-owner', name: 'Shady Seller', email: 'shady@test.dev' },
    },
    {
      _id: 'i-live-2',
      title: 'Honest sweater',
      status: 'APPROVED',
      pointValue: 30,
      category: 'TOPS',
      images: [],
      ownerId: { _id: 'u-owner2', name: 'Nice Person', email: 'nice@test.dev' },
    },
  ],
};

const REMOVED_ITEMS = {
  total: 1,
  page: 1,
  pageSize: 12,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
  items: [
    {
      _id: 'i-gone',
      title: 'Struck spam',
      status: 'REMOVED',
      pointValue: 20,
      images: [],
      moderationReason: 'Counterfeit brand listing',
      ownerId: { _id: 'u-owner', name: 'Shady Seller', email: 'shady@test.dev' },
    },
  ],
};

/** Full provider stack — the same one the app uses (strict providers). */
function renderPage(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/live']}>
        <AuthProvider>
          <ToastProvider>{ui}</ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

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

function lastPatch() {
  return [...fetchCalls].reverse().find((c) => c.init?.method === 'PATCH');
}

describe('AdminLiveItemsPage — live-monitoring list', () => {
  it('renders live items with owner info and a Remove control (admin viewer)', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: ADMIN });
      if (u.includes('/admin/items')) return jsonResponse(200, LIVE_ITEMS);
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage(<AdminLiveItemsPage />);

    expect(await screen.findByText('Counterfeit jacket')).toBeInTheDocument();
    expect(screen.getByText(/shady seller/i)).toBeInTheDocument();
    expect(screen.getByTestId('admin-remove-i-live-1')).toBeInTheDocument();
  });

  it('switches to the Removed tab and shows the takedown trail with reason', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: ADMIN });
      if (u.includes('status=REMOVED')) return jsonResponse(200, REMOVED_ITEMS);
      return jsonResponse(200, LIVE_ITEMS);
    };
    renderPage(<AdminLiveItemsPage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Removed' }));

    expect(await screen.findByText('Struck spam')).toBeInTheDocument();
    expect(screen.getByText(/counterfeit brand listing/i)).toBeInTheDocument();
    // Removed rows have no Remove control.
    expect(screen.queryByTestId('admin-remove-i-gone')).toBeNull();
  });

  it('Details opens the full product-details dialog (specs, description, tags, owner)', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: ADMIN });
      return jsonResponse(200, LIVE_ITEMS);
    };
    renderPage(<AdminLiveItemsPage />);

    fireEvent.click(await screen.findByTestId('admin-details-i-live-1'));
    const dialog = await screen.findByRole('dialog');

    // Full details are present — the things a thumbnail can't show.
    expect(within(dialog).getByText('Counterfeit jacket')).toBeInTheDocument();
    expect(within(dialog).getByText('A brand-true jacket, allegedly.')).toBeInTheDocument();
    expect(within(dialog).getByText('JACKETS')).toBeInTheDocument();
    expect(within(dialog).getByText('good')).toBeInTheDocument(); // condition
    expect(within(dialog).getByText('M')).toBeInTheDocument(); // size
    expect(within(dialog).getByText('45 pts')).toBeInTheDocument();
    expect(within(dialog).getByText('Shady Seller')).toBeInTheDocument();
    expect(within(dialog).getByText('shady@test.dev')).toBeInTheDocument();
    expect(within(dialog).getByText('leather')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /open full page/i })).toHaveAttribute(
      'href',
      '/items/i-live-1'
    );
  });

  it('Details dialog closes via its close button', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: ADMIN });
      return jsonResponse(200, LIVE_ITEMS);
    };
    renderPage(<AdminLiveItemsPage />);

    fireEvent.click(await screen.findByTestId('admin-details-i-live-1'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByTestId('dialog-close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('search submits the q param within the selected tab', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: ADMIN });
      return jsonResponse(200, LIVE_ITEMS);
    };
    renderPage(<AdminLiveItemsPage />);

    fireEvent.change(await screen.findByLabelText(/search live items by title/i), {
      target: { value: 'counterfeit' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(fetchCalls.some((c) => c.url.includes('q=counterfeit'))).toBe(true);
    });
  });
});

describe('AdminLiveItemsPage — REMOVE flow', () => {
  function renderRemoveSuite() {
    fetchImpl = (u, init = {}) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: ADMIN });
      if (u.includes('/admin/items')) return jsonResponse(200, LIVE_ITEMS);
      if (init.method === 'PATCH' && u.includes('/moderate')) {
        return jsonResponse(200, { item: { _id: 'i-live-1', status: 'REMOVED' } });
      }
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage(<AdminLiveItemsPage />);
  }

  it('requires a reason before confirm is enabled; sends REMOVE with the reason', async () => {
    renderRemoveSuite();

    // Open the dialog via the row's unique control (the Session 9 lesson:
    // confirm labels must be unique — the confirm is "Yes, remove it").
    fireEvent.click(await screen.findByTestId('admin-remove-i-live-1'));
    await screen.findByRole('dialog');
    const confirmBtn = await screen.findByRole('button', { name: /yes, remove it/i });

    // Confirm is DISABLED until the required reason has text (shared schema
    // contract surfaced in the UI).
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByText(/a reason is required to enable remove/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/reason for the owner/i), {
      target: { value: 'Counterfeit brand listing' },
    });
    expect(confirmBtn).toBeEnabled();

    fireEvent.click(confirmBtn);
    await waitFor(() => expect(lastPatch()).toBeDefined());
    const body = JSON.parse(lastPatch().init.body);
    expect(body).toEqual({ action: 'REMOVE', reason: 'Counterfeit brand listing' });

    // Success toast names the item.
    expect(await screen.findByTestId('toast')).toHaveTextContent(/counterfeit jacket.*removed/i);
  });

  it('does not fire a PATCH when the admin cancels the dialog', async () => {
    renderRemoveSuite();

    fireEvent.click(await screen.findByTestId('admin-remove-i-live-1'));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/reason for the owner/i), {
      target: { value: 'whatever' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(lastPatch()).toBeUndefined();
  });
});

describe('ItemDetailPage — admin takedown control', () => {
  const ITEM = {
    item: {
      _id: 'i-live-1',
      title: 'Counterfeit jacket',
      description: 'A brand-true jacket, allegedly.',
      category: 'JACKETS',
      type: 'JACKET',
      size: 'M',
      condition: 'GOOD',
      pointValue: 45,
      status: 'APPROVED',
      tags: [],
      images: [{ url: 'https://x.test/j.jpg', isPrimary: true }],
      owner: { _id: 'u-owner', name: 'Shady Seller' },
    },
  };

  function renderDetail(viewer) {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: viewer });
      if (u.includes('/items/i-live-1/swap-requests')) {
        return jsonResponse(200, { requests: [], total: 0 });
      }
      if (u.includes('/items/i-live-1')) return jsonResponse(200, ITEM);
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/items/i-live-1']}>
          <AuthProvider>
            <ToastProvider>
              <Routes>
                <Route path="/items/:id" element={<ItemDetailPage />} />
                <Route path="/admin/live" element={<div>live trail</div>} />
              </Routes>
            </ToastProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('shows the admin remove control only for admins on an approved item', async () => {
    renderDetail(ADMIN);
    expect(await screen.findByText(/admin controls/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove listing/i })).toBeInTheDocument();
  });

  it('hides the admin control from regular users', async () => {
    renderDetail(USER);
    expect(await screen.findByRole('heading', { name: 'Counterfeit jacket' })).toBeInTheDocument();
    expect(screen.queryByText(/admin controls/i)).toBeNull();
  });

  it('removes with a required reason, PATCHes, toasts, and redirects to the trail', async () => {
    renderDetail(ADMIN);

    fireEvent.click(await screen.findByRole('button', { name: /remove listing/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText(/reason for the owner/i), {
      target: { value: 'Counterfeit brand listing' },
    });
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Remove')
    );

    await waitFor(() => expect(lastPatch()).toBeDefined());
    expect(JSON.parse(lastPatch().init.body)).toEqual({
      action: 'REMOVE',
      reason: 'Counterfeit brand listing',
    });
    expect(await screen.findByTestId('toast')).toHaveTextContent(/removed/i);
    expect(await screen.findByText('live trail')).toBeInTheDocument();
  });
});
