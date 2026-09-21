import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import useNewSwapRequests from '../hooks/useNewSwapRequests.js';
import { useAuth } from '../state/AuthContext.jsx';
import PointsBalance from './shared/PointsBalance.jsx';
import ToastProvider from './shared/ToastProvider.jsx';
import SwapArrivalWatcher from './swaps/SwapArrivalWatcher.jsx';
import { LeafIcon } from './ui/Icon.jsx';

/**
 * Base layout/nav shell (§13) — redesigned surface, unchanged contracts:
 * - Auth awareness (P3-T7): Login/Register when signed out; name, points
 *   chip, Logout when signed in.
 * - Moderator-only contract (user decision): admins get Browse · Admin ·
 *   static name · Logout — no points chip, no List-an-Item, no Dashboard
 *   link, and the ambient NEW-swaps badge (a participant affordance) is
 *   not rendered for them.
 * - Ambient NEW badge: the useNewSwapRequests poll is keyed to the authed
 *   USER (unchanged); SwapArrivalWatcher + ToastProvider still mount here.
 *
 * Redesign: sticky header gains a hairline + white ground after scroll;
 * page content fades/rises in per route (pure CSS, transform/opacity only);
 * footer is editorial and quiet.
 */
export default function Layout() {
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { count: newSwapCount } = useNewSwapRequests({ user });
  const [scrolled, setScrolled] = useState(false);

  // Header elevation: hairline + solid ground once the page scrolls.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinkClass = ({ isActive }) =>
    `rounded-[6px] px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? 'bg-tint text-brand-800' : 'text-ink-2 hover:bg-brand-50 hover:text-ink'
    }`;

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-canvas">
        {/* Keyboard users skip the header on every page (P7-T5). */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[6px] focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to main content
        </a>

        <header
          className={`sticky top-0 z-40 border-b transition-colors duration-200 ${
            scrolled
              ? 'border-hairline bg-white/95 backdrop-blur-sm'
              : 'border-transparent bg-canvas'
          }`}
        >
          <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-2 sm:px-6">
            <Link to="/" className="flex items-center gap-2.5 text-lg font-bold text-ink">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-brand-700 text-white"
              >
                <LeafIcon className="h-4.5 w-4.5" />
              </span>
              <span className="tracking-tight">ReWear</span>
            </Link>

            <nav
              aria-label="Main navigation"
              className="flex flex-wrap items-center justify-end gap-1"
            >
              <NavLink to="/items" className={navLinkClass}>
                Browse
              </NavLink>

              {/* Dashboard is a participant surface — hidden for admins. */}
              {status === 'authenticated' && user && user.role !== 'ADMIN' && (
                <NavLink to="/dashboard" className={navLinkClass} end>
                  Dashboard
                  {newSwapCount > 0 && (
                    <span
                      data-testid="nav-new-swaps"
                      aria-label={`${newSwapCount} new swap request${newSwapCount === 1 ? '' : 's'}`}
                      className="tabular ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-brand-700 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white"
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

              {/* Participant CTA — admins don't list items; guests still see
                  it (the signup funnel). */}
              {user?.role !== 'ADMIN' && (
                <Link
                  to="/items/new"
                  className="pressable ml-1 rounded-[6px] bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
                >
                  List an Item
                </Link>
              )}

              {status === 'authenticated' && user ? (
                <div className="ml-2 flex items-center gap-2">
                  {user.role !== 'ADMIN' && <PointsBalance balance={user.pointsBalance} />}
                  {user.role === 'ADMIN' ? (
                    <span
                      className="flex items-center gap-2 rounded-full p-0.5 pr-2"
                      aria-label={`${user.name} (admin)`}
                    >
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover ring-1 ring-hairline"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-tint text-sm font-semibold text-brand-800"
                        >
                          {user.name?.charAt(0).toUpperCase() ?? '?'}
                        </span>
                      )}
                      <span className="hidden text-sm font-medium text-ink sm:inline">
                        {user.name}
                      </span>
                    </span>
                  ) : (
                    <Link
                      to="/dashboard/profile"
                      aria-label={`${user.name} — profile settings`}
                      title="Profile settings"
                      className="flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-brand-50 focus-visible:outline-none"
                    >
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover ring-1 ring-hairline"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-tint text-sm font-semibold text-brand-800"
                        >
                          {user.name?.charAt(0).toUpperCase() ?? '?'}
                        </span>
                      )}
                      <span className="hidden text-sm font-medium text-ink sm:inline">
                        {user.name}
                      </span>
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="pressable rounded-[6px] px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-brand-50 hover:text-ink"
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
                      `pressable rounded-[6px] px-3 py-2 text-sm font-semibold transition-colors ${
                        isActive ? 'bg-tint text-brand-800' : 'text-brand-700 hover:bg-brand-50'
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

        <main id="main-content" className="flex-1">
          {/* Page transition: keyed remount per route → fade + 8px rise.
              transform/opacity only; collapsed under reduced motion. */}
          <div key={location.pathname} className="page-enter">
            <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
              <Outlet />
            </div>
          </div>
        </main>

        {/* Live-arrival toasts + chime (authed users; renders null otherwise). */}
        {status === 'authenticated' && user && <SwapArrivalWatcher />}

        <footer className="mt-16 border-t border-hairline bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-brand-700 text-white"
              >
                <LeafIcon className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold tracking-tight text-ink">ReWear</span>
            </div>
            <p className="text-sm text-ink-2">
              Give clothes a second life. Less waste, more wardrobe.
            </p>
            <nav aria-label="Footer" className="flex gap-5 text-sm text-ink-2">
              {/* Labels deliberately differ from the header's accessible
                  names (tests key on exact header names). */}
              <Link to="/items" className="link-underline hover:text-ink">
                Browse items
              </Link>
              {user?.role !== 'ADMIN' && (
                <Link to="/items/new" className="link-underline hover:text-ink">
                  New listing
                </Link>
              )}
            </nav>
          </div>
        </footer>
      </div>
    </ToastProvider>
  );
}
