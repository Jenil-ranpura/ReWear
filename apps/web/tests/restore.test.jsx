import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import Layout from '../src/components/Layout.jsx';
import { AuthProvider } from '../src/state/AuthContext.jsx';

/**
 * Integration-style test: ONLY `fetch` is mocked — the real client, real
 * auth module, and real context run. This is the test that catches the
 * restore-shape bug the module-mocked tests missed (restore used to return
 * the { user } envelope instead of the user, so the nav showed everything
 * EXCEPT the name after a reload).
 */

const me = {
  id: 'u1',
  name: 'Ada Lovelace',
  email: 'ada@test.dev',
  role: 'USER',
  pointsBalance: 120,
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let refreshCount = 0;

beforeEach(() => {
  refreshCount = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshCount += 1;
        return jsonResponse(200, { accessToken: 'restored-token' });
      }
      if (String(url).endsWith('/auth/me')) {
        if (init.headers?.Authorization !== 'Bearer restored-token') {
          return jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'no token' } });
        }
        return jsonResponse(200, { user: me });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('silent session restore (P3-T7 restore-shape regression)', () => {
  it('shows the actual user name after restore — not just points/logout', async () => {
    render(
      <MemoryRouter>
        {/* QueryClient: the Layout hosts the ambient NEW-swaps badge query. */}
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <AuthProvider>
            <Layout />
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    // The name is THE assertion: it only renders when the restored object is
    // the user itself (with name/pointsBalance), not the { user } envelope.
    await waitFor(
      () => {
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
    expect(screen.getByText('120 pts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  });

  it('calls /auth/refresh exactly once on mount (single-use cookie stays single)', async () => {
    render(
      <MemoryRouter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <AuthProvider>
            <Layout />
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    await screen.findByText('Ada Lovelace');
    // StrictMode double-mounts effects in dev; single-flight refresh must
    // still collapse that to exactly ONE network call.
    expect(refreshCount).toBe(1);
  });
});
