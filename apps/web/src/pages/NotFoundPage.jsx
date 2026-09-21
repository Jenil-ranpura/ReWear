import { Link } from 'react-router-dom';

/**
 * 404 — personality with restraint: a big serif 404, a calm line, one way
 * back. Tests rely on the "404"-bearing heading and the back-to-home link.
 */
export default function NotFoundPage() {
  return (
    <section className="card mx-auto max-w-xl px-6 py-20 text-center">
      <h1 className="font-display text-7xl text-brand-700">404</h1>
      <p className="mt-4 text-xl font-semibold text-ink">Page not found</p>
      <p className="measure mx-auto mt-2 text-sm leading-relaxed text-ink-2">
        The page you are looking for does not exist.
      </p>
      <Link
        to="/"
        className="link-underline mt-8 inline-block text-sm font-semibold text-brand-700"
      >
        Back to home
      </Link>
    </section>
  );
}
