import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import LoginPage from '../src/pages/LoginPage.jsx';
import RegisterPage from '../src/pages/RegisterPage.jsx';
import { ApiError } from '../src/lib/api/client.js';
import { AuthProvider } from '../src/state/AuthContext.jsx';

vi.mock('../src/lib/api/auth.js', () => ({
  register: vi.fn(),
  login: vi.fn(),
  restoreSession: vi.fn().mockRejectedValue(new Error('no session')),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}));

import { login, register } from '../src/lib/api/auth.js';

const me = { id: 'u1', name: 'Ada', email: 'ada@test.dev', role: 'USER', pointsBalance: 120 };

function renderPage(ui) {
  return render(
    <MemoryRouter>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('LoginPage (P3-T7)', () => {
  it('renders email and password fields with a submit button', () => {
    renderPage(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('shows the shared Yup message when the password is empty (no API call)', async () => {
    renderPage(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.dev' } });
    // loginSchema has NO min-length rule (only required) — bad credentials are
    // deliberately left to the server's generic 401 (§15 enumeration resistance).
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });
    expect(login).not.toHaveBeenCalled();
  });

  it('submits valid credentials through the auth context', async () => {
    login.mockResolvedValue(me);

    renderPage(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@test.dev' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password123!' } });

    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({ email: 'ada@test.dev', password: 'Password123!' });
    });
  });

  it('surfaces the server error message in the alert banner (401 INVALID_CREDENTIALS)', async () => {
    login.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'));

    renderPage(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@test.dev' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'WrongPass1!' } });

    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid email or password/i);
    });
  });
});

describe('RegisterPage (P3-T7)', () => {
  it('renders name, email, and password fields', () => {
    renderPage(<RegisterPage />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    // Contact reveal (user-requested): optional phone with consent hint.
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByText(/shown to swap partners only after you accept/i)).toBeInTheDocument();
  });

  it('blocks submission when the shared registerSchema fails (short password)', async () => {
    renderPage(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'short' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/at least/i).length).toBeGreaterThan(0);
    });
    expect(register).not.toHaveBeenCalled();
  });

  it('submits valid data through the auth context', async () => {
    register.mockResolvedValue(me);

    renderPage(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@test.dev' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password123!' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      // objectContaining: the optional phone key's presence/absence is schema-
      // owned, not this test's contract (a dedicated phone test lives below).
      expect(register).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ada Lovelace',
          email: 'ada@test.dev',
          password: 'Password123!',
        })
      );
    });
  });

  it('maps 409 EMAIL_TAKEN to the email field message', async () => {
    register.mockRejectedValue(new ApiError(409, 'EMAIL_TAKEN', 'Email already registered.'));

    renderPage(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'taken@test.dev' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password123!' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/already registered/i)).toBeInTheDocument();
    });
  });

  it('blocks junk phones client-side via the SHARED real-phone rules (1234567890 never reaches the API)', async () => {
    renderPage(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@test.dev' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '1234567890' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/country code/i)).toBeInTheDocument();
    });
    expect(register).not.toHaveBeenCalled();
  });

  it('accepts a real phone and sends it through registration', async () => {
    register.mockResolvedValue(me);

    renderPage(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@test.dev' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '+91 98765 43211' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ phone: '+91 98765 43211' }));
    });
  });
});
