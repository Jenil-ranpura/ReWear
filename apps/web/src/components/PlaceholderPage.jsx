/**
 * Temporary stand-in for pages built in later phases — makes the shell fully
 * navigable from day one without mocking features that don't exist yet.
 */
export default function PlaceholderPage({ title, phase }) {
  return (
    <section className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
      <h1 className="text-2xl font-bold text-stone-800">{title}</h1>
      <p className="mt-2 text-stone-500">This page is built in {phase}.</p>
    </section>
  );
}
