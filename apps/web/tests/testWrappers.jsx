/**
 * Shared test wrapper factory (P7-T3): renders a real page under the SAME
 * provider stack the app uses — TanStack Query, MemoryRouter, AuthProvider,
 * and the shared <ToastProvider> (pages now call useToast, and a strict
 * provider means a missing wrapper THROWS instead of silently breaking).
 *
 * Fetch stays mocked by each suite (the "mock only fetch, never modules"
 * convention) — this helper does not touch fetch.
 *
 * Usage:
 *   renderWithProviders(<MySwapsPage />, { route: '/dashboard/swaps' })
 *   renderWithProviders(<ItemDetailPage />, { route: '/items/i1', path: '/items/:id' })
 *
 * Returns the RTL render result plus `queryClient` (drive refetches /
 * invalidateQueries deterministically instead of waiting on polls).
 */

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

import { AuthProvider } from '../src/state/AuthContext.jsx';
import ToastProvider from '../src/components/shared/ToastProvider.jsx';

export function renderWithProviders(ui, { route = '/', path = null } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = path ? (
    <Routes>
      <Route path={path} element={ui} />
    </Routes>
  ) : (
    ui
  );
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <ToastProvider>{element}</ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { queryClient, ...utils };
}
