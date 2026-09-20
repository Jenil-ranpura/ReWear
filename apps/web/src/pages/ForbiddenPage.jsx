/**
 * 403 page (§11): authenticated users who lack the admin role land here via
 * ProtectedRoute (requireAdmin). Distinct from 401, which redirects to login.
 */

import { Link } from 'react-router-dom';

export default function ForbiddenPage() {
  return (
    <section className="mx-auto max-w-xl rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
      <h1 className="text-3xl font-bold text-stone-800">403 — Not allowed</h1>
      <p className="mt-2 text-stone-500">
        You do not have permission to view this area. Admin access is required.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-lg bg-emerald-700 px-5 py-2.5 font-semibold text-white transition hover:bg-emerald-800"
      >
        Back to home
      </Link>
    </section>
  );
}
