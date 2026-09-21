/**
 * Login page (§5.2/§12/§27 P3-T7). Validates with the SHARED loginSchema —
 * the exact same rules the API enforces (§8 two-sided validation).
 * On success: redirect to where the user came from (ProtectedRoute passes
 * location.state.from) or home.
 *
 * Redesign: focused split layout — editorial tonal panel + hairline form.
 */

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';

import { loginSchema } from '@rewear/shared-schemas';
import { ApiError } from '../lib/api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import { LeafIcon } from '../components/ui/Icon.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState(null);

  const {
    register: registerField,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: yupResolver(loginSchema), mode: 'onBlur' });

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      await login(values);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'
      );
    }
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-2 lg:gap-16">
      {/* Editorial panel — typographic, no fabricated claims. */}
      <aside className="hidden lg:flex lg:flex-col lg:justify-end">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-brand-700 text-white"
        >
          <LeafIcon className="h-5 w-5" />
        </span>
        <p className="font-display mt-6 text-4xl leading-tight text-ink">
          Welcome back to your sustainable wardrobe.
        </p>
        <p className="measure mt-3 text-sm leading-relaxed text-ink-2">
          Pick up where you left off — your listings, swaps, and points are exactly where you left
          them.
        </p>
      </aside>

      <section className="mx-auto w-full max-w-md">
        <h1 className="font-display text-4xl text-ink">Log in</h1>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-5">
          {serverError && (
            <p
              role="alert"
              className="rounded-[6px] bg-red-50 px-4 py-3 text-sm text-status-red"
            >
              {serverError}
            </p>
          )}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              {...registerField('email')}
              className="field"
            />
            {errors.email && <p className="mt-1 text-sm text-status-red">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              {...registerField('password')}
              className="field"
            />
            {errors.password && (
              <p className="mt-1 text-sm text-status-red">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="pressable w-full rounded-[6px] bg-brand-700 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-2">
          New to ReWear?{' '}
          <Link
            to="/register"
            className="link-underline font-semibold text-brand-700"
          >
            Create an account
          </Link>
        </p>
      </section>
    </div>
  );
}
