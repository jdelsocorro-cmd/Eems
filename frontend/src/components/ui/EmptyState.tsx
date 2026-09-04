import type { ReactNode } from "react";
import { IconInbox } from "@tabler/icons-react";

import { Button } from "./Button";

// A bare "No goals yet." floating alone in a card (the pattern every page
// used before this) reads as unfinished, not empty-by-design. Consistent
// icon + message treatment so an empty list looks intentional everywhere.
// Default icon is a real Tabler glyph (matching every other icon in the
// app) rather than a flat "—" -- the one component in EEMS that still
// looked like a placeholder instead of a finished element, per a visual
// design review. No call site currently overrides `icon`, so this one
// change reaches all ~30 empty states at once.
//
// `action` is optional and deliberately narrow (one label + one handler) --
// most empty states genuinely have no next step worth offering ("no comments
// yet" isn't actionable), so this only shows up where a caller opts in with
// a real destination, rather than every one of the 30+ call sites growing a
// button by default.
export function EmptyState({
  icon = <IconInbox size={18} />,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title?: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface2 text-text-dim">{icon}</div>
      {title && <p className="text-sm font-medium text-text">{title}</p>}
      <p className="text-xs text-text-dim">{message}</p>
      {action && (
        <Button variant="ghost" size="sm" className="mt-1" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
