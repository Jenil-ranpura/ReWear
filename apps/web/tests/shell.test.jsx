import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import HomePage from '../src/pages/HomePage.jsx';
import Layout from '../src/components/Layout.jsx';
import { AuthProvider } from '../src/state/AuthContext.jsx';

// Layout is auth-aware since P3-T7; these shell tests only assert nav structure.
vi.mock('../src/lib/api/auth.js', () => ({
  register: vi.fn(),
  login: vi.fn(),
  restoreSession: vi.fn().mockRejectedValue(new Error('no session')),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}));

/** HomePage now hosts the featured carousel (a useQuery consumer). */
function renderWithQueryClient(ui) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  );
}

describe('frontend shell (P1-T5)', () => {
  it('renders the landing hero with working CTAs', () => {
    // The carousel's fetch would 404 under the default jsdom fetch — fine:
    // the carousel self-hides on error, and the hero is the assert target.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'NOT_FOUND', message: 'no route' } }),
      }))
    );
    renderWithQueryClient(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: /second life/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse items/i })).toHaveAttribute('href', '/items');
    expect(screen.getByRole('link', { name: /list an item/i })).toHaveAttribute(
      'href',
      '/items/new'
    );
  });

  it('renders the nav shell with Browse and List-an-Item actions', () => {
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
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Browse$/ })).toHaveAttribute('href', '/items');
  });
});
