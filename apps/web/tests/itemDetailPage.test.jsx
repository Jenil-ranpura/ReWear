/**
 * P5-T3 — Item detail page tests. Mock ONLY `fetch` (suite convention): the
 * real API client, real AuthProvider (via a stubbed /auth/refresh + /auth/me,
 * the same integration style as restore.test.jsx), and the real page run.
 * Covers the §5.5/§5.6 CTA branching (guest / non-owner / owner), the
 * gallery, the direct-swap dialog picker (§14.2 client-side filter + POST
 * body), the insufficient-points disable, and the §5.9 error state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ItemDetailPage from '../src/pages/ItemDetailPage.jsx';
import { AuthProvider } from '../src/state/AuthContext.jsx';
import ToastProvider from '../src/components/shared/ToastProvider.jsx'; // P7-T3: pages call useToast
import { setAccessToken } from '../src/lib/api/client.js';

let fetchCalls = [];
let fetchImpl;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const OWNER = { _id: 'u-owner', name: 'Marta Owner', location: 'Lisbon', role: 'USER' };
const VIEWER = { _id: 'u-viewer', name: 'Ada Viewer', role: 'USER', pointsBalance: 120 };

const ITEM = {
  _id: 'i1',
  title: 'Denim Jacket',
  description: 'A sturdy classic denim jacket.',
  category: 'JACKETS',
  type: 'JACKET',
  size: 'M',
  condition: 'GOOD',
  tags: ['denim', 'vintage'],
  pointValue: 45,
  status: 'APPROVED',
  images: [
    { url: 'https://x.test/front.jpg', isPrimary: true },
    { url: 'https://x.test/back.jpg', isPrimary: false },
  ],
  owner: OWNER,
};

/**
 * The standard stub: silent-restore auth (viewer = the logged-in user, or
 * null → 401s → guest) + the item + my-items for the picker + swap creation.
 */
function makeDefaultFetch({ item = ITEM, viewer = VIEWER, myItems, swapResponse } = {}) {
  return (u) => {
    if (u.includes('/auth/refresh')) {
      return viewer
        ? jsonResponse(200, { accessToken: 'restored-token' })
        : jsonResponse(401, { error: { code: 'INVALID_REFRESH', message: 'no session' } });
    }
    if (u.includes('/auth/me')) {
      return viewer
        ? jsonResponse(200, { user: viewer })
        : jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'no token' } });
    }
    // NOTE: /items/i1/swap-requests also contains '/items/i1', so the
    // swap-requests branch MUST be checked first.
    if (u.includes('/swap-requests')) {
      return swapResponse ?? jsonResponse(201, { _id: 'sr1', status: 'PENDING' });
    }
    if (u.includes('/users/me/items')) {
      return jsonResponse(200, {
        items: myItems ?? [
          {
            _id: 'mine1',
            title: 'My Wool Coat',
            status: 'APPROVED',
            size: 'M',
            condition: 'LIKE_NEW',
            pointValue: 30,
          },
          {
            _id: 'i1',
            title: item.title,
            status: 'APPROVED',
            size: 'M',
            condition: 'GOOD',
            pointValue: item.pointValue,
          },
          {
            _id: 'mine2',
            title: 'My Pending Scarf',
            status: 'PENDING',
            size: 'S',
            condition: 'NEW',
            pointValue: 10,
          },
        ],
      });
    }
    if (u.includes('/items/i1')) return jsonResponse(200, { item });
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
  };
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/items/i1']}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/items/:id" element={<ItemDetailPage />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ItemDetailPage — render (§5.5)', () => {
  it('fetches the item and renders title, pointValue, specs, tags, and owner', async () => {
    fetchImpl = makeDefaultFetch();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Denim Jacket' })).toBeInTheDocument();
    expect(screen.getByText('45 pts')).toBeInTheDocument();
    expect(screen.getByText('JACKETS')).toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument(); // condition humanized
    expect(screen.getByText('denim')).toBeInTheDocument();
    expect(screen.getByText('Marta Owner')).toBeInTheDocument();
    expect(fetchCalls.some((c) => c.url.includes('/items/i1'))).toBe(true);
  });

  it('shows the gallery with both photos and switches the active image on click', async () => {
    fetchImpl = makeDefaultFetch();
    renderPage();

    await screen.findByRole('heading', { name: 'Denim Jacket' });
    expect(screen.getByRole('img', { name: 'Denim Jacket' })).toHaveAttribute(
      'src',
      'https://x.test/front.jpg'
    );
    fireEvent.click(screen.getByRole('button', { name: /show photo 2 of 2/i }));
    expect(screen.getByRole('img', { name: 'Denim Jacket' })).toHaveAttribute(
      'src',
      'https://x.test/back.jpg'
    );
  });
});

