import type { ReactNode } from "react";

// Groups related actions into one visually contained control bar instead of
// N identical outlined buttons floating in a row with no hierarchy -- used
// by Org Chart's view/zoom/export controls. Dividers separate clusters
// (view state | zoom | export) so the row reads as one toolbar, not a list.
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1 rounded-edge-md bg-surface2 p-1 text-xs">{children}</div>;
}

export function ToolbarDivider() {
  return <div className="mx-1 h-4 w-px shrink-0 self-center bg-border" />;
}
