import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import Layout from '../src/components/Layout.jsx';
import ProtectedRoute from '../src/routes/ProtectedRoute.jsx';
import ForbiddenPage from '../src/pages/ForbiddenPage.jsx';
import { AuthProvider, useAuth } from '../src/state/AuthContext.jsx';

vi.mock('../src/lib/api/auth.js', () => ({
  register: vi.fn(),
  login: vi.fn(),
  restoreSession: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}));

import { restoreSession, logout as logoutApi } from '../src/lib/api/auth.js';

const user = { id: 'u1', name: 'Ada', email: 'ada@test.dev', role: 'USER', pointsBalance: 120 };

/**
 * Session 14 (cont.) — the Layout now renders the ambient NEW-swaps badge,
 * which fetches via the REAL swaps client. Two pending incoming requests
 * (shape per the Session 14 list payload: requesterId populated) → badge 2.
 */
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (String(url).includes('/swap-requests') && String(url).includes('direction=incoming')) {
        return jsonResponse(200, {
          requests: [
            {
              _id: 'sr-1',
              type: 'POINTS_REDEMPTION',
              status: 'PENDING',
              requesterId: { _id: 'u-x', name: 'X' },
              itemId: { _id: 'i1', title: 'A', status: 'APPROVED', pointValue: 10 },
            },
            {
              _id: 'sr-2',
              type: 'DIRECT_SWAP',
              status: 'PENDING',
              requesterId: { _id: 'u-y', name: 'Y' },
              itemId: { _id: 'i2', title: 'B', status: 'APPROVED', pointValue: 20 },
            },
          ],
          total: 2,
        });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** Reads the context so tests can assert status/user transitions. */
function AuthProbe() {
  const { user: u, status, logout } = useAuth();
  return (
    <div>
      <span data-testid="auth-status">{status}</span>
      <span data-testid="auth-user">{u?.name ?? 'none'}</span>
      <button type="button" data-testid="logout-btn" onClick={() => logout()}>
        logout
      </button>
    </div>
  );
}

function renderWithProviders(ui, { route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      {/* QueryClient: the Layout now hosts the ambient NEW-swaps badge (a
          useQuery consumer) — Session 14 (cont.). */}
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthProvider>{ui}</AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('AuthContext (P3-T7)', () => {
  it('restores the session on mount: refresh cookie → user, status authenticated', async () => {
    restoreSession.mockResolvedValue(user);

    renderWithProviders(<AuthProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });
    expect(screen.getByTestId('auth-user')).toHaveTextContent('Ada');
    expect(restoreSession).toHaveBeenCalledTimes(1);
  });

  it('falls back to unauthenticated when the refresh cookie is missing/expired', async () => {
    restoreSession.mockRejectedValue(new Error('no session'));

    renderWithProviders(<AuthProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated');
    });
    expect(screen.getByTestId('auth-user')).toHaveTextContent('none');
  });

  it('exposes logout that calls the API and resets to unauthenticated', async () => {
    restoreSession.mockResolvedValue(user);
    logoutApi.mockResolvedValue(null);

    renderWithProviders(<AuthProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });
    screen.getByTestId('logout-btn').click();
    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated');
    });
    expect(logoutApi).toHaveBeenCalledTimes(1);
  });
});

describe('ProtectedRoute (P3-T7)', () => {
  it('redirects unauthenticated users to /login, remembering where they came from', async () => {
    restoreSession.mockRejectedValue(new Error('anon'));

    render(
      <MemoryRouter initialEntries={['/items/new']}>
        <AuthProvider>
          <Routes>
            <Route
              path="/items/new"
              element={
                <ProtectedRoute>
                  <div>secret content</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<div>login page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('login page')).toBeInTheDocument();
    });
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  it('renders children once authenticated', async () => {
    restoreSession.mockResolvedValue(user);

    renderWithProviders(
      <ProtectedRoute>
        <div>secret content</div>
      </ProtectedRoute>
    );

    await screen.findByText('secret content');
  });

  it('shows the 403 page for authenticated non-admins when requireAdmin is set', async () => {
    restoreSession.mockResolvedValue(user);

    renderWithProviders(
      <ProtectedRoute requireAdmin>
        <div>admin area</div>
      </ProtectedRoute>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /403/i })).toBeInTheDocument();
    });
    expect(screen.queryByText('admin area')).not.toBeInTheDocument();
  });

  it('lets admins through when requireAdmin is set', async () => {
    restoreSession.mockResolvedValue({ ...user, role: 'ADMIN' });

    renderWithProviders(
      <ProtectedRoute requireAdmin>
        <div>admin area</div>
      </ProtectedRoute>
    );

    await screen.findByText('admin area');
  });
});