describe('ItemDetailPage — CTA branching (§5.5/§5.6)', () => {
  it('guests see a log-in prompt instead of swap CTAs', async () => {
    fetchImpl = makeDefaultFetch({ viewer: null });
    renderPage();

    expect(await screen.findByRole('link', { name: /log in/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request swap/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /redeem/i })).not.toBeInTheDocument();
  });

  it('the owner sees a manage hint and no swap CTAs', async () => {
    fetchImpl = makeDefaultFetch({ viewer: { ...VIEWER, _id: OWNER._id } });
    renderPage();

    expect(await screen.findByText(/this is your listing/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request swap/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /redeem/i })).not.toBeInTheDocument();
  });

  it('a non-owner sees both CTAs when their balance covers redemption', async () => {
    fetchImpl = makeDefaultFetch();
    renderPage();

    expect(await screen.findByRole('button', { name: /request swap/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /redeem for 45 pts/i })).toBeEnabled();
  });

  it('disables redemption when the balance is insufficient (§5.6)', async () => {
    fetchImpl = makeDefaultFetch({ viewer: { ...VIEWER, pointsBalance: 10 } });
    renderPage();

    const redeem = await screen.findByRole('button', { name: /redeem for 45 pts/i });
    expect(redeem).toBeDisabled();
    expect(screen.getByText(/points away/i)).toBeInTheDocument();
  });
});

describe('ItemDetailPage — direct swap dialog (§5.5/§14.2)', () => {
  it('opens the dialog, lists only own APPROVED items, and POSTs the chosen offer', async () => {
    fetchImpl = makeDefaultFetch();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /request swap/i }));

    const dialog = await screen.findByRole('dialog');
    // The §14.2 filter: only my APPROVED item shows — the PENDING scarf and
    // the requested item itself must not appear.
    expect(await within(dialog).findByText('My Wool Coat')).toBeInTheDocument();
    expect(within(dialog).queryByText('My Pending Scarf')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Denim Jacket')).not.toBeInTheDocument();

    // Confirm stays disabled until an offer is selected.
    expect(within(dialog).getByRole('button', { name: /send swap request/i })).toBeDisabled();

    fireEvent.click(within(dialog).getByLabelText(/my wool coat/i));
    fireEvent.click(within(dialog).getByRole('button', { name: /send swap request/i }));

    await waitFor(() => {
      const call = fetchCalls.find((c) => c.url.includes('/items/i1/swap-requests'));
      expect(call).toBeDefined();
      expect(call.init.method).toBe('POST');
      expect(JSON.parse(call.init.body)).toEqual({
        type: 'DIRECT_SWAP',
        offeredItemId: 'mine1',
      });
    });

    // P7-T3: §5.5 UI result ("Pending" state) — confirmed by toast; the
    // dialog is gone (onCreated closed it) and the owner sees the outcome.
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
    expect(screen.getByText(/swap request sent/i)).toBeInTheDocument();
  });

  it('closes the dialog on cancel', async () => {
    fetchImpl = makeDefaultFetch();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /request swap/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the server error inline when creation fails (§5.9 recovery)', async () => {
    fetchImpl = makeDefaultFetch({
      swapResponse: jsonResponse(409, {
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'You already have a pending request on this item.',
        },
      }),
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /request swap/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByLabelText(/my wool coat/i));
    fireEvent.click(within(dialog).getByRole('button', { name: /send swap request/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /already have a pending request/i
    );
    // The dialog stays open so the user can cancel or retry.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('ItemDetailPage — points redemption dialog (§5.6)', () => {
  it('POSTs a POINTS_REDEMPTION request after confirmation', async () => {
    fetchImpl = makeDefaultFetch();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /redeem for 45 pts/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/45 points/i)).toBeInTheDocument();
    expect(within(dialog).getByText('120')).toBeInTheDocument(); // viewer balance

    fireEvent.click(within(dialog).getByRole('button', { name: /send redemption request/i }));

    await waitFor(() => {
      const call = fetchCalls.find((c) => c.url.includes('/items/i1/swap-requests'));
      expect(call).toBeDefined();
      expect(JSON.parse(call.init.body)).toEqual({ type: 'POINTS_REDEMPTION' });
    });
  });
});

describe('ItemDetailPage — missing item (§5.9/§15)', () => {
  it('renders the human error state for a 404', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) {
        return jsonResponse(401, { error: { code: 'INVALID_REFRESH', message: 'no session' } });
      }
      if (u.includes('/items/')) {
        return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Item not found.' } });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
    };
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/item not found/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
