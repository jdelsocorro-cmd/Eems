import type { ReactNode } from "react";

// A bare "No goals yet." floating alone in a card (the pattern every page
// used before this) reads as unfinished, not empty-by-design. Consistent
// icon + message treatment so an empty list looks intentional everywhere.
export function EmptyState({ icon = "—", title, message }: { icon?: ReactNode; title?: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface2 text-sm text-text-dim">{icon}</div>
      {title && <p className="text-sm font-medium text-text">{title}</p>}
      <p className="text-xs text-text-dim">{message}</p>
    </div>
  );
}