describe('ForbiddenPage', () => {
  it('renders the 403 heading and a way back home', () => {
    render(
      <MemoryRouter>
        <ForbiddenPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: /403/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });
});

describe('Layout auth awareness (P3-T7)', () => {
  it('P7-T5: offers a skip link as the FIRST focusable element, targeting #main-content', async () => {
    restoreSession.mockRejectedValue(new Error('anon'));

    renderWithProviders(<Layout />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    });
    const skip = screen.getByRole('link', { name: /skip to main content/i });
    expect(skip).toHaveAttribute('href', '#main-content');
    // The target exists, and the skip link is the document's first link —
    // i.e. the first Tab stop on every page.
    expect(document.getElementById('main-content')).not.toBeNull();
    expect(document.querySelector('a')).toBe(skip);
  });

  it('shows Log in / Sign up when signed out', async () => {
    restoreSession.mockRejectedValue(new Error('anon'));

    renderWithProviders(<Layout />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /log out/i })).not.toBeInTheDocument();
  });

  it('shows the user name, points chip, and logout when signed in', async () => {
    restoreSession.mockResolvedValue(user);

    renderWithProviders(<Layout />);

    await waitFor(() => {
      expect(screen.getByText('Ada')).toBeInTheDocument();
    });
    expect(screen.getByText('120 pts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  });

  it('shows the Admin nav link only for admins (P5-T6)', async () => {
    restoreSession.mockResolvedValue({ ...user, role: 'ADMIN' });

    renderWithProviders(<Layout />);

    await waitFor(() => {
      expect(screen.getByText('Ada')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('hides the Admin nav link for regular users (P5-T6)', async () => {
    restoreSession.mockResolvedValue(user); // role: USER

    renderWithProviders(<Layout />);

    await waitFor(() => {
      expect(screen.getByText('Ada')).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  // Product decision: admins are MODERATORS, not marketplace participants —
  // the nav shows only Browse + Admin for them (points chip, List-an-Item
  // CTA, and the Dashboard link are participant affordances).
  it('hides the participant controls for admins: no points chip, no List-an-Item, no Dashboard', async () => {
    restoreSession.mockResolvedValue({ ...user, role: 'ADMIN', pointsBalance: 120 });

    renderWithProviders(<Layout />);

    await waitFor(() => {
      expect(screen.getByText('Ada')).toBeInTheDocument();
    });
    // Points chip absent even though the balance exists (role-scoped, not
    // data-scoped — the admin fixture deliberately keeps pointsBalance).
    expect(screen.queryByText('120 pts')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /list an item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Dashboard/ })).not.toBeInTheDocument();
    // The moderator affordances remain.
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: /^Browse$/ })).toHaveAttribute('href', '/items');
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });

  it('still shows the participant controls for regular users', async () => {
    restoreSession.mockResolvedValue(user); // role: USER, 120 pts

    renderWithProviders(<Layout />);

    await waitFor(() => {
      expect(screen.getByText('Ada')).toBeInTheDocument();
    });
    expect(screen.getByText('120 pts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /list an item/i })).toHaveAttribute(
      'href',
      '/items/new'
    );
    expect(screen.getByRole('link', { name: /^Dashboard/ })).toHaveAttribute('href', '/dashboard');
  });

  it('keeps the List-an-Item CTA for guests (signed-out visitors can still be funneled to listing)', async () => {
    restoreSession.mockRejectedValue(new Error('anon'));

    renderWithProviders(<Layout />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /list an item/i })).toHaveAttribute(
      'href',
      '/items/new'
    );
  });

  it('shows the Dashboard link with the ambient NEW-swaps badge when unseen pending requests exist', async () => {
    localStorage.clear();
    restoreSession.mockResolvedValue(user);

    renderWithProviders(<Layout />);

    await waitFor(() => {
      expect(screen.getByText('Ada')).toBeInTheDocument();
    });
    // The previously-missing Dashboard link, now authed-only.
    const dashLink = await screen.findByRole('link', { name: 'Dashboard' });
    expect(dashLink).toHaveAttribute('href', '/dashboard');
    // Badge: 2 unseen PENDING incoming (from the mocked list above).
    const badge = await screen.findByTestId('nav-new-swaps');
    expect(badge).toHaveTextContent('2');
    // Accessible name carries the count for screen readers.
    expect(screen.getByRole('link', { name: /2 new swap requests/i })).toBeInTheDocument();
  });

  it('shows NO badge when everything is seen (localStorage marked) or signed out', async () => {
    restoreSession.mockResolvedValue(user);
    localStorage.setItem('rewear.seenSwapRequests.u1', JSON.stringify(['sr-1', 'sr-2']));

    const { unmount } = renderWithProviders(<Layout />);
    await waitFor(() => {
      expect(screen.getByText('Ada')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('nav-new-swaps')).not.toBeInTheDocument();
    });
    unmount();
    cleanup();

    // Signed out: no Dashboard link at all, no badge, and NO fetch to the
    // swaps endpoint (the ambient query is disabled without a user).
    restoreSession.mockRejectedValue(new Error('anon'));
    renderWithProviders(<Layout />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-new-swaps')).not.toBeInTheDocument();
  });
});
