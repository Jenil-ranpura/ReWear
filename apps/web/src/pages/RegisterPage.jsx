/**
 * Register page (§5.1/§12/§27 P3-T7). Validates with the SHARED registerSchema
 * (§8 two-sided validation). Maps 409 EMAIL_TAKEN to the email field so the
 * user sees the error where they can act on it; other errors go to the banner.
 *
 * Redesign: mirror of the Login split layout; logic untouched.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';

import { registerSchema } from '@rewear/shared-schemas';
import { ApiError } from '../lib/api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import { LeafIcon } from '../components/ui/Icon.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState(null);

  const {
    register: registerField,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: yupResolver(registerSchema), mode: 'onBlur' });

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      await register(values);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('email', {
          type: 'server',
          message: 'That email is already registered. Try logging in instead.',
        });
      } else if (err instanceof ApiError) {
        setServerError(err.message);
      } else {
        setServerError('Something went wrong. Please try again.');
      }
    }
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-2 lg:gap-16">
      <aside className="hidden lg:flex lg:flex-col lg:justify-end">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-brand-700 text-white"
        >
          <LeafIcon className="h-5 w-5" />
        </span>
        <p className="font-display mt-6 text-4xl leading-tight text-ink">
          Join the community giving clothes a second life.
        </p>
        <p className="measure mt-3 text-sm leading-relaxed text-ink-2">
          List what you no longer wear. Swap it, or let someone redeem it with points they earned.
        </p>
      </aside>

      <section className="mx-auto w-full max-w-md">
        <h1 className="font-display text-4xl text-ink">Create your account</h1>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-5">
          {serverError && (
            <p role="alert" className="rounded-[6px] bg-red-50 px-4 py-3 text-sm text-status-red">
              {serverError}
            </p>
          )}

          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-ink">
              Name
            </label>
            <input id="name" type="text" autoComplete="name" {...registerField('name')} className="field" />
            {errors.name && <p className="mt-1 text-sm text-status-red">{errors.name.message}</p>}
          </div>

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">
              Email
            </label>
            <input id="email" type="email" autoComplete="email" {...registerField('email')} className="field" />
            {errors.email && <p className="mt-1 text-sm text-status-red">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-ink">
              Phone <span className="font-normal text-ink-2">(optional)</span>
            </label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              {...registerField('phone')}
              className="field"
            />
            {errors.phone && <p className="mt-1 text-sm text-status-red">{errors.phone.message}</p>}
            <p className="mt-1.5 text-xs text-stone-450">
              With country code — shown to swap partners only after you accept a swap.
            </p>
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              {...registerField('password')}
              className="field"
            />
            {errors.password && (
              <p className="mt-1 text-sm text-status-red">{errors.password.message}</p>
            )}
            <p className="mt-1.5 text-xs text-stone-450">At least 8 characters.</p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="pressable w-full rounded-[6px] bg-brand-700 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-2">
          Already have an account?{' '}
          <Link to="/login" className="link-underline font-semibold text-brand-700">
            Log in
          </Link>
        </p>
      </section>
    </div>
  );
}
