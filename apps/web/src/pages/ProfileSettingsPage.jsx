/**
 * ProfileSettingsPage — profile self-service UI (§10 PATCH /users/me).
 *
 * Reached from the navbar's clickable profile (and /dashboard "Edit profile").
 * Edits name, phone (optional, shared real-phone validation), and — behind a
 * re-authentication gate — the password. Validation is the SAME shared
 * `profileUpdateSchema` the API enforces (yupResolver), so client and server
 * rules cannot drift.
 *
 * Server error mapping: 403 INVALID_CREDENTIALS lands on the currentPassword
 * field where the user can act on it; everything else goes to the banner.
 * Success merges the returned safe user into AuthContext (navbar updates
 * instantly) and fires the shared toast.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';

import { profileUpdateSchema } from '@rewear/shared-schemas';
import { updateProfile } from '../lib/api/users.js';
import { ApiError } from '../lib/api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import ForbiddenPage from './ForbiddenPage.jsx';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200';

export default function ProfileSettingsPage() {
  const { user, updateUser } = useAuth();
  const { push: pushToast } = useToast();

  // ALL hooks must run on every render (Rules of Hooks) — the admin early
  // return happens BELOW, after hook initialization.
  const [serverError, setServerError] = useState(null);
  const [saved, setSaved] = useState(false);

  const {
    register: registerField,
    handleSubmit,
    setError,
    reset,
    watch,
    getValues,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: yupResolver(profileUpdateSchema),
    mode: 'onBlur',
    defaultValues: {
      name: user?.name ?? '',
      phone: user?.phone ?? '',
      currentPassword: '',
      password: '',
    },
  });

  const newPassword = watch('password');

  /**
   * Resync ONCE when the auth user arrives late (session restore is async —
   * defaultValues can capture null on a direct mount).
   *
   * Deliberately NOT gated on formState.isDirty: RHF delivers dirty-state
   * updates through an async subject stream, so a restore landing right
   * after the user's first keystrokes would see a stale `false` and WIPE
   * their typing (caught live by the profile test suite). getValues() reads
   * the internal store SYNCHRONOUSLY — a keystroke is always visible here.
   */
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!user || syncedRef.current) return;
    syncedRef.current = true;
    const v = getValues();
    const untouched = !v.name && !v.phone && !v.currentPassword && !v.password;
    if (untouched) {
      reset({
        name: user.name ?? '',
        phone: user.phone ?? '',
        currentPassword: '',
        password: '',
      });
    }
  }, [user, getValues, reset]);

  // USER-only surface (product decision; the API 403s admins too). Direct
  // URL access by an admin renders the standard forbidden state instead of
  // a form that could never succeed. AFTER all hooks (Rules of Hooks).
  if (user?.role === 'ADMIN') {
    return <ForbiddenPage />;
  }

  const onSubmit = async (values) => {
    setServerError(null);
    setSaved(false);
    try {
      // Never send blank credential fields — the API treats an absent
      // password as "don't touch the credential".
      const payload = { name: values.name, phone: values.phone ?? '' };
      if (values.password) {
        payload.currentPassword = values.currentPassword;
        payload.password = values.password;
      }
      const { user: safeUser } = await updateProfile(payload);
      updateUser(safeUser);
      reset({
        name: safeUser.name ?? '',
        phone: safeUser.phone ?? '',
        currentPassword: '',
        password: '',
      });
      setSaved(true);
      pushToast('Profile updated.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && err.code === 'INVALID_CREDENTIALS') {
        setError('currentPassword', {
          type: 'server',
          message: err.message || 'Current password is incorrect.',
        });
      } else if (err instanceof ApiError && err.status === 400) {
        setServerError(err.message);
      } else {
        setServerError('Something went wrong. Please try again.');
      }
    }
  };

  return (
    <section className="mx-auto max-w-xl">
      <nav aria-label="Breadcrumb" className="text-sm text-stone-500">
        <Link to="/dashboard" className="hover:underline">
          Dashboard
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="font-medium text-stone-700">Profile</span>
      </nav>

      <h1 className="mt-2 text-3xl font-bold text-stone-900">Profile settings</h1>
      <p className="mt-1 text-stone-500">
        {user?.email} · signed in{user?.location ? ` · ${user.location}` : ''}
      </p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-5">
        {serverError && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {serverError}
          </p>
        )}
        {saved && !serverError && (
          <p
            role="status"
            data-testid="profile-saved"
            className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800"
          >
            Your profile has been updated.
          </p>
        )}

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-stone-700">
            Name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            aria-invalid={Boolean(errors.name)}
            {...registerField('name')}
            className={FIELD_CLASS}
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-stone-700">
            Phone <span className="font-normal text-stone-500">(optional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+91 98765 43210"
            aria-invalid={Boolean(errors.phone)}
            {...registerField('phone')}
            className={FIELD_CLASS}
          />
          {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>}
          <p className="mt-1 text-xs text-stone-450">
            With country code — shown to swap partners only after you accept a swap.
          </p>
        </div>

        <fieldset className="rounded-xl border border-stone-200 p-4">
          <legend className="px-1 text-sm font-semibold text-stone-700">Change password</legend>
          <p className="text-xs text-stone-450">Leave blank to keep your current password.</p>

          <div className="mt-3">
            <label htmlFor="currentPassword" className="block text-sm font-medium text-stone-700">
              Current password{' '}
              {newPassword ? (
                <span className="text-red-600">*</span>
              ) : (
                <span className="font-normal text-stone-500">(only if changing)</span>
              )}
            </label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.currentPassword)}
              {...registerField('currentPassword')}
              className={FIELD_CLASS}
            />
            {errors.currentPassword && (
              <p className="mt-1 text-sm text-red-600">{errors.currentPassword.message}</p>
            )}
          </div>

          <div className="mt-4">
            <label htmlFor="password" className="block text-sm font-medium text-stone-700">
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              {...registerField('password')}
              className={FIELD_CLASS}
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
            )}
            <p className="mt-1 text-xs text-stone-450">At least 8 characters.</p>
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
          {isDirty && !isSubmitting && (
            <span className="text-xs text-stone-450">You have unsaved changes.</span>
          )}
        </div>
      </form>
    </section>
  );
}
