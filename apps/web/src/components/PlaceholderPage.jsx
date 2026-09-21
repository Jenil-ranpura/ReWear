/**
 * Temporary stand-in for pages built in later phases — makes the shell fully
 * navigable from day one without mocking features that don't exist yet.
 * Restyled to the token system (hairline, serif title).
 */
export default function PlaceholderPage({ title, phase }) {
  return (
    <section className="card border-dashed p-10 text-center">
      <h1 className="font-display text-3xl text-ink">{title}</h1>
      <p className="mt-2 text-sm text-ink-2">This page is built in {phase}.</p>
    </section>
  );
}
