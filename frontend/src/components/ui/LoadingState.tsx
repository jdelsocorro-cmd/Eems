// Every page fetched its primary list with useQuery and rendered `data ?? []`
// directly -- while loading, that's an empty array, visually identical to a
// genuinely empty result. The user sees a blank table with no spinner and no
// "nothing here" message, which reads as broken, not "please wait." This is
// the loading counterpart to EmptyState -- same layout, so a card never jumps
// between three visually different states (spinner, real content, "empty").
export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-surface3 border-t-edge-teal" />
      <p className="text-xs text-text-dim">{label}</p>
    </div>
  );
}

// For inline use next to text that's already there (a stat number, a card
// header) instead of replacing the whole content area.
export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-surface3 border-t-edge-teal ${className}`} />;
}
