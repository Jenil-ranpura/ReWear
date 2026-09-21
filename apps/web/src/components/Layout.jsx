import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';

import useNewSwapRequests from '../hooks/useNewSwapRequests.js';
import { useAuth } from '../state/AuthContext.jsx';
import PointsBalance from './shared/PointsBalance.jsx';
import ToastProvider from './shared/ToastProvider.jsx';
import SwapArrivalWatcher from './swaps/SwapArrivalWatcher.jsx';

/**
 * Base layout/nav shell (§13). Auth-aware since P3-T7: shows Login/Register
 * when signed out; the user's name, points chip, and Logout when signed in.
 * Avatar dropdown arrives with later phases.
 *
 * Admins are MODERATORS, not marketplace participants (product decision,
 * same principle as the static-text profile link): the nav hides the
 * Dashboard link, the points chip, and the List-an-Item CTA for them —
 * only Browse + Admin remain.
 *
 * Session 14 (cont.): an authed-only DASHBOARD link now exists (it was
 * missing — the only nav paths in were Browse/brand), carrying the ambient
 * NEW-swap-requests badge so owners spot pending requests from ANY page
 * (user request). The badge polls in the background and reflects seen-state
 * marked by a /dashboard/swaps visit via the shared hook.
 *
 * P7-T3: Layout also owns the shared <ToastProvider> — one toast viewport
 * for the whole app. Pages and the SwapArrivalWatcher fire toasts through
 * useToast(); mounting it here (above <Outlet />) keeps toasts alive across
 * route navigation.
 */
export default function Layout() {
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();
  const { count: newSwapCount } = useNewSwapRequests({ user });

  const navLinkClass = ({ isActive }) =>
    `rounded-md px-3 py-2 text-sm font-medium ${
      isActive ? 'bg-brand-100 text-brand-900' : 'text-stone-600 hover:bg-stone-100'
    }`;

  async function handleLogout() {
    await logout();
    navigate('/');
  }
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-stone-50">
        {/* P7-T5: keyboard users skip the (multi-row on mobile) header on
          every page; visible on focus, invisible otherwise. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to main content
        </a>
        <header className="border-b border-stone-200 bg-white">
          {/* P7-T4 responsive pass: min-h + a WRAPPING nav instead of a fixed
            h-16 row — on a 375px phone the authed nav (brand + links + CTA +
            points chip + logout) cannot fit on one line, and a non-wrapping
            flex row forces horizontal page scroll. Two tidy rows on mobile,
            the classic single row from sm/md up (nav items wrap within the
            nav box; the brand never moves). */}
          <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 py-2">
            <Link to="/" className="flex items-center gap-2 text-lg font-bold text-brand-700">
              <span aria-hidden="true">♻️</span>
              <span>ReWear</span>
            </Link>
            <nav
              aria-label="Main navigation"
              className="flex flex-wrap items-center justify-end gap-1"
            >
              <NavLink to="/items" className={navLinkClass}>
                Browse
              </NavLink>{' '}
              {/* Dashboard is a marketplace-participant surface (profile, my
                items, swaps, points) — admins moderate, they don't
                participate (same product decision as the profile link).
                The ambient NEW-swaps badge lives here for USERS only. */}
              {status === 'authenticated' && user && user.role !== 'ADMIN' && (
                <NavLink to="/dashboard" className={navLinkClass}>
                  Dashboard
                  {/* Ambient NEW badge — visible from any page (0 → nothing). */}
                  {newSwapCount > 0 && (
                    <span
                      data-testid="nav-new-swaps"
                      aria-label={`${newSwapCount} new swap request${newSwapCount === 1 ? '' : 's'}`}
                      className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-brand-700 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white"
                    >
                      {newSwapCount}
                    </span>
                  )}
                </NavLink>
              )}
              {user?.role === 'ADMIN' && (
                <NavLink to="/admin" end className={navLinkClass}>
                  Admin
                </NavLink>
              )}
              {/* Admins don't list items — participant CTA only. */}
              {user?.role !== 'ADMIN' && (
                <Link
                  to="/items/new"
                  className="rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800"
                >
                  List an Item
                </Link>
              )}
              {status === 'authenticated' && user ? (
                <div className="ml-2 flex items-center gap-2">
                  {/* Points are a participant currency — the chip would be a
                    confusing “25 pts” on a moderator session. */}
                  {user.role !== 'ADMIN' && <PointsBalance balance={user.pointsBalance} />}
                  {/* Clickable profile → settings (user request: edit name /
                    phone / password from the profile). USER-ONLY (product
                    decision): admins don't self-serve a profile, so the
                    control renders as static text for them. Link wraps the
                    avatar OR initial so there is always an accessible name. */}
                  {user.role === 'ADMIN' ? (
                    <span
                      className="flex items-center gap-2 rounded-full p-0.5 pr-2"
                      aria-label={`${user.name} (admin)`}
                    >
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover ring-1 ring-stone-300"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800"
                        >
                          {user.name?.charAt(0).toUpperCase() ?? '?'}
                        </span>
                      )}
                      <span className="hidden text-sm font-medium text-stone-700 sm:inline">
                        {user.name}
                      </span>
                    </span>
                  ) : (
                    <Link
                      to="/dashboard/profile"
                      aria-label={`${user.name} — profile settings`}
                      title="Profile settings"
                      className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-stone-100 focus-visible:outline-none"
                    >
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover ring-1 ring-stone-300"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800"
                        >
                          {user.name?.charAt(0).toUpperCase() ?? '?'}
                        </span>
                      )}
                      <span className="hidden text-sm font-medium text-stone-700 sm:inline">
                        {user.name}
                      </span>
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="rounded-md px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
                  >
                    Log out
                  </button>
                </div>
              ) : (
                <div className="ml-2 flex items-center gap-1">
                  <NavLink to="/login" className={navLinkClass}>
                    Log in
                  </NavLink>
                  <NavLink
                    to="/register"
                    className={({ isActive }) =>
                      `rounded-md px-3 py-2 text-sm font-semibold ${
                        isActive
                          ? 'bg-brand-200 text-brand-900'
                          : 'text-brand-700 hover:bg-brand-50'
                      }`
                    }
                  >
                    Sign up
                  </NavLink>
                </div>
              )}
            </nav>
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          <Outlet />
        </main>

        {/* Live-arrival toasts + chime (authed only; renders null otherwise).
          Shares the ambient poll with the navbar badge — no extra requests. */}
        {status === 'authenticated' && user && <SwapArrivalWatcher />}

        <footer className="border-t border-stone-200 bg-white py-6 text-center text-sm text-stone-500">
          ReWear — give clothes a second life. Less waste, more wardrobe.
        </footer>
      </div>
    </ToastProvider>
  );
}
