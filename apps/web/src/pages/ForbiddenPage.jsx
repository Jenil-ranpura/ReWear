import { Link } from 'react-router-dom';

/**
 * 403 page (§11): authenticated users who lack the admin role land here via
 * ProtectedRoute (requireAdmin). Distinct from 401, which redirects to login.
 * Tests rely on the "403"-bearing heading and the back-to-home link.
 */
export default function ForbiddenPage() {
  return (
    <section className="card mx-auto max-w-xl px-6 py-20 text-center">
      {/* Heading text is a test contract (profileSettings + auth suites). */}
      <h1 className="font-display text-5xl text-brand-700 sm:text-7xl">403 — Not allowed</h1>
      <p className="measure mx-auto mt-4 text-sm leading-relaxed text-ink-2">
        You do not have permission to view this area. Admin access is required.
      </p>
      <Link
        to="/"
        className="pressable mt-8 inline-block rounded-[6px] bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
      >
        Back to home
      </Link>
    </section>
  );
}
