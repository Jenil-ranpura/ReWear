import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
      <h1 className="text-3xl font-bold text-stone-800">Page not found</h1>
      <p className="mt-2 text-stone-500">The page you are looking for does not exist.</p>
      <Link to="/" className="mt-6 inline-block font-semibold text-brand-700 hover:underline">
        Back to home
      </Link>
    </section>
  );
}
