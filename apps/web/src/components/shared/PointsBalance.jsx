/**
 * <PointsBalance> (§12 key reusable component). The user's points chip —
 * one source of truth for nav + dashboard. Renders nothing without a user
 * (nav logged-out state). `detailed` shows the unit spelled out (dashboard
 * card); default is the compact chip (nav).
 */

export default function PointsBalance({ balance, detailed = false }) {
  if (balance == null) return null;
  if (detailed) {
    return (
      <span className="text-3xl font-bold text-brand-700">
        {balance} <span className="text-base font-semibold">pts</span>
      </span>
    );
  }
  return (
    <span
      className="rounded-md bg-brand-100 px-3 py-2 text-sm font-semibold text-brand-900"
      title="Your points balance"
    >
      {balance} pts
    </span>
  );
}
