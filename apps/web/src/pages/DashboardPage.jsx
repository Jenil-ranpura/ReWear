/**
 * P5-T5 — Dashboard home (§12/§5: profile summary, points balance, and the
 * entry points to my items / swaps / points history). The user object comes
 * from AuthContext (kept fresh by the auth layer); the points chip mirrors
 * the nav's. Loading renders only while the auth layer restores; there is
 * no async data of its own yet — pages that need it link out.
 *
 * Redesign: points balance as the hero number (serif, tabular), hairline
 * cards, quiet links. Test contracts preserved (edit-profile link, the
 * dashboard-new-swaps testid, "View history" and friends).
 */

import { Link } from 'react-router-dom';

import useNewSwapRequests from '../hooks/useNewSwapRequests.js';
import { useAuth } from '../state/AuthContext.jsx';

export default function DashboardPage() {
  const { user } = useAuth();
  // Ambient NEW-swap count on the swaps card (same signal as the navbar
  // badge — shared hook, no duplicate logic).
  const { count: newSwapCount } = useNewSwapRequests({ user });

  return (
    <div className="space-y-10">
      <header className="pt-4">
        <p className="eyebrow">Dashboard</p>
        <h1 className="font-display mt-2 text-4xl text-ink sm:text-5xl">
          Welcome back, {user?.name?.split(' ')[0] ?? 'friend'}
        </h1>
        <p className="mt-2 text-ink-2">
          {user?.location ? `${user.location} · ` : ''}Member of the ReWear community
        </p>
        {/* Profile self-service is USER-only (product decision): admins
          don't list/swap, so there is nothing to edit. */}
        {user?.role !== 'ADMIN' && (
          <Link
            to="/dashboard/profile"
            data-testid="edit-profile-link"
            className="link-underline mt-3 inline-block text-sm font-semibold text-brand-700"
          >
            Edit profile →
          </Link>
        )}
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-6">
          <p className="eyebrow">Points</p>
          <p className="tabular font-display mt-3 text-5xl text-ink">{user?.pointsBalance ?? 0}</p>
          <Link
            to="/dashboard/points"
            className="link-underline mt-3 inline-block text-sm font-semibold text-brand-700"
          >
            View history →
          </Link>
        </div>

        <div className="card p-6">
          <p className="eyebrow">My items</p>
          <p className="font-display mt-3 text-2xl text-ink">Manage</p>
          <Link
            to="/dashboard/items"
            className="link-underline mt-3 inline-block text-sm font-semibold text-brand-700"
          >
            My listings →
          </Link>
        </div>

        <div className="card p-6">
          <p className="eyebrow">Swaps</p>
          <p className="font-display mt-3 flex flex-wrap items-center gap-2 text-2xl text-ink">
            Requests
            {newSwapCount > 0 && (
              <span
                data-testid="dashboard-new-swaps"
                className="tabular rounded-full bg-tint px-2 py-0.5 text-xs font-semibold text-brand-800"
              >
                {newSwapCount} new
              </span>
            )}
          </p>
          <Link
            to="/dashboard/swaps"
            className="link-underline mt-3 inline-block text-sm font-semibold text-brand-700"
          >
            Incoming / outgoing →
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          to="/items/new"
          className="pressable rounded-[6px] bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
        >
          List an item
        </Link>
        <Link
          to="/items"
          className="pressable rounded-[6px] bg-white px-5 py-2.5 text-sm font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-brand-50"
        >
          Browse items
        </Link>
      </div>
    </div>
  );
}
