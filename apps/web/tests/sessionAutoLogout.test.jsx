/**
 * Fixed session window → automatic logout (§11, user request).
 * The AuthContext mirrors the server-issued absolute session deadline and
 * signs the user out locally the moment it passes (ProtectedRoute then
 * bounces to /login). Also covers the reactive path: a dead-session 401 from
 * /auth/refresh dispatches the SESSION_EXPIRED_EVENT → immediate sign-out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider, useAuth } from '../src/state/AuthContext.jsx';

vi.mock('../src/lib/api/auth.js', () => ({
  register: vi.fn(),
  login: vi.fn(),
  restoreSession: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('../src/lib/api/client.js', () => ({
  getSessionExpiresAt: vi.fn(() => null),
  SESSION_EXPIRED_EVENT: 'rewear:session-expired',
}));

import { login, restoreSession } from '../src/lib/api/auth.js';
import { getSessionExpiresAt } from '../src/lib/api/client.js';

const user = { id: 'u1', name: 'Ada', email: 'ada@test.dev', role: 'USER' };

/** Reads the context so tests can assert status/user transitions. */
function Probe() {
  const { user: u, status, login } = useAuth();
  return (
    <div>
      <span data-testid="auth-status">{status}</span>
      <span data-testid="auth-user">{u?.name ?? 'none'}</span>
      <button
        type="button"
        data-testid="login-btn"
        onClick={() => login({ email: 'ada@test.dev', password: 'Password123!' })}
      >
        login
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const inMs = (ms) => new Date(Date.now() + ms).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  getSessionExpiresAt.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
});

describe('fixed session window → automatic logout', () => {
  it('signs the user out when the server-issued deadline passes (login path)', async () => {
    restoreSession.mockRejectedValue(new Error('anon'));
    login.mockResolvedValue(user);
    getSessionExpiresAt.mockReturnValue(inMs(150)); // deadline ~150ms out

    renderProbe();
    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated');
    });

    fireEvent.click(screen.getByTestId('login-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });
    expect(screen.getByTestId('auth-user')).toHaveTextContent('Ada');

    // The timer fires ~deadline + grace → back to logged-out, user cleared.
    await waitFor(
      () => {
        expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated');
      },
      { timeout: 3000 }
    );
    expect(screen.getByTestId('auth-user')).toHaveTextContent('none');
  });

  it('arms the auto-logout from the restore path too (page reload mid-session)', async () => {
    restoreSession.mockResolvedValue(user);
    getSessionExpiresAt.mockReturnValue(inMs(150));

    renderProbe();
    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });

    await waitFor(
      () => {
        expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated');
      },
      { timeout: 3000 }
    );
  });

  it('stays signed in when the API issues no deadline (session without the cap)', async () => {
    restoreSession.mockResolvedValue(user);
    getSessionExpiresAt.mockReturnValue(null);

    renderProbe();
    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
  });

  it('signs out immediately on the session-expired event (dead refresh cookie)', async () => {
    restoreSession.mockResolvedValue(user);
    getSessionExpiresAt.mockReturnValue(inMs(10 * 60_000)); // far future — timer not due

    renderProbe();
    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });

    fireEvent(window, new Event('rewear:session-expired'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated');
    });
    expect(screen.getByTestId('auth-user')).toHaveTextContent('none');
  });

  it('signs out right away when the deadline is already past at login', async () => {
    restoreSession.mockRejectedValue(new Error('anon'));
    login.mockResolvedValue(user);
    getSessionExpiresAt.mockReturnValue(new Date(Date.now() - 1000).toISOString());

    renderProbe();
    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated');
    });

    fireEvent.click(screen.getByTestId('login-btn'));
    await waitFor(
      () => {
        expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated');
      },
      { timeout: 3000 }
    );
    expect(screen.getByTestId('auth-user')).toHaveTextContent('none');
  });
});
