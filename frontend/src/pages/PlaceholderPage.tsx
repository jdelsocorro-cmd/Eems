export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-text">{title}</h1>
      <p className="mt-2 text-sm text-text-muted">Built in a later stage of the Phase 1 build sequence.</p>
    </div>
  );
}
