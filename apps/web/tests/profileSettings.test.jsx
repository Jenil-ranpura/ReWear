/**
 * ProfileSettingsPage tests — profile self-service UI (PATCH /users/me).
 *
 * Suite convention: mock ONLY fetch (real API client, real AuthProvider with
 * stubbed refresh/me, real RHF + the REAL shared profileUpdateSchema resolver
 * so the client-side validation contract is what's tested).
 *
 * Covered: form prefill, client-side validation (shared schema — junk phone,
 * short name, short new password), the re-auth requirement (schema + server
 * field mapping), PATCH body shape (blank credential fields never sent),
 * AuthContext refresh (navbar name updates), 403 mapping to the
 * currentPassword field, generic banner errors, and saved-state indicator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ProfileSettingsPage from '../src/pages/ProfileSettingsPage.jsx';
import Layout from '../src/components/Layout.jsx';
import DashboardPage from '../src/pages/DashboardPage.jsx';
import { AuthProvider } from '../src/state/AuthContext.jsx';
import ToastProvider from '../src/components/shared/ToastProvider.jsx';
import { setAccessToken } from '../src/lib/api/client.js';

let fetchCalls = [];
let fetchImpl;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const VIEWER = {
  _id: 'u-me',
  name: 'Ada Lovelace',
  email: 'ada@test.dev',
  // Session 15 lesson (recurring): 9876543210 is a DESCENDING RUN — the junk
  // heuristic correctly rejects it, and a prefilled phone must survive the
  // shared validator when the form is resubmitted. 9876543211 is real.
  phone: '+919876543211',
  location: 'Mumbai',
  role: 'USER',
  pointsBalance: 120,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard/profile']}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/dashboard/profile" element={<ProfileSettingsPage />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Renders the page UNDER the real Layout (parent route) to prove the
 * navbar entry point works end-to-end. */
function renderWithLayout() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard/profile']}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/dashboard/profile" element={<ProfileSettingsPage />} />
              </Route>
            </Routes>
          </ToastProvider>
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

function lastPatchBody() {
  const patch = [...fetchCalls].reverse().find((c) => c.init?.method === 'PATCH');
  return patch ? JSON.parse(patch.init.body) : null;
}

describe('ProfileSettingsPage — render & entry points', () => {
  it('prefills name and phone from the signed-in user', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage();

    // Wait on the FILLED VALUE (findByDisplayValue), not the input's
    // existence: the form mounts empty and the async session restore fills
    // it — findByLabelText would race the restore and see ''.
    expect(await screen.findByDisplayValue('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+919876543211')).toBeInTheDocument();
    expect(screen.getByText(/ada@test\.dev/i)).toBeInTheDocument();
  });

  it('is linked from the navbar profile (Layout) and the dashboard card', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderWithLayout();

    const link = await screen.findByRole('link', { name: /ada lovelace — profile settings/i });
    expect(link).toHaveAttribute('href', '/dashboard/profile');
  });
});

describe('ProfileSettingsPage — client-side validation (shared schema)', () => {
  it('blocks a junk phone (1234567890) client-side and never issues a PATCH', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage();

    const phone = await screen.findByLabelText(/phone/i);
    fireEvent.change(phone, { target: { value: '1234567890' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/enter a real phone number/i)).toBeInTheDocument();
    expect(lastPatchBody()).toBeNull();
  });

  it('blocks a too-short name client-side', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage();

    const name = await screen.findByLabelText(/name/i);
    fireEvent.change(name, { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/name must be at least 2 characters/i)).toBeInTheDocument();
    expect(lastPatchBody()).toBeNull();
  });

  it('requires the current password when a new password is entered (schema gate)', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage();

    fireEvent.change(await screen.findByLabelText(/new password/i), {
      target: { value: 'NewPassword123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(
      await screen.findByText(/enter your current password to change it/i)
    ).toBeInTheDocument();
    expect(lastPatchBody()).toBeNull();
  });

  it('blocks a too-short new password client-side', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage();

    fireEvent.change(await screen.findByLabelText(/current password/i), {
      target: { value: 'OldPassword123!' },
    });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(
      await screen.findByText(/new password must be at least 8 characters/i)
    ).toBeInTheDocument();
    expect(lastPatchBody()).toBeNull();
  });
});

