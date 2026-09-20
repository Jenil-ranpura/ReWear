/**
 * P5-T5 — Dashboard home (§12/§5: profile summary, points balance, and the
 * entry points to my items / swaps / points history). The user object comes
 * from AuthContext (kept fresh by the auth layer); the points chip mirrors
 * the nav's. Loading renders only while the auth layer restores; there is
 * no async data of its own yet — pages that need it link out.
 */

import { Link } from 'react-router-dom';

import useNewSwapRequests from '../hooks/useNewSwapRequests.js';
import { useAuth } from '../state/AuthContext.jsx';
import PointsBalance from '../components/shared/PointsBalance.jsx';

export default function DashboardPage() {
  const { user } = useAuth();
  // Ambient NEW-swap count on the swaps card (same signal as the navbar
  // badge — shared hook, no duplicate logic).
  const { count: newSwapCount } = useNewSwapRequests({ user });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-stone-900">
          Welcome back, {user?.name?.split(' ')[0] ?? 'friend'}
        </h1>
        <p className="mt-1 text-stone-500">
          {user?.location ? `${user.location} · ` : ''}Member of the ReWear community
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
          <p className="text-xs font-bold uppercase tracking-wide text-stone-450">Points</p>
          <p className="mt-2">
            <PointsBalance balance={user?.pointsBalance} detailed />
          </p>
          <Link
            to="/dashboard/points"
            className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline"
          >
            View history →
          </Link>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
          <p className="text-xs font-bold uppercase tracking-wide text-stone-450">My items</p>
          <p className="mt-2 text-3xl font-bold text-stone-900">Manage</p>
          <Link
            to="/dashboard/items"
            className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline"
          >
            My listings →
          </Link>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
          <p className="text-xs font-bold uppercase tracking-wide text-stone-450">Swaps</p>
          <p className="mt-2 flex items-center gap-2 text-3xl font-bold text-stone-900">
            Requests
            {newSwapCount > 0 && (
              <span
                data-testid="dashboard-new-swaps"
                className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700"
              >
                {newSwapCount} new
              </span>
            )}
          </p>
          <Link
            to="/dashboard/swaps"
            className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline"
          >
            Incoming / outgoing →
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          to="/items/new"
          className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
        >
          List an item
        </Link>
        <Link
          to="/items"
          className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
        >
          Browse items
        </Link>
      </div>
    </div>
  );
}