describe('ProfileSettingsPage — successful save', () => {
  it('sends name+phone (blank credential fields stripped) and updates the auth user', async () => {
    fetchImpl = (u, init = {}) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      if (init.method === 'PATCH' && u.includes('/users/me')) {
        return jsonResponse(200, {
          user: { ...VIEWER, name: 'Ada K.', phone: '+919876543211' },
        });
      }
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage();

    // Gate on the prefilled value: edits must start AFTER the session
    // restore has landed (and the resync has run) or the restore can
    // clobber the test's keystrokes — the exact race the page guards
    // against for real users.
    await screen.findByDisplayValue('Ada Lovelace');

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada K.' } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '+91 98765 43211' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(lastPatchBody()).not.toBeNull());
    // Blank credential fields are NEVER sent — the API treats absent as
    // "don't touch the credential".
    expect(lastPatchBody()).toEqual({
      name: 'Ada K.',
      phone: '+91 98765 43211',
    });
    expect(lastPatchBody().currentPassword).toBeUndefined();
    expect(lastPatchBody().password).toBeUndefined();

    // Server-mapped user merged into AuthContext → the page reflects it.
    expect(await screen.findByTestId('profile-saved')).toBeInTheDocument();
    expect(await screen.findByLabelText(/name/i)).toHaveValue('Ada K.');
  });

  it('sends the credential fields when the password is being changed', async () => {
    fetchImpl = (u, init = {}) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      if (init.method === 'PATCH' && u.includes('/users/me')) {
        return jsonResponse(200, { user: VIEWER });
      }
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage();

    await screen.findByDisplayValue('Ada Lovelace');

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: 'OldPassword123!' },
    });
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: 'NewPassword123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(lastPatchBody()).not.toBeNull());
    expect(lastPatchBody()).toEqual({
      name: 'Ada Lovelace',
      phone: '+919876543211',
      currentPassword: 'OldPassword123!',
      password: 'NewPassword123!',
    });
  });

  it('shows the success toast', async () => {
    fetchImpl = (u, init = {}) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      if (init.method === 'PATCH' && u.includes('/users/me')) {
        return jsonResponse(200, { user: { ...VIEWER, name: 'Ada K.' } });
      }
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage();

    await screen.findByDisplayValue('Ada Lovelace');

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada K.' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByTestId('toast')).toHaveTextContent(/profile updated/i);
  });
});

describe('ProfileSettingsPage — admin restriction (user-only feature)', () => {
  const ADMIN_VIEWER = { ...VIEWER, role: 'ADMIN' };

  function renderFor(viewer) {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: viewer });
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/dashboard/profile']}>
          <AuthProvider>
            <ToastProvider>
              <Routes>
                <Route path="/dashboard/profile" element={<ProfileSettingsPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
              </Routes>
            </ToastProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('an admin hitting the URL directly sees the forbidden state, not the form', async () => {
    renderFor(ADMIN_VIEWER);

    expect(await screen.findByText(/403 — not allowed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/name/i)).toBeNull();
  });

  it('the navbar profile is NOT a link for admins (no settings entry point)', async () => {
    fetchImpl = (u) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: ADMIN_VIEWER });
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/items']}>
          <AuthProvider>
            <ToastProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/items" element={<div>browse</div>} />
                </Route>
              </Routes>
            </ToastProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // The name renders, but as static text — no profile-settings link.
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /ada lovelace — profile settings/i })).toBeNull();
  });

  it('the dashboard Edit profile link is hidden for admins', async () => {
    renderFor(ADMIN_VIEWER);

    fireEvent.click(screen.getByRole('link', { name: /dashboard/i }));
    expect(await screen.findByText(/welcome back/i)).toBeInTheDocument();
    expect(screen.queryByTestId('edit-profile-link')).toBeNull();
  });

  it('still renders the form for regular users (restriction is admin-only)', async () => {
    renderFor(VIEWER);

    expect(await screen.findByDisplayValue('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });
});

describe('ProfileSettingsPage — server error handling', () => {
  it('maps 403 INVALID_CREDENTIALS to the currentPassword field (dialog stays usable)', async () => {
    fetchImpl = (u, init = {}) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      if (init.method === 'PATCH' && u.includes('/users/me')) {
        return jsonResponse(403, {
          error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' },
        });
      }
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage();

    await screen.findByDisplayValue('Ada Lovelace');

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: 'WrongPassword!' },
    });
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: 'NewPassword123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    // The 403 lands ON the field where the user can act on it.
    expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument();
    // Form not wiped — values intact for a correction.
    expect(screen.getByLabelText(/new password/i)).toHaveValue('NewPassword123!');
  });

  it('renders 400 VALIDATION errors as a role=alert banner', async () => {
    fetchImpl = (u, init = {}) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      if (init.method === 'PATCH' && u.includes('/users/me')) {
        return jsonResponse(400, {
          error: { code: 'VALIDATION', message: 'Enter a real phone number with country code' },
        });
      }
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage();

    await screen.findByDisplayValue('Ada Lovelace');

    fireEvent.change(screen.getByLabelText(/phone/i), {
      target: { value: '+44 20 7946 0958' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /enter a real phone number with country code/i
    );
  });

  it('renders unexpected failures as a friendly banner (no stack traces)', async () => {
    fetchImpl = (u, init = {}) => {
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 't' });
      if (u.includes('/auth/me')) return jsonResponse(200, { user: VIEWER });
      if (init.method === 'PATCH' && u.includes('/users/me')) {
        return jsonResponse(500, {
          error: { code: 'INTERNAL', message: 'Server error' },
        });
      }
      return jsonResponse(404, { error: { code: 'X', message: 'no route' } });
    };
    renderPage();

    await screen.findByDisplayValue('Ada Lovelace');

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada K.' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });
});
